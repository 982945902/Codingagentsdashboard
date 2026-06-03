import { describe, expect, it } from "bun:test";
import { createAgentStore } from "../store";

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
    expect(created.logs.at(-1)).toContain("Agent created");
    expect(store.get(created.id)).toEqual(created);
  });

  it("updates agents and appends bounded logs", () => {
    const store = createAgentStore();

    const updated = store.update("agent-003", {
      status: "running",
      currentTask: "Running smoke tests",
    });
    for (let index = 0; index < 35; index += 1) {
      store.appendLog("agent-003", `line ${index}`);
    }

    const snapshot = store.get("agent-003");
    expect(updated?.status).toBe("running");
    expect(snapshot?.currentTask).toBe("Running smoke tests");
    expect(snapshot?.logs).toHaveLength(30);
    expect(snapshot?.logs[0]).toContain("line 5");
  });

  it("returns undefined for unknown updates and logs", () => {
    const store = createAgentStore();

    expect(store.update("missing", { status: "running" })).toBeUndefined();
    expect(store.appendLog("missing", "nope")).toBeUndefined();
  });
});
