import type {
  AgentCommandRequest,
  AgentSnapshot,
  RuntimeKind,
} from "../../src/shared/contracts";

export interface RuntimeMessageStart {
  messageId: string;
  role: "assistant" | "tool" | "system";
}

export interface RuntimeMessageDelta {
  messageId: string;
  delta: string;
}

export interface RuntimeMessageEnd {
  messageId: string;
  /** Final assembled content. Some runtimes only send this without deltas. */
  content: string;
  format?: "text" | "markdown";
}

export interface RuntimeToolCall {
  messageId: string;
  toolCallId: string;
  toolName: string;
  input: string;
}

/**
 * Token/cost usage reported by a runtime. All fields are **deltas** (the
 * increment since the previous onUsage call), never cumulative totals —
 * runtimes that only report running totals must convert before emitting.
 * The supervisor accumulates deltas into the agent snapshot.
 */
export interface RuntimeUsage {
  /** Non-cached input tokens consumed since the last report. */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Cost delta in USD. Leave unset when the runtime reports no pricing. */
  costUSD?: number;
  /** Current context-window utilisation (0-100). Only set with a real basis. */
  contextPercent?: number;
}

/**
 * A runtime-initiated approval request (e.g. codex asking whether a command
 * may run or a patch may be applied). The handler resolves with the user's
 * decision; runtimes fall back to "allow" when no handler answers in time.
 */
export interface RuntimeApprovalRequest {
  approvalId: string;
  /** Coarse category, e.g. "command" or "patch". */
  kind: string;
  /** One-line human-readable description shown in the dashboard. */
  summary: string;
  /** Optional raw detail blob (command line, diff, request params…). */
  details?: string;
}

export interface RuntimeToolResult {
  messageId: string;
  toolCallId: string;
  status: "success" | "error";
  output: string;
}

export interface RuntimeStartOptions {
  agent: AgentSnapshot;
  /** Plain log line (stderr, debug, unknown JSON, etc). */
  onLine(line: string): void;
  onExit(code: number | null): void;
  onError?(error: Error): void;
  /**
   * Called when the runtime detects a session id we should persist for future
   * resumes (e.g. "session abc-123" emitted by codex/claude on startup).
   */
  onSessionId?(sessionId: string): void;
  /** Structured chat events — runtimes that don't support them simply leave them unset. */
  onMessageStart?(event: RuntimeMessageStart): void;
  onMessageDelta?(event: RuntimeMessageDelta): void;
  onMessageEnd?(event: RuntimeMessageEnd): void;
  onToolCall?(event: RuntimeToolCall): void;
  onToolResult?(event: RuntimeToolResult): void;
  /** Incremental usage report — see {@link RuntimeUsage} for delta semantics. */
  onUsage?(usage: RuntimeUsage): void;
  onTurnComplete?(): void;
  /** Ask the user to approve a runtime action — see {@link RuntimeApprovalRequest}. */
  onApprovalRequest?(req: RuntimeApprovalRequest): Promise<"allow" | "deny">;
}

export interface AgentRuntime {
  readonly kind: RuntimeKind;
  readonly command?: string;
  start(options: RuntimeStartOptions): Promise<void>;
  /** Apply mutable agent settings that can take effect without restarting the runtime. */
  configure?(agent: AgentSnapshot): void;
  send(request: AgentCommandRequest | string): Promise<void>;
  stop(): Promise<void>;
}

export interface CliRuntimeOptions {
  kind: Extract<RuntimeKind, "codex" | "claude">;
  command: "codex" | "claude";
  args?: string[];
  /** Resume an existing CLI session id when launching the process. */
  resumeSessionId?: string | null;
}

export type RuntimeFactory = (agent: AgentSnapshot) => AgentRuntime;
