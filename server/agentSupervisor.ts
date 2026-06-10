import type {
  AgentCommandRequest,
  AgentEvent,
  AgentMessage,
  AgentSnapshot,
} from "../src/shared/contracts";
import type { AgentStore } from "./store";
import { createRuntimeForAgent } from "./runtimes/registry";
import type { AgentRuntime, RuntimeFactory } from "./runtimes/types";

export type SupervisorListener = (event: AgentEvent) => void;

export class AgentSupervisor {
  private readonly runtimes = new Map<string, AgentRuntime>();
  private readonly eventBuffers = new Map<string, AgentEvent[]>();
  private readonly listeners = new Set<SupervisorListener>();
  private readonly runtimeFactory: RuntimeFactory;

  constructor(
    private readonly store: AgentStore,
    runtimeFactory: RuntimeFactory = createRuntimeForAgent,
  ) {
    this.runtimeFactory = runtimeFactory;
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
      await runtime.stop();
      this.runtimes.delete(agentId);
    }

    this.store.delete(agentId);
    const events: AgentEvent[] = [agentEvent(agentId, "deleted", "Agent deleted")];
    this.broadcast(events);
    return events;
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
      onTurnComplete: () => {
        this.bufferEvent(agentId, agentEvent(agentId, "turnComplete", "turn complete"));
      },
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