import type {
  AgentCommandRequest,
  AgentSnapshot,
  RuntimeKind,
} from "../../src/shared/contracts";

export interface RuntimeStartOptions {
  agent: AgentSnapshot;
  onLine(line: string): void;
  onExit(code: number | null): void;
  onError?(error: Error): void;
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
}

export type RuntimeFactory = (agent: AgentSnapshot) => AgentRuntime;
