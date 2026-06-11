import { describe, expect, it } from "bun:test";
import { AgentSupervisor } from "../agentSupervisor";
import { createAgentStore } from "../store";
import type { AgentEvent } from "../../src/shared/contracts";
import type {
  AgentRuntime,
  RuntimeApprovalRequest,
  RuntimeFactory,
  RuntimeStartOptions,
} from "../runtimes/types";

class RecordingRuntime implements AgentRuntime {
  kind = "codex" as const;
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

class UsageRuntime implements AgentRuntime {
  kind = "codex" as const;
  private options?: RuntimeStartOptions;

  async start(options: RuntimeStartOptions) {
    this.options = options;
  }

  async send() {
    this.options?.onUsage?.({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 300,
      cacheCreationTokens: 25,
      costUSD: 0.5,
    });
    this.options?.onTurnComplete?.();
  }

  emitError(message: string) {
    this.options?.onError?.(new Error(message));
  }

  emitContextUsage(percent: number) {
    this.options?.onUsage?.({ outputTokens: 1, contextPercent: percent });
  }

  async stop() {
    this.options?.onExit(0);
  }
}

class ApprovalRuntime implements AgentRuntime {
  kind = "codex" as const;
  private options?: RuntimeStartOptions;

  async start(options: RuntimeStartOptions) {
    this.options = options;
  }

  requestApproval(req: RuntimeApprovalRequest) {
    return this.options!.onApprovalRequest!(req);
  }

  async send() {}

  async stop() {
    this.options?.onExit(0);
  }
}

class FailingStartRuntime implements AgentRuntime {
  kind = "codex" as const;

  async start() {
    throw new Error("CLI missing");
  }

  async send() {}

  async stop() {}
}

class StructuredRuntime implements AgentRuntime {
  kind = "codex" as const;
  private options?: RuntimeStartOptions;

  async start(options: RuntimeStartOptions) {
    this.options = options;
  }

  async send(request: { command: string } | string) {
    const command = typeof request === "string" ? request : request.command;
    const messageId = "structured-message";
    const toolCallId = "structured-tool";
    this.options?.onMessageStart?.({ messageId, role: "assistant" });
    this.options?.onMessageDelta?.({ messageId, delta: `Structured reply to ${command}` });
    this.options?.onToolCall?.({
      messageId,
      toolCallId,
      toolName: "shell",
      input: command,
    });
    this.options?.onToolResult?.({
      messageId,
      toolCallId,
      status: "success",
      output: "ok",
    });
    this.options?.onMessageEnd?.({
      messageId,
      content: `Structured reply to ${command}`,
      format: "markdown",
    });
    this.options?.onTurnComplete?.();
  }

