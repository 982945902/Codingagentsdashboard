import { describe, expect, it } from "bun:test";
import { AgentSupervisor } from "../agentSupervisor";
import { createAgentStore } from "../store";
import type { AgentRuntime, RuntimeFactory, RuntimeStartOptions } from "../runtimes/types";

class RecordingRuntime implements AgentRuntime {
  kind = "mock" as const;
  started = false;
  stopped = false;
  sentCommands: string[] = [];
  private onLine?: (line: string) => void;
  private onExit?: (code: number | null) => void;
  private onSessionId?: (sessionId: string) => void;

  async start(options: RuntimeStartOptions) {
    this.started = true;
    this.onLine = options.onLine;
    this.onExit = options.onExit;
    this.onSessionId = options.onSessionId;
    this.onLine("runtime started");
  }

  emitSessionId(id: string) {
    this.onSessionId?.(id);
  }

  async send(request: { command: string } | string) {
    const command = typeof request === "string" ? request : request.command;
    this.sentCommands.push(command);
    this.onLine?.(`echo ${command}`);
  }

  async stop() {
    this.stopped = true;
    this.onExit?.(0);
  }
}

class FailingStartRuntime implements AgentRuntime {
  kind = "mock" as const;

  async start() {
    throw new Error("CLI missing");
  }

  async send() {}

  async stop() {}
}

describe("agent supervisor", () => {
  it("starts an agent, records logs, and emits events", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Mock Worker",
      runtimeKind: "mock",
      workspacePath: "/tmp/mock-worker",
      model: "codex",
    });
    const runtime = new RecordingRuntime();
    const supervisor = new AgentSupervisor(store, () => runtime);

    const events = await supervisor.startAgent(agent.id);

    expect(runtime.started).toBe(true);
    expect(store.get(agent.id)?.status).toBe("running");
    expect(store.get(agent.id)?.logs.at(-1)).toContain("runtime started");
    expect(events.map((event) => event.type)).toEqual([
      "updated",
      "log",
    ]);
  });

  it("sends commands to a running agent and records acknowledgement", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Command Worker",
      runtimeKind: "mock",
      workspacePath: "/tmp/command-worker",
      model: "codex",
    });
    const runtime = new RecordingRuntime();
    const supervisor = new AgentSupervisor(store, () => runtime);

    await supervisor.startAgent(agent.id);
    const events = await supervisor.sendCommand(agent.id, { command: "status" });

    expect(runtime.sentCommands).toEqual(["status"]);
    expect(store.get(agent.id)?.currentTask).toBe("status");
    expect(store.get(agent.id)?.logs.at(-1)).toContain("echo status");
    // The user message must be persisted in the structured chat history.
    const messages = store.get(agent.id)?.messages ?? [];
    expect(messages.at(-1)?.role).toBe("user");
    expect(messages.at(-1)?.content).toBe("status");
   // Event order: command ack → user-message persisted (updated) → currentTask updated → runtime log.
    expect(events.map((event) => event.type)).toEqual([
      "command",
      "updated",
      "updated",
      "log",
    ]);
  });

  it("stops a running agent and releases the runtime", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Stop Worker",
      runtimeKind: "mock",
      workspacePath: "/tmp/stop-worker",
      model: "codex",
    });
    const runtime = new RecordingRuntime();
    const supervisor = new AgentSupervisor(store, () => runtime);

    await supervisor.startAgent(agent.id);
    const events = await supervisor.stopAgent(agent.id);

    expect(runtime.stopped).toBe(true);
    expect(store.get(agent.id)?.status).toBe("stopped");
    expect(events.at(-1)?.type).toBe("updated");
  });

  it("returns command errors for missing or stopped agents", async () => {
    const store = createAgentStore([]);
    const factory: RuntimeFactory = () => new RecordingRuntime();
    const supervisor = new AgentSupervisor(store, factory);

    const missing = await supervisor.sendCommand("missing", { command: "status" });

    expect(missing).toEqual([
      expect.objectContaining({
        type: "error",
        agentId: "missing",
        message: "Agent not found",
      }),
    ]);
  });

  it("marks an agent as errored when runtime startup fails", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Missing CLI Worker",
      runtimeKind: "codex",
      workspacePath: "/tmp/missing-cli-worker",
      model: "codex",
    });
    const supervisor = new AgentSupervisor(store, () => new FailingStartRuntime());

    const events = await supervisor.startAgent(agent.id);

    expect(store.get(agent.id)?.status).toBe("error");
    expect(store.get(agent.id)?.currentTask).toBe("CLI missing");
    expect(events.map((event) => event.type)).toContain("error");
  });

  it("persists session ids reported by the runtime for future resumes", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Codex Worker",
      runtimeKind: "codex",
      workspacePath: "/tmp/codex-worker",
      model: "codex",
    });
    const runtime = new RecordingRuntime();
    const supervisor = new AgentSupervisor(store, () => runtime);

    await supervisor.startAgent(agent.id);
    runtime.emitSessionId("sess-abc-123");

    expect(store.get(agent.id)?.sessionId).toBe("sess-abc-123");
    expect(store.get(agent.id)?.logs.some((line) => line.includes("sess-abc-123"))).toBe(true);
  });

  it("deletes agents and stops their runtime", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Throwaway Worker",
      runtimeKind: "mock",
      workspacePath: "/tmp/throwaway",
      model: "codex",
    });
    const runtime = new RecordingRuntime();
    const supervisor = new AgentSupervisor(store, () => runtime);
    await supervisor.startAgent(agent.id);

    const events = await supervisor.deleteAgent(agent.id);

    expect(runtime.stopped).toBe(true);
    expect(store.get(agent.id)).toBeUndefined();
    expect(events[0]?.type).toBe("deleted");
  });

  it("forwards events to subscribers in real-time", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Subscriber Worker",
      runtimeKind: "mock",
      workspacePath: "/tmp/subscriber",
      model: "codex",
    });
    const runtime = new RecordingRuntime();
    const supervisor = new AgentSupervisor(store, () => runtime);

    const received: string[] = [];
    supervisor.subscribe((evt) => received.push(evt.type));

    await supervisor.startAgent(agent.id);
    await supervisor.sendCommand(agent.id, { command: "status" });

    expect(received).toContain("updated");
    expect(received).toContain("log");
    expect(received).toContain("command");
  });

  it("translates runtime message and tool events into structured chat history", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Chat Worker",
      runtimeKind: "mock",
      workspacePath: "/tmp/chat",
      model: "codex",
    });
    // Use the real MockRuntime so we exercise the new event callbacks end-to-end.
    const { MockRuntime } = await import("../runtimes/mockRuntime");
    const supervisor = new AgentSupervisor(store, () => new MockRuntime());

    const received: string[] = [];
    supervisor.subscribe((evt) => received.push(evt.type));

    await supervisor.startAgent(agent.id);
    await supervisor.sendCommand(agent.id, { command: "status" });

    const messages = store.get(agent.id)?.messages ?? [];
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages.at(-1)?.role).toBe("assistant");
    expect(messages.at(-1)?.streaming).toBe(false);
    expect(messages.at(-1)?.content).toContain("Mock reply");
    expect(messages.at(-1)?.toolCalls?.length ?? 0).toBeGreaterThan(0);
    expect(messages.at(-1)?.toolCalls?.[0]?.status).toBe("success");

    expect(received).toContain("messageStart");
    expect(received).toContain("messageDelta");
    expect(received).toContain("messageEnd");
    expect(received).toContain("toolCall");
    expect(received).toContain("toolResult");
    expect(received).toContain("turnComplete");
  });
});