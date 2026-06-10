import type { AgentCommandRequest, RuntimeKind } from "../../src/shared/contracts";
import type { AgentRuntime, RuntimeStartOptions } from "./types";

/**
 * Deterministic in-memory runtime used for development and tests.
 * Emits both legacy log lines (so log-only tests stay green) and the new
 * structured message events (so the chat UI can render cards without a real CLI).
 */
export class MockRuntime implements AgentRuntime {
  readonly kind: RuntimeKind = "mock";
  private options?: RuntimeStartOptions;
  private started = false;

  async start(options: RuntimeStartOptions): Promise<void> {
    this.started = true;
    this.options = options;
    this.emitLine(`mock:${options.agent.id}:started`);
    this.emitLine(`mock:${options.agent.id}:workspace:${options.agent.workspacePath}`);
    this.emitLine(`mock:${options.agent.id}:ready`);
  }

  async send(request: AgentCommandRequest | string): Promise<void> {
    this.assertStarted();
    const command = typeof request === "string" ? request : request.command;
    this.emitLine(`mock:command:${command}`);

    const messageId = `msg-${crypto.randomUUID()}`;
    this.options?.onMessageStart?.({ messageId, role: "assistant" });

    const reply = `**Mock reply** to: \`${command}\`\n\nThis is a deterministic stub used while no real Codex/Claude CLI is wired in.`;
    // Stream the reply as a few deltas so the UI animates.
    for (const chunk of chunkText(reply, 24)) {
      this.options?.onMessageDelta?.({ messageId, delta: chunk });
    }
    this.options?.onMessageEnd?.({ messageId, content: reply, format: "markdown" });

    // Demonstrate a tool-call card occasionally.
    if (command.toLowerCase().includes("status")) {
      const toolCallId = `tool-${crypto.randomUUID()}`;
      this.options?.onToolCall?.({
        messageId,
        toolCallId,
        toolName: "shell",
        input: "uptime",
      });
      this.options?.onToolResult?.({
        messageId,
        toolCallId,
        status: "success",
        output: "load average: 0.42, 0.36, 0.31",
      });
    }

    this.emitLine("mock:complete");
    this.options?.onTurnComplete?.();
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.emitLine("mock:stopped");
    this.started = false;
    this.options?.onExit(0);
  }

  private emitLine(line: string) {
    this.options?.onLine(line);
  }

  private assertStarted() {
    if (!this.started) {
      throw new Error("Mock runtime has not been started");
    }
  }
}

function chunkText(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}