import { describe, expect, it } from "bun:test";
import {
  agentCommandSchema,
  createAgentSchema,
  piBridgeClientMessageSchema,
  runtimeKindSchema,
  serverSettingsSchema,
  wsClientMessageSchema,
  wsServerEventSchema,
} from "../../src/shared/contracts";

describe("shared contracts", () => {
  it("accepts supported runtime kinds", () => {
    expect(runtimeKindSchema.parse("codex")).toBe("codex");
    expect(runtimeKindSchema.parse("claude")).toBe("claude");
    expect(runtimeKindSchema.parse("pi")).toBe("pi");
    expect(() => runtimeKindSchema.parse("mock")).toThrow();
  });

  it("defaults agent creation to the real codex runtime", () => {
    const parsed = createAgentSchema.parse({
      name: "Frontend Builder",
      workspacePath: "/tmp/frontend",
      model: "codex",
    });

    expect(parsed.runtimeKind).toBe("codex");
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

  it("accepts approval request and resolved server events", () => {
    const request = wsServerEventSchema.parse({
      type: "agent.approval.request",
      agentId: "agent-1",
      approvalId: "approval-1",
      kind: "command",
      summary: "Run command: rm -rf node_modules",
      details: '{"command":"rm -rf node_modules"}',
    });
    expect(request.type).toBe("agent.approval.request");

    const resolved = wsServerEventSchema.parse({
      type: "agent.approval.resolved",
      agentId: "agent-1",
      approvalId: "approval-1",
      decision: "deny",
    });
    expect(resolved.type).toBe("agent.approval.resolved");
    if (resolved.type === "agent.approval.resolved") {
      expect(resolved.decision).toBe("deny");
    }
  });

  it("accepts an approval response client message and rejects bad decisions", () => {
    const parsed = wsClientMessageSchema.parse({
      type: "agent.approval.response",
      agentId: "agent-1",
      approvalId: "approval-1",
      decision: "allow",
    });
    expect(parsed.type).toBe("agent.approval.response");

    expect(() =>
      wsClientMessageSchema.parse({
        type: "agent.approval.response",
        agentId: "agent-1",
        approvalId: "approval-1",
        decision: "maybe",
      }),
    ).toThrow();
  });

  it("accepts a Pi bridge registration", () => {
    const parsed = piBridgeClientMessageSchema.parse({
      type: "pi.register",
      version: 1,
      token: "secret",
      sessionId: "session-1",
      hostId: "devbox",
      name: "worker",
      cwd: "/work/project",
      provider: "provider",
      model: "model",
      thinkingLevel: "medium",
      state: "idle",
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
      snapshot: { messages: [], contextPercent: 10 },
    });
    expect(parsed.type).toBe("pi.register");
    if (parsed.type === "pi.register") {
      expect(parsed.snapshot.contextPercent).toBe(10);
    }
  });

  it("normalizes server settings", () => {
    const parsed = serverSettingsSchema.parse({
      apiKey: "secret",
    });

    expect(parsed.host).toBe("127.0.0.1");
    expect(parsed.port).toBe(8787);
    expect(parsed.apiKey).toBe("secret");
    expect(parsed.piBridgeToken).toBe("dev-api-key");
    expect(parsed.corsOrigins).toEqual(["*"]);
    expect(parsed.persistencePath).toBe(".data/agents.json");
  });
});
