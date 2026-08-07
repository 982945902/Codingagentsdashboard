import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentStore } from "../store";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "agents-store-"));
});

afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("agent store", () => {
  it("starts empty by default so production never shows demo agents", () => {
    const store = createAgentStore();

    expect(store.list()).toEqual([]);
  });

  it("creates agents with real runtime defaults", () => {
    const store = createAgentStore();
    const created = store.create({
      name: "Mobile QA",
      workspacePath: "/tmp/mobile",
      model: "codex",
    });

    expect(created.id).toStartWith("agent-");
    expect(created.name).toBe("Mobile QA");
    expect(created.status).toBe("idle");
    expect(created.runtimeKind).toBe("codex");
    expect(created.sessionId).toBeNull();
    expect(created.runtimeArgs).toEqual([]);
    expect(created.logs.at(-1)).toContain("Agent created");
    expect(store.get(created.id)).toEqual(created);
  });

  it("updates agents and appends bounded logs", () => {
    const store = createAgentStore();
    const agent = store.create({
      name: "Testing Bot",
      runtimeKind: "codex",
      workspacePath: "/tmp/testing",
      model: "codex",
    });

    const updated = store.update(agent.id, {
      status: "running",
      currentTask: "Running smoke tests",
    });
    for (let index = 0; index < 250; index += 1) {
      store.appendLog(agent.id, `line ${index}`);
    }

    const snapshot = store.get(agent.id);
    expect(updated?.status).toBe("running");
    expect(snapshot?.currentTask).toBe("Running smoke tests");
    expect(snapshot?.logs).toHaveLength(200);
    expect(snapshot?.logs[0]).toContain("line 50");
  });

  it("returns undefined for unknown updates and logs", () => {
    const store = createAgentStore();

    expect(store.update("missing", { status: "running" })).toBeUndefined();
    expect(store.appendLog("missing", "nope")).toBeUndefined();
    expect(store.delete("missing")).toBe(false);
  });

  it("notifies subscribers on mutations", () => {
    const store = createAgentStore([]);
    const events: string[] = [];
    store.subscribe((evt) => events.push(evt.type));

    const created = store.create({
      name: "Listener Worker",
      runtimeKind: "codex",
      workspacePath: "/tmp/listener",
      model: "codex",
    });
    store.appendLog(created.id, "hi");
    store.update(created.id, { status: "running" });
    store.delete(created.id);

    expect(events).toEqual(["created", "log", "updated", "deleted"]);
  });

  it("accumulates usage deltas and derives cacheHitRate", () => {
    const store = createAgentStore([]);
    const created = store.create({
      name: "Usage Worker",
      runtimeKind: "codex",
      workspacePath: "/tmp/usage",
      model: "codex",
    });

    store.applyUsage(created.id, {
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 100,
      cacheCreationTokens: 5,
      costUSD: 0.25,
    });
    const snapshot = store.applyUsage(created.id, {
      inputTokens: 50,
      outputTokens: 10,
      cacheReadTokens: 350,
    });

    expect(snapshot?.tokenUsage).toEqual({
      input: 150,
      output: 50,
      cacheRead: 450,
      cacheCreation: 5,
    });
    expect(snapshot?.costUSD).toBeCloseTo(0.25);
    // 450 / (150 + 450) = 75%
    expect(snapshot?.cacheHitRate).toBe(75);
    expect(snapshot?.contextUsage).toBe(0);
  });

  it("ignores negative or missing usage fields and clamps contextPercent", () => {
    const store = createAgentStore([]);
    const created = store.create({
      name: "Defensive Usage Worker",
      runtimeKind: "codex",
      workspacePath: "/tmp/defensive",
      model: "codex",
    });

    const snapshot = store.applyUsage(created.id, {
      inputTokens: -5,
      outputTokens: Number.NaN,
      contextPercent: 250,
    });

    expect(snapshot?.tokenUsage).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
    });
    expect(snapshot?.contextUsage).toBe(100);
    expect(store.applyUsage("missing", { inputTokens: 1 })).toBeUndefined();
  });

  it("records api call outcomes", () => {
    const store = createAgentStore([]);
    const created = store.create({
      name: "Api Counter Worker",
      runtimeKind: "codex",
      workspacePath: "/tmp/api-counter",
      model: "codex",
    });

    store.recordApiCall(created.id, "success");
    store.recordApiCall(created.id, "success");
    const snapshot = store.recordApiCall(created.id, "error");

    expect(snapshot?.apiCalls).toEqual({ total: 3, success: 2, errors: 1 });
    expect(store.recordApiCall("missing", "success")).toBeUndefined();
  });

  it("rejects attached Pi agents from the normal creation path", () => {
    const store = createAgentStore();
    expect(() => store.create({
      name: "Invalid Pi",
      runtimeKind: "pi",
      controlMode: "attached",
      workspacePath: "/tmp/pi",
      model: "pi",
    })).toThrow(/Pi bridge/);
  });

  it("persists snapshots to disk and restores them", () => {
    const path = join(tmpDir, "agents.json");
    const initial = createAgentStore({ seed: [], persistencePath: path });
    initial.create({
      name: "Persisted",
      runtimeKind: "codex",
      workspacePath: "/tmp/persist",
      model: "codex",
      sessionId: "sess-keep-me",
    });

    const restored = createAgentStore({ persistencePath: path });
    expect(restored.list()).toHaveLength(1);
    expect(restored.list()[0]?.sessionId).toBe("sess-keep-me");
  });

  it("drops legacy persisted mock agents on restore", () => {
    const path = join(tmpDir, "legacy-agents.json");
    const timestamp = new Date().toISOString();
    writeFileSync(
      path,
      JSON.stringify([
        {
          id: "legacy-mock",
          name: "Legacy Mock",
          runtimeKind: "mock",
          status: "idle",
          currentTask: null,
          uptime: "0m",
          tasksCompleted: 0,
          lastActive: "just now",
          logs: [],
          tokenUsage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 },
          costUSD: 0,
          cacheHitRate: 0,
          apiCalls: { total: 0, success: 0, errors: 0 },
          model: "codex",
          contextUsage: 0,
          workspacePath: "/tmp/legacy-mock",
          sessionId: null,
          runtimeArgs: [],
          messages: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "real-codex",
          name: "Real Codex",
          runtimeKind: "codex",
          status: "idle",
          currentTask: null,
          uptime: "0m",
          tasksCompleted: 0,
          lastActive: "just now",
          logs: [],
          tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
          costUSD: 0,
          cacheHitRate: 0,
          apiCalls: { total: 0, success: 0, errors: 0 },
          model: "codex",
          contextUsage: 0,
          workspacePath: "/tmp/real-codex",
          sessionId: null,
          runtimeArgs: [],
          messages: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ]),
    );

    const restored = createAgentStore({ persistencePath: path });

    expect(restored.list().map((agent) => agent.id)).toEqual(["real-codex"]);
  });
});
