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
  onTurnComplete?(): void;
}

export interface AgentRuntime {
  readonly kind: RuntimeKind;
  readonly command?: string;
  start(options: RuntimeStartOptions): Promise<void>;
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