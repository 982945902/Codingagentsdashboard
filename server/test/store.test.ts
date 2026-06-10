import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
  it("seeds the four dashboard agents", () => {
    const store = createAgentStore();

    expect(store.list()).toHaveLength(4);
    expect(store.get("agent-001")?.name).toBe("Frontend Builder");
    expect(store.get("agent-004")?.status).toBe("error");
  });

  it("creates agents with defaults", () => {
    const store = createAgentStore();
    const created = store.create({
      name: "Mobile QA",
      runtimeKind: "mock",
      workspacePath: "/tmp/mobile",
      model: "codex",
    });

    expect(created.id).toStartWith("agent-");
    expect(created.name).toBe("Mobile QA");
    expect(created.status).toBe("idle");
    expect(created.runtimeKind).toBe("mock");
    expect(created.sessionId).toBeNull();
    expect(created.runtimeArgs).toEqual([]);
    expect(created.logs.at(-1)).toContain("Agent created");
    expect(store.get(created.id)).toEqual(created);
  });

  it("updates agents and appends bounded logs", () => {
    const store = createAgentStore();

    const updated = store.update("agent-003", {
      status: "running",
      currentTask: "Running smoke tests",
    });
    for (let index = 0; index < 250; index += 1) {
      store.appendLog("agent-003", `line ${index}`);
    }

    const snapshot = store.get("agent-003");
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
      runtimeKind: "mock",
      workspacePath: "/tmp/listener",
      model: "codex",
    });
    store.appendLog(created.id, "hi");
    store.update(created.id, { status: "running" });
    store.delete(created.id);

    expect(events).toEqual(["created", "log", "updated", "deleted"]);
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
});