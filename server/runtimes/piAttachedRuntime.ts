import type {
  AgentCommandRequest,
  PiBridgeAgentEvent,
  PiBridgeServerMessage,
} from "../../src/shared/contracts";
import type { AgentRuntime, RuntimeStartOptions } from "./types";

export interface PiBridgeSocket {
  readyState: number;
  send(message: string): number | void;
  close(code?: number, reason?: string): void;
}

interface PendingCommand {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const COMMAND_TIMEOUT_MS = 15_000;

export class PiAttachedRuntime implements AgentRuntime {
  readonly kind = "pi" as const;
  readonly messageOwnership = "runtime" as const;
  private options?: RuntimeStartOptions;
  private readonly pending = new Map<string, PendingCommand>();
  private state: "idle" | "busy" = "idle";

  constructor(
    readonly sessionId: string,
    private readonly socket: PiBridgeSocket,
  ) {}

  async start(options: RuntimeStartOptions): Promise<void> {
    this.options = options;
    options.onLine(`[pi-bridge] attached to Pi session ${this.sessionId}`);
    options.onSessionId?.(this.sessionId);
  }

  async send(request: AgentCommandRequest | string): Promise<void> {
    const normalized = typeof request === "string"
      ? { command: request, delivery: "auto" as const }
      : request;
    return this.sendCommand({
      action: "prompt",
      text: normalized.command,
      delivery: normalized.delivery ?? "auto",
    });
  }

  async abort(): Promise<void> {
    return this.sendCommand({ action: "abort" });
  }

  async stop(): Promise<void> {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Pi bridge detached"));
      this.pending.delete(id);
    }
  }

  receiveResult(commandId: string, accepted: boolean, error?: string): void {
    const pending = this.pending.get(commandId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(commandId);
    if (accepted) pending.resolve();
    else pending.reject(new Error(error || "Pi rejected the command"));
  }

  ingest(event: PiBridgeAgentEvent): void {
    const options = this.options;
    if (!options) return;
    switch (event.kind) {
      case "message.start":
        options.onMessageStart?.({ messageId: event.message.id, role: event.message.role });
        if (event.message.content) {
          options.onMessageDelta?.({ messageId: event.message.id, delta: event.message.content });
        }
        return;
      case "message.delta":
        options.onMessageDelta?.({ messageId: event.messageId, delta: event.delta });
        return;
      case "message.end":
        options.onMessageEnd?.({
          messageId: event.message.id,
          content: event.message.content,
          format: event.message.format,
        });
        return;
      case "tool.call":
        options.onToolCall?.({
          messageId: event.messageId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.input,
        });
        return;
      case "tool.result":
        options.onToolResult?.({
          messageId: event.messageId,
          toolCallId: event.toolCallId,
          status: event.status,
          output: event.output,
        });
        return;
      case "state": {
        const previous = this.state;
        this.state = event.state;
        options.onStatusChange?.(event.state);
        if (previous === "busy" && event.state === "idle") options.onTurnComplete?.();
        return;
      }
      case "usage":
        options.onUsage?.({
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cacheReadTokens: event.cacheReadTokens,
          cacheCreationTokens: event.cacheCreationTokens,
          costUSD: event.costUSD,
          contextPercent: event.contextPercent ?? undefined,
        });
        return;
      case "metadata":
        return;
    }
  }

  private sendCommand(input: {
    action: "prompt" | "abort" | "compact";
    text?: string;
    delivery?: "auto" | "steer" | "followUp";
  }): Promise<void> {
    if (this.socket.readyState !== 1) {
      return Promise.reject(new Error("Pi bridge is offline"));
    }
    const commandId = crypto.randomUUID();
    const message: PiBridgeServerMessage = {
      type: "pi.command",
      version: 1,
      commandId,
      ...input,
    };
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        reject(new Error(`Pi command ${commandId} was not acknowledged`));
      }, COMMAND_TIMEOUT_MS);
      timer.unref?.();
      this.pending.set(commandId, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(commandId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
