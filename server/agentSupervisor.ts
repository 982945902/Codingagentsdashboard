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
const MAX_ATTACHMENT_CONTENT_CHARS = 262_144;

interface PendingApproval {
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

type DashboardSlashCommand =
  | { kind: "clear"; raw: string }
  | { kind: "model"; raw: string; value: string }
  | { kind: "dir"; raw: string; value: string }
  | { kind: "resume"; raw: string; value: string }
  | { kind: "new-session"; raw: string }
  | { kind: "error"; raw: string; message: string };

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

  updateAttachedAgent(
    agentId: string,
    patch: Partial<AgentSnapshot>,
  ): AgentSnapshot | undefined {
    const updated = this.store.update(agentId, patch);
    if (updated) {
      this.broadcast([
        agentEvent(agentId, "updated", "Attached runtime updated", updated),
      ]);
    }
    return updated;
  }

  async attachAgentRuntime(
    agentId: string,
    runtime: AgentRuntime,
  ): Promise<AgentEvent[]> {
    const agent = this.store.get(agentId);
    if (!agent) return [agentEvent(agentId, "error", "Agent not found")];
    this.runtimes.set(agentId, runtime);
    const events: AgentEvent[] = [];
    try {
      await runtime.start(this.buildStartOptions(agentId, agent));
      events.push(...this.drainEvents(agentId));
      pushAgentUpdated(
        events,
        this.store.update(agentId, {
          status: "running",
          connectionStatus: "online",
          currentTask: null,
        }),
      );
    } catch (error) {
      this.runtimes.delete(agentId);
      const message = error instanceof Error ? error.message : String(error);
      events.push(agentEvent(agentId, "error", message));
    }
    this.broadcast(events);
    return events;
  }

  detachAgentRuntime(agentId: string, runtime: AgentRuntime): void {
    if (this.runtimes.get(agentId) !== runtime) return;
    this.runtimes.delete(agentId);
    void runtime.stop();
    const updated = this.store.update(agentId, {
      status: "paused",
      connectionStatus: "offline",
      currentTask: null,
      lastSeenAt: new Date().toISOString(),
    });
    if (updated) {
      this.broadcast([
        agentEvent(agentId, "updated", "Attached runtime disconnected", updated),
      ]);
    }
  }

  async abortAgent(agentId: string): Promise<AgentEvent[]> {
    const runtime = this.runtimes.get(agentId);
    if (!runtime?.abort) {
      const events = [agentEvent(agentId, "error", "Runtime does not support abort")];
      this.broadcast(events);
      return events;
    }
    await runtime.abort();
    const events = [agentEvent(agentId, "log", "Abort requested")];
    this.broadcast(events);
    return events;
  }

  async startAgent(agentId: string): Promise<AgentEvent[]> {
    const events = await this.startAgentInternal(agentId);
    this.broadcast(events);
    return events;
  }

  private async startAgentInternal(agentId: string): Promise<AgentEvent[]> {
    const agent = this.store.get(agentId);
    if (!agent) return [agentEvent(agentId, "error", "Agent not found")];

    if (this.runtimes.has(agentId)) {
      const updated = this.store.update(agentId, {
        status: "running",
        connectionStatus: "online",
      });
      const events = updated
      ? [agentEvent(agentId, "updated", "Agent updated", updated)]
        : [];
      return events;
    }

    const events: AgentEvent[] = [];
    const runtime = this.runtimeFactory(agent);
    this.runtimes.set(agentId, runtime);

    const updated = this.store.update(agentId, {
      status: "running",
      connectionStatus: "reconnecting",
      currentTask: "Starting runtime",
    });
    pushAgentUpdated(events, updated);

    try {
      await runtime.start(this.buildStartOptions(agentId, updated ?? agent));
      events.push(...this.drainEvents(agentId));
      pushAgentUpdated(
        events,
        this.store.update(agentId, {
          status: "running",
          connectionStatus: "online",
          currentTask: null,
        }),
      );
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

    const command = request.command.trim();
    if (!command) {
      const events = [agentEvent(agentId, "error", "Command is required")];
      this.broadcast(events);
      return events;
    }

    const slash = parseDashboardSlashCommand(command);
    if (slash) {
      const events = await this.handleDashboardSlashCommand(agentId, slash);
      this.broadcast(events);
      return events;
    }

    const runtime = this.runtimes.get(agentId);
    if (!runtime) {
      const events = [agentEvent(agentId, "error", "Agent is not running")];
      this.broadcast(events);
      return events;
    }

    const runtimeCommand = buildRuntimeCommand(command, request.attachments ?? []);
    const events: AgentEvent[] = [agentEvent(agentId, "command", command)];

    // Managed runtimes need the supervisor to persist the optimistic user message.
    // Attached runtimes (Pi) echo the authoritative user message from the live TUI session.
    if (runtime.messageOwnership !== "runtime") {
      const userMessage: AgentMessage = {
        id: `msg-${crypto.randomUUID()}`,
        role: "user",
        content: runtimeCommand,
        format: "text",
        streaming: false,
        toolCalls: [],
        createdAt: new Date().toISOString(),
      };
      const withUser = appendMessage(this.store, agentId, userMessage);
      pushAgentUpdated(events, withUser);
    }

    const updated = this.store.update(agentId, {
      status: "busy",
      currentTask: command,
    });
    pushAgentUpdated(events, updated);

    try {
      await runtime.send({ ...request, command: runtimeCommand });
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

  private async handleDashboardSlashCommand(
    agentId: string,
    slash: DashboardSlashCommand,
  ): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [agentEvent(agentId, "command", slash.raw)];

    if (slash.kind === "error") {
      events.push(agentEvent(agentId, "error", slash.message));
      return events;
    }

    if (slash.kind === "clear") {
      pushLogEvent(events, this.store, agentId, "[slash] local logs cleared");
      return events;
    }

    if (slash.kind === "model") {
      const updated = this.store.update(agentId, { model: slash.value });
      pushAgentUpdated(events, updated);
      if (updated) this.runtimes.get(agentId)?.configure?.(updated);
      pushLogEvent(events, this.store, agentId, `[slash] model set to ${slash.value}`);
      return events;
    }

    const wasRunning = await this.stopRuntimeForRestart(agentId, events);
    const patch: Partial<AgentSnapshot> =
      slash.kind === "dir"
        ? { workspacePath: slash.value }
        : slash.kind === "resume"
          ? { sessionId: slash.value }
          : { sessionId: null };
    const updated = this.store.update(agentId, patch);
    pushAgentUpdated(events, updated);

    const message =
      slash.kind === "dir"
        ? `[slash] workspace path set to ${slash.value}`
        : slash.kind === "resume"
          ? `[slash] session id set to ${slash.value}`
          : "[slash] session id cleared";
    pushLogEvent(events, this.store, agentId, message);

    if (wasRunning) {
      events.push(...(await this.startAgentInternal(agentId)));
    }

    return events;
  }

  private async stopRuntimeForRestart(agentId: string, events: AgentEvent[]): Promise<boolean> {
    const runtime = this.runtimes.get(agentId);
    if (!runtime) return false;
    this.settleAllApprovals(agentId, "deny");
    await runtime.stop();
    this.runtimes.delete(agentId);
    events.push(...this.drainEvents(agentId));
    return true;
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
      connectionStatus: "offline",
      currentTask: null,
    });
    pushAgentUpdated(events, updated);
    this.broadcast(events);
    return events;
  }

