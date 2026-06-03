import { describe, expect, it } from "bun:test";
import {
  agentCommandSchema,
  createAgentSchema,
  runtimeKindSchema,
  serverSettingsSchema,
} from "../../src/shared/contracts";

describe("shared contracts", () => {
  it("accepts supported runtime kinds", () => {
    expect(runtimeKindSchema.parse("mock")).toBe("mock");
    expect(runtimeKindSchema.parse("codex")).toBe("codex");
    expect(runtimeKindSchema.parse("claude")).toBe("claude");
  });

  it("accepts a mock agent creation request", () => {
    const parsed = createAgentSchema.parse({
      name: "Frontend Builder",
      runtimeKind: "mock",
      workspacePath: "/tmp/frontend",
      model: "codex",
    });

    expect(parsed.runtimeKind).toBe("mock");
    expect(parsed.model).toBe("codex");
  });

  it("rejects an unsupported runtime kind", () => {
    expect(() =>
      createAgentSchema.parse({
        name: "Bad Agent",
        runtimeKind: "browser",
        workspacePath: "/tmp/project",
        model: "codex",
      }),
    ).toThrow();
  });

  it("accepts a terminal command payload with attachments", () => {
    const parsed = agentCommandSchema.parse({
      command: "status",
      attachments: [{ name: "notes.txt", size: 12, mimeType: "text/plain" }],
    });

    expect(parsed.command).toBe("status");
    expect(parsed.attachments).toHaveLength(1);
  });

  it("normalizes server settings", () => {
    const parsed = serverSettingsSchema.parse({
      apiKey: "secret",
    });

    expect(parsed.host).toBe("0.0.0.0");
    expect(parsed.port).toBe(8787);
    expect(parsed.apiKey).toBe("secret");
    expect(parsed.corsOrigins).toEqual(["*"]);
  });
});
