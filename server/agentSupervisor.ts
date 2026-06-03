import type {
  AgentCommandRequest,
  AgentEvent,
  AgentSnapshot,
} from "../src/shared/contracts";
import type { AgentStore } from "./store";
import { createRuntimeForAgent } from "./runtimes/registry";
import type { AgentRuntime, RuntimeFactory } from "./runtimes/types";

export class AgentSupervisor {
  private readonly runtimes = new Map<string, AgentRuntime>();
  private readonly eventBuffers = new Map<string, AgentEvent[]>();
  private readonly runtimeFactory: RuntimeFactory;

  constructor(
    private readonly store: AgentStore,
    runtimeFactory: RuntimeFactory = createRuntimeForAgent,
  ) {
    this.runtimeFactory = runtimeFactory;
  }

  async startAgent(agentId: string): Promise<AgentEvent[]> {
    const agent = this.store.get(agentId);
    if (!agent) return [agentEvent(agentId, "error", "Agent not found")];

    if (this.runtimes.has(agentId)) {
      const updated = this.store.update(agentId, { status: "running" });
      return updated ? [agentEvent(agentId, "updated", "Agent updated", updated)] : [];
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
      await runtime.start({
        agent: updated ?? agent,
        onLine: (line) => {
          this.bufferLog(agentId, line);
        },
        onExit: (code) => {
          this.runtimes.delete(agentId);
          const status = code === 0 ? "stopped" : "error";
          const exited = this.store.update(agentId, {
            status,
            currentTask: null,
          });
          this.bufferAgentUpdated(agentId, exited);
        },
        onError: (error) => {
          this.runtimes.delete(agentId);
          this.bufferLog(agentId, error.message);
          const failed = this.store.update(agentId, {
            status: "error",
            currentTask: error.message,
          });
          this.bufferAgentUpdated(agentId, failed);
          this.bufferEvent(agentId, agentEvent(agentId, "error", error.message, failed));
        },
      });
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

    return events;
  }

  async sendCommand(
    agentId: string,
    request: AgentCommandRequest,
  ): Promise<AgentEvent[]> {
    const agent = this.store.get(agentId);
    if (!agent) return [agentEvent(agentId, "error", "Agent not found")];

    const runtime = this.runtimes.get(agentId);
    if (!runtime) return [agentEvent(agentId, "error", "Agent is not running")];

    const command = request.command.trim();
    if (!command) return [agentEvent(agentId, "error", "Command is required")];

    const events: AgentEvent[] = [agentEvent(agentId, "command", command)];

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

    return events;
  }

  async stopAgent(agentId: string): Promise<AgentEvent[]> {
    const agent = this.store.get(agentId);
    if (!agent) return [agentEvent(agentId, "error", "Agent not found")];

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
    return events;
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
  }

  private drainEvents(agentId: string): AgentEvent[] {
    const events = this.eventBuffers.get(agentId) ?? [];
    this.eventBuffers.delete(agentId);
    return events;
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
): AgentEvent {
  return {
    id: crypto.randomUUID(),
    agentId,
    type,
    message,
    snapshot,
    createdAt: new Date().toISOString(),
  };
}
