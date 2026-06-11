import type {
  AgentCommandRequest,
  AgentEvent,
  AgentMessage,
  AgentSnapshot,
  ApprovalDecision,
} from "../src/shared/contracts";
import type { AgentStore } from "./store";
import { createRuntimeForAgent } from "./runtimes/registry";
import type {
  AgentRuntime,
  RuntimeApprovalRequest,
  RuntimeFactory,
  RuntimeUsage,
} from "./runtimes/types";

export type SupervisorListener = (event: AgentEvent) => void;

export interface SupervisorOptions {
  /** How long an approval may stay unanswered before auto-allowing. */
  approvalTimeoutMs?: number;
}

const DEFAULT_APPROVAL_TIMEOUT_MS = 60_000;

interface PendingApproval {
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class AgentSupervisor {
  private readonly runtimes = new Map<string, AgentRuntime>();
  private readonly eventBuffers = new Map<string, AgentEvent[]>();
  private readonly listeners = new Set<SupervisorListener>();
  private readonly runtimeFactory: RuntimeFactory;
  /** Pending approval resolvers, keyed agentId → approvalId. */
  private readonly pendingApprovals = new Map<string, Map<string, PendingApproval>>();
  private readonly approvalTimeoutMs: number;

  constructor(
    private readonly store: AgentStore,
    runtimeFactory: RuntimeFactory = createRuntimeForAgent,
    options: SupervisorOptions = {},
  ) {
    this.runtimeFactory = runtimeFactory;
    this.approvalTimeoutMs = options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
  }

  subscribe(listener: SupervisorListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  isRunning(agentId: string): boolean {
    return this.runtimes.has(agentId);
  }

  async startAgent(agentId: string): Promise<AgentEvent[]> {
    const agent = this.store.get(agentId);
    if (!agent) return [agentEvent(agentId, "error", "Agent not found")];

    if (this.runtimes.has(agentId)) {
      const updated = this.store.update(agentId, { status: "running" });
      const events = updated
      ? [agentEvent(agentId, "updated", "Agent updated", updated)]
        : [];
      this.broadcast(events);
      return events;
    }

    const events: AgentEvent[] = [];
    const runtime = this.runtimeFactory(agent);
    this.runtimes.set(agentId, runtime);

    const updated = this.store.update(agentId, {
      status: "running",
      currentTask: "Starting runtime",
    });
    pushAgentUpdated(events, updated);

    try {
      await runtime.start(this.buildStartOptions(agentId, updated ?? agent));
      events.push(...this.drainEvents(agentId));
    } catch (error) {
      this.runtimes.delete(agentId);
      const message = error instanceof Error ? error.message : String(error);
      pushLogEvent(events, this.store, agentId, message);
      const failed = this.store.update(agentId, {
        status: "error",
        currentTask: message,
      });
      pushAgentUpdated(events, failed);
      events.push(agentEvent(agentId, "error", message, failed));
    }

    this.broadcast(events);
    return events;
  }

  async sendCommand(
    agentId: string,
    request: AgentCommandRequest,
  ): Promise<AgentEvent[]> {
    const agent = this.store.get(agentId);
    if (!agent) {
      const events = [agentEvent(agentId, "error", "Agent not found")];
      this.broadcast(events);
      return events;
    }

    const runtime = this.runtimes.get(agentId);
    if (!runtime) {
      const events = [agentEvent(agentId, "error", "Agent is not running")];
      this.broadcast(events);
      return events;
    }

    const command = request.command.trim();
    if (!command) {
      const events = [agentEvent(agentId, "error", "Command is required")];
      this.broadcast(events);
      return events;
    }

    const events: AgentEvent[] = [agentEvent(agentId, "command", command)];

    // Record the user message in the structured chat history immediately.
    const userMessage: AgentMessage = {
      id: `msg-${crypto.randomUUID()}`,
      role: "user",
      content: command,
      format: "text",
      streaming: false,
      toolCalls: [],
      createdAt: new Date().toISOString(),
    };
    const withUser = appendMessage(this.store, agentId, userMessage);
    pushAgentUpdated(events, withUser);

    const updated = this.store.update(agentId, {
      status: "running",
      currentTask: command,
    });
    pushAgentUpdated(events, updated);

    try {
      await runtime.send({ ...request, command });
      events.push(...this.drainEvents(agentId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushLogEvent(events, this.store, agentId, message);
      this.store.recordApiCall(agentId, "error");
      const failed = this.store.update(agentId, {
        status: "error",
        currentTask: message,
      });
      pushAgentUpdated(events, failed);
      events.push(agentEvent(agentId, "error", message));
    }

    this.broadcast(events);
    return events;
  }

  async stopAgent(agentId: string): Promise<AgentEvent[]> {
    const agent = this.store.get(agentId);
    if (!agent) {
      const events = [agentEvent(agentId, "error", "Agent not found")];
      this.broadcast(events);
      return events;
    }

    const events: AgentEvent[] = [];
    const runtime = this.runtimes.get(agentId);

    if (runtime) {
      this.settleAllApprovals(agentId, "deny");
      await runtime.stop();
      this.runtimes.delete(agentId);
      events.push(...this.drainEvents(agentId));
    }

    const updated = this.store.update(agentId, {
      status: "stopped",
      currentTask: null,
    });
    pushAgentUpdated(events, updated);
    this.broadcast(events);
    return events;
  }

  async deleteAgent(agentId: string): Promise<AgentEvent[]> {
    const agent = this.store.get(agentId);
    if (!agent) {
      const events = [agentEvent(agentId, "error", "Agent not found")];
      this.broadcast(events);
      return events;
    }

    const runtime = this.runtimes.get(agentId);
    if (runtime) {
      this.settleAllApprovals(agentId, "deny");
      await runtime.stop();
      this.runtimes.delete(agentId);
    }

    this.store.delete(agentId);
    const events: AgentEvent[] = [agentEvent(agentId, "deleted", "Agent deleted")];
    this.broadcast(events);
    return events;
  }

  /**
   * Resolve a pending runtime approval with the user's decision.
   * Returns false when the approval is unknown (already resolved/timed out).
   */
  respondToApproval(
    agentId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): boolean {
    const pending = this.pendingApprovals.get(agentId)?.get(approvalId);
    if (!pending) return false;
    this.settleApproval(agentId, approvalId, pending, decision);
    return true;
  }

  private registerApproval(agentId: string, req: RuntimeApprovalRequest): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        const pending = this.pendingApprovals.get(agentId)?.get(req.approvalId);
        if (!pending) return;
        this.bufferLog(
          agentId,
          `[approval] ${req.approvalId} unanswered after ${this.approvalTimeoutMs}ms — falling back to allow`,
        );
        this.settleApproval(agentId, req.approvalId, pending, "allow");
      }, this.approvalTimeoutMs);
      timer.unref?.();

      const byAgent = this.pendingApprovals.get(agentId) ?? new Map<string, PendingApproval>();
      byAgent.set(req.approvalId, { resolve, timer });
      this.pendingApprovals.set(agentId, byAgent);

      this.bufferEvent(
        agentId,
        agentEvent(agentId, "approvalRequest", req.summary, undefined, {
          approvalId: req.approvalId,
          approvalKind: req.kind,
          approvalSummary: req.summary,
          approvalDetails: req.details,
        }),
      );
    });
  }

  private settleApproval(
    agentId: string,
    approvalId: string,
    pending: PendingApproval,
    decision: ApprovalDecision,
  ) {
    clearTimeout(pending.timer);
    const byAgent = this.pendingApprovals.get(agentId);
    byAgent?.delete(approvalId);
    if (byAgent && byAgent.size === 0) this.pendingApprovals.delete(agentId);
    pending.resolve(decision);
    this.bufferEvent(
      agentId,
      agentEvent(agentId, "approvalResolved", `approval ${decision}`, undefined, {
        approvalId,
        approvalDecision: decision,
      }),
    );
  }

  private settleAllApprovals(agentId: string, decision: ApprovalDecision) {
    const byAgent = this.pendingApprovals.get(agentId);
    if (!byAgent) return;
    for (const [approvalId, pending] of [...byAgent]) {
      this.settleApproval(agentId, approvalId, pending, decision);
    }
  }

  private buildStartOptions(agentId: string, agent: AgentSnapshot) {
    return {
      agent,
      onLine: (line: string) => this.bufferLog(agentId, line),
      onExit: (code: number | null) => {
        this.runtimes.delete(agentId);
        const status = code === 0 ? "stopped" : "error";
        const exited = this.store.update(agentId, {
          status,
          currentTask: null,
        });
        this.bufferAgentUpdated(agentId, exited);
      },
      onError: (error: Error) => {
        this.runtimes.delete(agentId);
        this.bufferLog(agentId, error.message);
        // Count the failed call; the snapshot below carries the new apiCalls.
        this.store.recordApiCall(agentId, "error");
        const failed = this.store.update(agentId, {
          status: "error",
          currentTask: error.message,
        });
        this.bufferAgentUpdated(agentId, failed);
        this.bufferEvent(agentId, agentEvent(agentId, "error", error.message, failed));
      },
      onSessionId: (sessionId: string) => {
        const persisted = this.store.update(agentId, { sessionId });
        this.bufferAgentUpdated(agentId, persisted);
        this.bufferLog(agentId, `[runtime] session id captured: ${sessionId}`);
      },
      onMessageStart: (e: { messageId: string; role: "assistant" | "tool" | "system" }) => {
        const message: AgentMessage = {
          id: e.messageId,
          role: e.role,
          content: "",
          format: "markdown",
          streaming: true,
          toolCalls: [],
          createdAt: new Date().toISOString(),
        };
        const updated = appendMessage(this.store, agentId, message);
        this.bufferAgentUpdated(agentId, updated);
        this.bufferEvent(
          agentId,
          agentEvent(agentId, "messageStart", `message started: ${e.messageId}`, updated, {
            messageId: e.messageId,
            role: e.role,
            message,
          }),
        );
      },
      onMessageDelta: (e: { messageId: string; delta: string }) => {
        const updated = mutateMessage(this.store, agentId, e.messageId, (m) => ({
          ...m,
          content: m.content + e.delta,
          streaming: true,
        }));
        this.bufferAgentUpdated(agentId, updated);
        this.bufferEvent(
          agentId,
          agentEvent(agentId, "messageDelta", e.delta, updated, {
            messageId: e.messageId,
            delta: e.delta,
          }),
        );
      },
      onMessageEnd: (e: { messageId: string; content: string; format?: "text" | "markdown" }) => {
        const updated = mutateMessage(this.store, agentId, e.messageId, (m) => ({
          ...m,
          content: e.content || m.content,
          format: e.format ?? m.format,
          streaming: false,
        }));
        const final = updated?.messages.find((m) => m.id === e.messageId);
        this.bufferAgentUpdated(agentId, updated);
        if (final) {
          this.bufferEvent(
            agentId,
            agentEvent(agentId, "messageEnd", "message complete", updated, {
              messageId: e.messageId,
              message: final,
            }),
          );
        }
      },
      onToolCall: (e: { messageId: string; toolCallId: string; toolName: string; input: string }) => {
        const updated = mutateMessage(this.store, agentId, e.messageId, (m) => ({
          ...m,
          toolCalls: [
            ...m.toolCalls,
            { id: e.toolCallId, name: e.toolName, input: e.input, status: "pending", output: "" },
          ],
        }));
        this.bufferAgentUpdated(agentId, updated);
        this.bufferEvent(
          agentId,
          agentEvent(agentId, "toolCall", `${e.toolName}(${e.input.slice(0, 80)})`, updated, {
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            toolInput: e.input,
          }),
        );
      },
      onToolResult: (e: { messageId: string; toolCallId: string; status: "success" | "error"; output: string }) => {
        const updated = mutateMessage(this.store, agentId, e.messageId, (m) => ({
          ...m,
          toolCalls: m.toolCalls.map((tc) =>
            tc.id === e.toolCallId ? { ...tc, status: e.status, output: e.output } : tc,
          ),
        }));
        this.bufferAgentUpdated(agentId, updated);
        this.bufferEvent(
          agentId,
          agentEvent(agentId, "toolResult", `${e.status}: ${e.output.slice(0, 80)}`, updated, {
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolStatus: e.status,
            toolOutput: e.output,
          }),
        );
      },
      onUsage: (usage: RuntimeUsage) => {
        const updated = this.store.applyUsage(agentId, usage);
        this.bufferAgentUpdated(agentId, updated);
      },
      onTurnComplete: () => {
        const updated = this.store.recordApiCall(agentId, "success");
        this.bufferAgentUpdated(agentId, updated);
        this.bufferEvent(agentId, agentEvent(agentId, "turnComplete", "turn complete", updated));
      },
      onApprovalRequest: (req: RuntimeApprovalRequest) => this.registerApproval(agentId, req),
    };
  }

  private bufferLog(agentId: string, line: string) {
    const agent = this.store.appendLog(agentId, line);
    if (agent) this.bufferEvent(agentId, agentEvent(agentId, "log", line, agent));
  }

  private bufferAgentUpdated(
    agentId: string,
    agent: AgentSnapshot | undefined,
  ) {
    if (agent) this.bufferEvent(agentId, agentEvent(agentId, "updated", "Agent updated", agent));
  }

  private bufferEvent(agentId: string, event: AgentEvent) {
    const events = this.eventBuffers.get(agentId) ?? [];
    events.push(event);
    this.eventBuffers.set(agentId, events);
    // Live-broadcast async events so subscribers see them immediately.
    this.broadcast([event]);
  }

  private drainEvents(agentId: string): AgentEvent[] {
    const events = this.eventBuffers.get(agentId) ?? [];
    this.eventBuffers.delete(agentId);
    return events;
  }

  private broadcast(events: AgentEvent[]) {
    if (events.length === 0 || this.listeners.size === 0) return;
    for (const event of events) {
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch {
          // listener errors must not break the supervisor.
        }
      }
    }
  }
}

