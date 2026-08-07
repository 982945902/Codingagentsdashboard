import { describe, expect, it } from "bun:test";
import { AgentSupervisor } from "../agentSupervisor";
import { PiBridgeManager } from "../piBridgeManager";
import { createAgentStore } from "../store";
import type { PiBridgeSocket } from "../runtimes/piAttachedRuntime";

class FakeSocket implements PiBridgeSocket {
  readyState = 1;
  sent: string[] = [];
  closed?: { code?: number; reason?: string };
  send(message: string) {
    this.sent.push(message);
  }
  close(code?: number, reason?: string) {
    this.readyState = 3;
    this.closed = { code, reason };
  }
}

const registration = {
  type: "pi.register" as const,
  version: 1 as const,
  token: "bridge-secret",
  sessionId: "pi-session-1",
  hostId: "devbox",
  name: "pi-worker",
  cwd: "/work/project",
  provider: "test-provider",
  model: "test-model",
  thinkingLevel: "medium",
  state: "idle" as const,
  capabilities: {
    prompt: true,
    steer: true,
    followUp: true,
    abort: true,
    compact: true,
    setModel: false,
    setThinkingLevel: true,
    attachments: false,
  },
  snapshot: { messages: [], contextPercent: 12 },
};

async function setup() {
  const store = createAgentStore();
  const supervisor = new AgentSupervisor(store);
  const manager = new PiBridgeManager(store, supervisor, "bridge-secret");
  const socket = new FakeSocket();
  await manager.handleMessage(socket, JSON.stringify(registration));
  const agent = store.list()[0]!;
  return { store, supervisor, manager, socket, agent };
}

describe("Pi bridge manager", () => {
  it("registers an attached Pi session with a deterministic identity", async () => {
    const first = await setup();
    expect(first.agent.id).toStartWith("agent-pi-");
    expect(first.agent.runtimeKind).toBe("pi");
    expect(first.agent.controlMode).toBe("attached");
    expect(first.agent.connectionStatus).toBe("online");
    expect(first.agent.contextUsage).toBe(12);
    expect(first.socket.sent.map((line) => JSON.parse(line).type)).toContain("pi.registered");

    const replacement = new FakeSocket();
    await first.manager.handleMessage(replacement, JSON.stringify(registration));
    expect(first.store.list()).toHaveLength(1);
    expect(first.socket.closed?.code).toBe(4001);
  });

  it("routes dashboard commands to the live Pi connection", async () => {
    const { supervisor, manager, socket, agent } = await setup();
    const sending = supervisor.sendCommand(agent.id, {
      command: "inspect the tests",
      delivery: "steer",
    });
    await Bun.sleep(1);
    const command = socket.sent.map((line) => JSON.parse(line)).find((line) => line.type === "pi.command");
    expect(command).toMatchObject({
      action: "prompt",
      text: "inspect the tests",
      delivery: "steer",
    });

    await manager.handleMessage(socket, JSON.stringify({
      type: "pi.command.result",
      version: 1,
      sessionId: registration.sessionId,
      commandId: command.commandId,
      accepted: true,
    }));
    const events = await sending;
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("ingests Pi messages and marks a disconnected session offline", async () => {
    const { store, manager, socket, agent } = await setup();
    const sendEvent = (sequence: number, event: unknown) => manager.handleMessage(socket, JSON.stringify({
      type: "pi.event",
      version: 1,
      sessionId: registration.sessionId,
      sequence,
      event,
    }));

    await sendEvent(1, { kind: "state", state: "busy" });
    await sendEvent(2, {
      kind: "message.start",
      message: {
        id: "assistant-1",
        role: "assistant",
        content: "",
        format: "markdown",
        streaming: true,
        toolCalls: [],
        createdAt: new Date().toISOString(),
      },
    });
    await sendEvent(3, { kind: "message.delta", messageId: "assistant-1", delta: "hello" });
    await sendEvent(4, {
      kind: "message.end",
      message: {
        id: "assistant-1",
        role: "assistant",
        content: "hello",
        format: "markdown",
        streaming: false,
        toolCalls: [],
        createdAt: new Date().toISOString(),
      },
    });
    await sendEvent(5, { kind: "state", state: "idle" });

    expect(store.get(agent.id)?.messages.at(-1)?.content).toBe("hello");
    expect(store.get(agent.id)?.status).toBe("running");
    manager.disconnect(socket);
    expect(store.get(agent.id)?.connectionStatus).toBe("offline");
    expect(store.get(agent.id)?.status).toBe("paused");
  });

  it("rejects managed lifecycle controls for attached sessions", async () => {
    const { supervisor, store, agent } = await setup();
    expect((await supervisor.startAgent(agent.id))[0]?.type).toBe("error");
    expect((await supervisor.pauseAgent(agent.id))[0]?.type).toBe("error");
    expect((await supervisor.restartAgent(agent.id))[0]?.type).toBe("error");
    expect((await supervisor.stopAgent(agent.id))[0]?.type).toBe("error");
    expect(store.get(agent.id)?.connectionStatus).toBe("online");
  });

  it("rejects an invalid bridge token", async () => {
    const store = createAgentStore();
    const manager = new PiBridgeManager(store, new AgentSupervisor(store), "bridge-secret");
    const socket = new FakeSocket();
    await manager.handleMessage(socket, JSON.stringify({ ...registration, token: "wrong" }));
    expect(socket.closed?.code).toBe(1008);
    expect(store.list()).toHaveLength(0);
  });
});
