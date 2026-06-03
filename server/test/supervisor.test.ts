import { describe, expect, it } from "bun:test";
import { AgentSupervisor } from "../agentSupervisor";
import { createAgentStore } from "../store";
import type { AgentRuntime, RuntimeFactory } from "../runtimes/types";

class RecordingRuntime implements AgentRuntime {
  kind = "mock" as const;
  started = false;
  stopped = false;
  sentCommands: string[] = [];
  private onLine?: (line: string) => void;
  private onExit?: (code: number | null) => void;

  async start(options: {
    onLine: (line: string) => void;
    onExit: (code: number | null) => void;
  }) {
    this.started = true;
    this.onLine = options.onLine;
    this.onExit = options.onExit;
    this.onLine("runtime started");
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
    expect(events.map((event) => event.type)).toEqual([
      "command",
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
});