function pushLogEvent(
  events: AgentEvent[],
  store: AgentStore,
  agentId: string,
  line: string,
) {
  const agent = store.appendLog(agentId, line);
  if (agent) events.push(agentEvent(agentId, "log", line, agent));
}

function pushAgentUpdated(events: AgentEvent[], agent: AgentSnapshot | undefined) {
  if (agent) events.push(agentEvent(agent.id, "updated", "Agent updated", agent));
}

function agentEvent(
  agentId: string,
  type: AgentEvent["type"],
  message: string,
  snapshot?: AgentSnapshot,
  payload?: AgentEvent["payload"],
): AgentEvent {
  return {
    id: crypto.randomUUID(),
    agentId,
    type,
    message,
    snapshot,
    payload,
    createdAt: new Date().toISOString(),
  };
}

function appendMessage(
  store: AgentStore,
  agentId: string,
  message: AgentMessage,
): AgentSnapshot | undefined {
  const current = store.get(agentId);
  if (!current) return undefined;
  return store.update(agentId, {
    messages: [...current.messages, message].slice(-200),
  });
}

function mutateMessage(
  store: AgentStore,
  agentId: string,
  messageId: string,
  mutator: (message: AgentMessage) => AgentMessage,
): AgentSnapshot | undefined {
  const current = store.get(agentId);
  if (!current) return undefined;
  let mutated = false;
  const messages = current.messages.map((m) => {
    if (m.id !== messageId) return m;
    mutated =true;
    return mutator(m);
  });
  if (!mutated) return current;
  return store.update(agentId, { messages });
}