  async stop() {
    this.options?.onExit(0);
  }
}

describe("agent supervisor", () => {
  it("starts an agent, records logs, and emits events", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Mock Worker",
      runtimeKind: "codex",
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
      "updated",
    ]);
  });

  it("sends commands to a running agent and records acknowledgement", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Command Worker",
      runtimeKind: "codex",
      workspacePath: "/tmp/command-worker",
      model: "codex",
    });
    const runtime = new RecordingRuntime();
    const supervisor = new AgentSupervisor(store, () => runtime);

    await supervisor.startAgent(agent.id);
    const events = await supervisor.sendCommand(agent.id, { command: "status" });

    expect(runtime.sentCommands).toEqual(["status"]);
    expect(store.get(agent.id)?.status).toBe("busy");
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
      runtimeKind: "codex",
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

  it("pauses a running agent without clearing its session binding", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Pause Worker",
      runtimeKind: "codex",
      workspacePath: "/tmp/pause-worker",
      model: "codex",
      sessionId: "sess-pause",
    });
    const runtime = new RecordingRuntime();
    const supervisor = new AgentSupervisor(store, () => runtime);

    await supervisor.startAgent(agent.id);
    const events = await supervisor.pauseAgent(agent.id);

    expect(runtime.stopped).toBe(true);
    expect(store.get(agent.id)?.status).toBe("paused");
    expect(store.get(agent.id)?.sessionId).toBe("sess-pause");
    expect(events.at(-1)?.snapshot?.status).toBe("paused");
  });

  it("restarts an agent on the same session", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Restart Worker",
      runtimeKind: "codex",
      workspacePath: "/tmp/restart-worker",
      model: "codex",
      sessionId: "sess-restart",
    });
    const runtimes: RecordingRuntime[] = [];
    const supervisor = new AgentSupervisor(store, () => {
      const runtime = new RecordingRuntime();
      runtimes.push(runtime);
      return runtime;
    });

    await supervisor.startAgent(agent.id);
    const events = await supervisor.restartAgent(agent.id);

    expect(runtimes).toHaveLength(2);
    expect(runtimes[0]?.stopped).toBe(true);
    expect(runtimes[1]?.started).toBe(true);
    expect(store.get(agent.id)?.status).toBe("running");
    expect(store.get(agent.id)?.sessionId).toBe("sess-restart");
    expect(events.at(-1)?.snapshot?.status).toBe("running");
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

  it("handles dashboard slash commands as native agent configuration", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Configurable Worker",
      runtimeKind: "codex",
      workspacePath: "/tmp/configurable-worker",
      model: "codex",
    });
    const runtime = new RecordingRuntime();
    const supervisor = new AgentSupervisor(store, () => runtime);

    const events = await supervisor.sendCommand(agent.id, { command: "/model gpt-5.1-codex" });

    expect(runtime.sentCommands).toEqual([]);
    expect(store.get(agent.id)?.model).toBe("gpt-5.1-codex");
    expect(store.get(agent.id)?.logs.at(-1)).toContain("model set to gpt-5.1-codex");
    expect(events.map((event) => event.type)).toContain("updated");
  });

  it("restarts running agents for slash commands that change session or workspace", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Restartable Worker",
      runtimeKind: "codex",
      workspacePath: "/tmp/restartable-worker",
      model: "codex",
      sessionId: "old-session",
    });
    const runtimes: RecordingRuntime[] = [];
    const supervisor = new AgentSupervisor(store, () => {
      const runtime = new RecordingRuntime();
      runtimes.push(runtime);
      return runtime;
    });

    await supervisor.startAgent(agent.id);
    await supervisor.sendCommand(agent.id, { command: "/resume new-session" });
    await supervisor.sendCommand(agent.id, { command: "/dir /tmp/new-workspace" });
    await supervisor.sendCommand(agent.id, { command: "/new-session" });

    expect(runtimes).toHaveLength(4);
    expect(runtimes.slice(0, 3).every((runtime) => runtime.stopped)).toBe(true);
    expect(runtimes.every((runtime) => runtime.sentCommands.length === 0)).toBe(true);
    expect(store.get(agent.id)?.status).toBe("running");
    expect(store.get(agent.id)?.sessionId).toBe(null);
    expect(store.get(agent.id)?.workspacePath).toBe("/tmp/new-workspace");
  });

  it("deletes agents and stops their runtime", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Throwaway Worker",
      runtimeKind: "codex",
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
      runtimeKind: "codex",
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
      runtimeKind: "codex",
      workspacePath: "/tmp/chat",
      model: "codex",
    });
    const supervisor = new AgentSupervisor(store, () => new StructuredRuntime());

    const received: string[] = [];
    supervisor.subscribe((evt) => received.push(evt.type));

    await supervisor.startAgent(agent.id);
    await supervisor.sendCommand(agent.id, { command: "status" });

    const messages = store.get(agent.id)?.messages ?? [];
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages.at(-1)?.role).toBe("assistant");
    expect(messages.at(-1)?.streaming).toBe(false);
    expect(messages.at(-1)?.content).toContain("Structured reply");
    expect(messages.at(-1)?.toolCalls?.length ?? 0).toBeGreaterThan(0);
    expect(messages.at(-1)?.toolCalls?.[0]?.status).toBe("success");

    expect(received).toContain("messageStart");
    expect(received).toContain("messageDelta");
    expect(received).toContain("messageEnd");
    expect(received).toContain("toolCall");
    expect(received).toContain("toolResult");
    expect(received).toContain("turnComplete");
  });

  it("accumulates runtime usage deltas and derives cacheHitRate", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Usage Worker",
      runtimeKind: "codex",
      workspacePath: "/tmp/usage",
      model: "codex",
    });
    const runtime = new UsageRuntime();
    const supervisor = new AgentSupervisor(store, () => runtime);

    await supervisor.startAgent(agent.id);
    await supervisor.sendCommand(agent.id, { command: "one" });
    await supervisor.sendCommand(agent.id, { command: "two" });

    const snapshot = store.get(agent.id);
    expect(snapshot?.tokenUsage).toEqual({
      input: 200,
      output: 100,
      cacheRead: 600,
      cacheCreation: 50,
    });
    expect(snapshot?.costUSD).toBeCloseTo(1.0);
    // cacheRead / (input + cacheRead) = 600 / 800
    expect(snapshot?.cacheHitRate).toBe(75);
    expect(snapshot?.apiCalls).toEqual({ total: 2, success: 2, errors: 0 });
    expect(snapshot?.status).toBe("running");
    expect(snapshot?.currentTask).toBe(null);
    expect(snapshot?.tasksCompleted).toBe(2);
    // No real basis was reported, so contextUsage stays at 0.
    expect(snapshot?.contextUsage).toBe(0);
  });

  it("passes attachment content to the runtime prompt", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Attachment Worker",
      runtimeKind: "codex",
      workspacePath: "/tmp/attachment-worker",
      model: "codex",
    });
    const runtime = new RecordingRuntime();
    const supervisor = new AgentSupervisor(store, () => runtime);

    await supervisor.startAgent(agent.id);
    await supervisor.sendCommand(agent.id, {
      command: "summarize",
      attachments: [
        {
          name: "notes.txt",
          size: 11,
          mimeType: "text/plain",
          encoding: "text",
          content: "hello world",
        },
      ],
    });

    expect(runtime.sentCommands[0]).toContain("summarize");
    expect(runtime.sentCommands[0]).toContain("notes.txt");
    expect(runtime.sentCommands[0]).toContain("hello world");
    expect(store.get(agent.id)?.messages.at(-1)?.content).toContain("notes.txt");
  });

  it("broadcasts updated snapshots when usage arrives", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Usage Broadcast Worker",
      runtimeKind: "codex",
      workspacePath: "/tmp/usage-broadcast",
      model: "codex",
    });
    const runtime = new UsageRuntime();
    const supervisor = new AgentSupervisor(store, () => runtime);
    await supervisor.startAgent(agent.id);

    const updatedTokens: number[] = [];
    supervisor.subscribe((evt) => {
      if (evt.type === "updated" && evt.snapshot) {
        updatedTokens.push(evt.snapshot.tokenUsage.input);
      }
    });

    await supervisor.sendCommand(agent.id, { command: "go" });

    expect(updatedTokens).toContain(100);
  });

  it("updates contextUsage only when the runtime reports a basis", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Context Worker",
      runtimeKind: "codex",
      workspacePath: "/tmp/context",
      model: "codex",
    });
    const runtime = new UsageRuntime();
    const supervisor = new AgentSupervisor(store, () => runtime);
    await supervisor.startAgent(agent.id);

    runtime.emitContextUsage(42);

    expect(store.get(agent.id)?.contextUsage).toBe(42);
  });

  it("counts runtime errors in apiCalls.errors", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Error Counter Worker",
      runtimeKind: "codex",
      workspacePath: "/tmp/error-counter",
      model: "codex",
    });
    const runtime = new UsageRuntime();
    const supervisor = new AgentSupervisor(store, () => runtime);
    await supervisor.startAgent(agent.id);

    runtime.emitError("boom");

    const snapshot = store.get(agent.id);
    expect(snapshot?.apiCalls).toEqual({ total: 1, success: 0, errors: 1 });
    expect(snapshot?.status).toBe("error");
  });

  it("round-trips a runtime approval request through respondToApproval", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Approval Worker",
      runtimeKind: "codex",
      workspacePath: "/tmp/approval",
      model: "codex",
    });
    const runtime = new ApprovalRuntime();
    const supervisor = new AgentSupervisor(store, () => runtime, {
      approvalTimeoutMs: 5_000,
    });
    await supervisor.startAgent(agent.id);

    const received: AgentEvent[] = [];
    supervisor.subscribe((evt) => received.push(evt));

    const decision = runtime.requestApproval({
      approvalId: "approval-1",
      kind: "command",
      summary: "Run command: rm -rf /tmp/scratch",
      details: '{"command":"rm -rf /tmp/scratch"}',
    });

    const request = received.find((evt) => evt.type === "approvalRequest");
    expect(request?.payload?.approvalId).toBe("approval-1");
    expect(request?.payload?.approvalKind).toBe("command");
    expect(request?.payload?.approvalSummary).toContain("rm -rf");

    expect(supervisor.respondToApproval(agent.id, "approval-1", "deny")).toBe(true);
    expect(await decision).toBe("deny");

    const resolved = received.find((evt) => evt.type === "approvalResolved");
    expect(resolved?.payload?.approvalId).toBe("approval-1");
    expect(resolved?.payload?.approvalDecision).toBe("deny");

    // Already settled — a second answer must be rejected.
    expect(supervisor.respondToApproval(agent.id, "approval-1", "allow")).toBe(false);
  });

  it("falls back to allow when an approval times out", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Approval Timeout Worker",
      runtimeKind: "codex",
      workspacePath: "/tmp/approval-timeout",
      model: "codex",
    });
    const runtime = new ApprovalRuntime();
    const supervisor = new AgentSupervisor(store, () => runtime, {
      approvalTimeoutMs: 20,
    });
    await supervisor.startAgent(agent.id);

    const received: AgentEvent[] = [];
    supervisor.subscribe((evt) => received.push(evt));

    const decision = await runtime.requestApproval({
      approvalId: "approval-timeout",
      kind: "patch",
      summary: "Apply patch to src/index.ts",
    });

    expect(decision).toBe("allow");
    const resolved = received.find((evt) => evt.type === "approvalResolved");
    expect(resolved?.payload?.approvalId).toBe("approval-timeout");
    expect(resolved?.payload?.approvalDecision).toBe("allow");
    expect(
      store.get(agent.id)?.logs.some((line) => line.includes("falling back to allow")),
    ).toBe(true);
    // The timed-out approval can no longer be answered.
    expect(supervisor.respondToApproval(agent.id, "approval-timeout", "deny")).toBe(false);
  });

  it("emits usage from a runtime", async () => {
    const store = createAgentStore([]);
    const agent = store.create({
      name: "Usage Worker",
      runtimeKind: "codex",
      workspacePath: "/tmp/runtime-usage",
      model: "codex",
    });
    const supervisor = new AgentSupervisor(store, () => new UsageRuntime());

    await supervisor.startAgent(agent.id);
    await supervisor.sendCommand(agent.id, { command: "hello" });

    const snapshot = store.get(agent.id);
    expect(snapshot?.tokenUsage.input).toBe(100);
    expect(snapshot?.tokenUsage.output).toBe(50);
    expect(snapshot?.tokenUsage.cacheRead).toBe(300);
    expect(snapshot?.tokenUsage.cacheCreation).toBe(25);
    expect(snapshot?.costUSD).toBeCloseTo(0.5);
    expect(snapshot?.apiCalls).toEqual({ total: 1, success: 1, errors: 0 });
  });
});