  async pauseAgent(agentId: string): Promise<AgentEvent[]> {
    const agent = this.store.get(agentId);
    if (!agent) {
      const events = [agentEvent(agentId, "error", "Agent not found")];
      this.broadcast(events);
      return events;
    }

    const events: AgentEvent[] = [];
    await this.stopRuntimeForRestart(agentId, events);
    const updated = this.store.update(agentId, {
      status: "paused",
      connectionStatus: "offline",
      currentTask: null,
    });
    pushAgentUpdated(events, updated);
    this.broadcast(events);
    return events;
  }

  async restartAgent(agentId: string): Promise<AgentEvent[]> {
    const agent = this.store.get(agentId);
    if (!agent) {
      const events = [agentEvent(agentId, "error", "Agent not found")];
      this.broadcast(events);
      return events;
    }

    const events: AgentEvent[] = [];
    await this.stopRuntimeForRestart(agentId, events);
    events.push(...(await this.startAgentInternal(agentId)));
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
          `[approval] ${req.approvalId} unanswered after ${this.approvalTimeoutMs}ms — falling back to deny`,
        );
        this.settleApproval(agentId, req.approvalId, pending, "deny");
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
          connectionStatus: "offline",
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
      onMessageStart: (e: { messageId: string; role: "user" | "assistant" | "tool" | "system" }) => {
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
        const recorded = this.store.recordApiCall(agentId, "success");
        const updated = recorded
          ? this.store.update(agentId, {
              status: "running",
              currentTask: null,
              tasksCompleted: recorded.tasksCompleted + 1,
            })
          : undefined;
        this.bufferAgentUpdated(agentId, updated ?? recorded);
        this.bufferEvent(agentId, agentEvent(agentId, "turnComplete", "turn complete", updated ?? recorded));
      },
      onStatusChange: (status: "idle" | "busy") => {
        const updated = this.store.update(agentId, {
          status: status === "busy" ? "busy" : "running",
          currentTask:
            status === "idle"
              ? null
              : this.store.get(agentId)?.currentTask ?? "Pi TUI activity",
          connectionStatus: "online",
          lastSeenAt: new Date().toISOString(),
        });
        this.bufferAgentUpdated(agentId, updated);
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

function parseDashboardSlashCommand(command: string): DashboardSlashCommand | null {
  if (!command.startsWith("/")) return null;
  const [name = "", ...rest] = command.split(/\s+/);
  const value = rest.join(" ").trim();

  switch (name) {
    case "/clear":
      return { kind: "clear", raw: command };
    case "/model":
      return value
        ? { kind: "model", raw: command, value }
        : { kind: "error", raw: command, message: "Usage: /model <name>" };
    case "/dir":
      return value
        ? { kind: "dir", raw: command, value }
        : { kind: "error", raw: command, message: "Usage: /dir <path>" };
    case "/resume":
      return value
        ? { kind: "resume", raw: command, value }
        : { kind: "error", raw: command, message: "Usage: /resume <sessionId>" };
    case "/new-session":
      return { kind: "new-session", raw: command };
    default:
      return null;
  }
}

function buildRuntimeCommand(
  command: string,
  attachments: NonNullable<AgentCommandRequest["attachments"]>,
): string {
  if (attachments.length === 0) return command;
  const rendered = attachments.map((attachment, index) => {
    const content = attachment.content
      ? attachment.content.slice(0, MAX_ATTACHMENT_CONTENT_CHARS)
      : "[content not provided]";
    const truncated =
      attachment.content && attachment.content.length > MAX_ATTACHMENT_CONTENT_CHARS
        ? "\n[truncated by server]"
        : "";
    return [
      `Attachment ${index + 1}: ${attachment.name}`,
      `MIME: ${attachment.mimeType}`,
      `Size: ${attachment.size} bytes`,
      `Encoding: ${attachment.encoding ?? "metadata-only"}`,
      "Content:",
      content + truncated,
    ].join("\n");
  });
  return [
    command,
    "",
    "Attached files are provided below. Use their contents as part of the user's request.",
    ...rendered,
  ].join("\n");
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
