import { describe, expect, it } from "bun:test";
import { createRuntimeForAgent } from "../runtimes/registry";

describe("runtime registry", () => {
  it("maps mock agents to the deterministic mock runtime", () => {
    const runtime = createRuntimeForAgent({
      runtimeKind: "mock",
      sessionId: null,
      runtimeArgs: [],
    });

    expect(runtime.kind).toBe("mock");
  });

  it("maps codex agents to the codex CLI runtime", () => {
    const runtime = createRuntimeForAgent({
      runtimeKind: "codex",
      sessionId: null,
      runtimeArgs: [],
    });

    expect(runtime.kind).toBe("codex");
    expect(runtime.command).toBe("codex");
  });

  it("maps claude agents to the claude CLI runtime", () => {
    const runtime = createRuntimeForAgent({
      runtimeKind: "claude",
      sessionId: "sess-resume-1",
      runtimeArgs: ["--mode", "interactive"],
    });

    expect(runtime.kind).toBe("claude");
    expect(runtime.command).toBe("claude");
  });
});