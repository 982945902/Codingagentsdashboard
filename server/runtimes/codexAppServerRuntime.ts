import type { AgentCommandRequest, RuntimeKind } from "../../src/shared/contracts";
import { resolveWorkspacePath } from "./paths";
import type { AgentRuntime, RuntimeStartOptions } from "./types";

/**
 * Long-lived `codex app-server` subprocess driven over JSON-RPC 2.0 (stdio).
 *
 * This mirrors cc-connect's `agent/codex/appserver_session.go` backend = "app_server":
 *   1. spawn `codex app-server -c model=.. -c openai_base_url=..` once per agent
 *   2. JSON-RPC: initialize → initialized → thread/start or thread/resume(threadId)
 *   3. each user prompt = turn/start { threadId, input:[{type:"text",text}], approvalPolicy }
 *   4. inbound notifications: turn/{started,completed}, item/{started,completed},
 *      thread/status/changed → idle, error
 *   5. inbound server-initiated requests (approvals) → auto-allow for now
 *
 * Unlike `CodexExecRuntime`, the codex process **does not exit between turns** —
 * the same `thread_id` is reused, so codex keeps its in-memory context.
 */

interface CliSubprocess {
  stdin: { write(chunk: string | Uint8Array): number | Promise<number>; flush(): void | Promise<void>; end(): void | Promise<void> };
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(signal?: number | string): void;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

type RpcEnvelope = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

const REQUEST_TIMEOUT_MS = 120_000;

export class CodexAppServerRuntime implements AgentRuntime {
  readonly kind: RuntimeKind = "codex";
  readonly command = "codex" as const;

  private options?: RuntimeStartOptions;
  private proc?: CliSubprocess;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private buffer = "";

  private workspacePath = ".";
  private model: string | null = null;
  private extraArgs: string[];
  private resumeThreadId: string | null;
  private threadId: string | null = null;
  private binary = process.env.CODEX_BIN?.trim() || "codex";

  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private currentTurn: {
    messageId: string;
    started: boolean;
    aggregated: string;
  } | null = null;
  /**
   * Promise resolved once the JSON-RPC handshake + thread/start finishes.
   * `send()` awaits it so the very first user prompt can land before
   * the supervisor's start() Promise has fully unblocked.
   */
  private threadReady?: Promise<void>;
  private threadReadyResolve?: () => void;
  private threadReadyReject?: (err: Error) => void;

  constructor(opts: { args?: string[]; resumeSessionId?: string | null } = {}) {
    this.extraArgs = opts.args ?? [];
    this.resumeThreadId = opts.resumeSessionId ?? null;
  }

  async start(options: RuntimeStartOptions): Promise<void> {
    this.options = options;
    this.threadReady = new Promise<void>((resolve, reject) => {
      this.threadReadyResolve = resolve;
      this.threadReadyReject = reject;
    });
    try {
      this.workspacePath = resolveWorkspacePath(options.agent.workspacePath);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      options.onError?.(new Error(msg));
      this.threadReadyReject?.(new Error(msg));
      return;
    }
    this.model = options.agent.model || null;
    if (options.agent.sessionId && !this.resumeThreadId) {
      this.resumeThreadId = options.agent.sessionId;
    }

    const args = ["app-server", ...this.buildContextArgs(), ...this.extraArgs];
    options.onLine(`[codex] spawn ${this.binary} ${args.join(" ")} (cwd=${this.workspacePath})`);

    let proc: CliSubprocess;
    try {
      proc = Bun.spawn([this.binary, ...args], {
        cwd: this.workspacePath,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      }) as unknown as CliSubprocess;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      options.onError?.(new Error(`codex app-server could not be started: ${msg}`));
      this.threadReadyReject?.(new Error(msg));
      return;
    }
    this.proc = proc;

    void this.readStdout();
    void this.readStderr();
    void this.watchExit();

    try {
      await this.rpcRequest("initialize", {
        clientInfo: {
          name: "coding-agents-dashboard",
          title: "Coding Agents Dashboard",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
          optOutNotificationMethods: [
            "command/exec/outputDelta",
            "item/agentMessage/delta",
            "item/plan/delta",
            "item/fileChange/outputDelta",
            "item/reasoning/summaryTextDelta",
            "item/reasoning/textDelta",
          ],
        },
      });
      this.rpcNotify("initialized", {});

      await this.openOrResumeThread();
      this.threadReadyResolve?.();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      options.onError?.(new Error(`codex app-server handshake failed: ${msg}`));
      this.threadReadyReject?.(new Error(msg));
      await this.stop();
    }
  }

  private buildContextArgs(): string[] {
    const args: string[] = [];
    if (this.model && this.isRealModelSlug(this.model)) {
      args.push("-c", `model="${this.model}"`);
    }
    return args;
  }

  /** "codex" / "claude" 是 runtimeKind 默认占位，不是真实 model slug；过滤掉。 */
  private isRealModelSlug(name: string): boolean {
    const n = name.trim().toLowerCase();
    if (!n || n === "codex" || n === "claude") return false;
    return true;
  }

  private async openOrResumeThread(): Promise<void> {
    const params: Record<string, unknown> = {
      experimentalRawEvents: false,
      persistExtendedHistory: false,
      approvalPolicy: "never",
      sandbox: "workspace-write",
    };
    if (this.model && this.isRealModelSlug(this.model)) params.model = this.model;

    let resp: any;
    if (this.resumeThreadId) {
      resp = await this.rpcRequest("thread/resume", {
        ...params,
        threadId: this.resumeThreadId,
        persistExtendedHistory: true,
      });
    } else {
      resp = await this.rpcRequest("thread/start", params);
    }
    const id = resp?.thread?.id;
    if (typeof id !== "string" || !id) {
      throw new Error("codex app-server returned empty thread id");
    }
    this.threadId = id;
    this.options?.onSessionId?.(id);
    this.options?.onLine(`[codex] thread ${this.resumeThreadId ? "resumed" : "started"} ${id}`);
  }

  async send(request: AgentCommandRequest | string): Promise<void> {
    if (!this.options) throw new Error("CodexAppServerRuntime has not been started");
    // Block until initialize + thread/start finishes (or fails). This makes
    // a prompt sent right after agent.start() wait for the handshake instead
    // of erroring out with "codex thread is not ready".
    if (this.threadReady) {
      try {
        await this.threadReady;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.options.onError?.(new Error(`codex thread not ready: ${msg}`));
        return;
      }
    }
    if (!this.threadId) throw new Error("codex thread is not ready");

    const prompt = (typeof request === "string" ? request : request.command).trim();
    if (!prompt) return;

    const messageId = `msg-${crypto.randomUUID()}`;
    this.currentTurn = { messageId, started: false, aggregated: "" };

    try {
      await this.rpcRequest("turn/start", {
        threadId: this.threadId,
        input: [{ type: "text", text: prompt, text_elements: [] }],
        ...(this.model && this.isRealModelSlug(this.model) ? { model: this.model } : {}),
        approvalPolicy: "never",
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.options.onError?.(new Error(`codex turn/start failed: ${msg}`));
      this.currentTurn = null;
    }
  }

  async stop(): Promise<void> {
    if (this.proc) {
      try {
        this.proc.stdin.end();
      } catch {
        // ignore
      }
      try {
        this.proc.kill();
      } catch {
        // ignore
      }
      this.proc = undefined;
    }
    for (const { reject } of this.pending.values()) {
      reject(new Error("codex app-server stopped"));
    }
    this.pending.clear();
  }

  // ── stdio plumbing ────────────────────────────────────────────────

  private async readStdout(): Promise<void> {
    if (!this.proc) return;
    const reader = (this.proc.stdout as unknown as ReadableStream<Uint8Array>).getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      this.buffer += this.decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) this.dispatchLine(line);
      }
    }
  }

  private async readStderr(): Promise<void> {
    if (!this.proc) return;
    const reader = (this.proc.stderr as unknown as ReadableStream<Uint8Array>).getReader();
    let pending = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += this.decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, nl).trimEnd();
        pending = pending.slice(nl + 1);
        if (line) this.options?.onLine(`[codex stderr] ${line}`);
      }
    }
  }

  private async watchExit(): Promise<void> {
    if (!this.proc) return;
    try {
      const code = await this.proc.exited;
      this.options?.onLine(`[codex] app-server exited code=${code}`);
      this.options?.onExit(code);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.options?.onError?.(new Error(`codex app-server crashed: ${msg}`));
    }
  }

  private dispatchLine(raw: string): void {
    let env: RpcEnvelope;
    try {
      env = JSON.parse(raw);
    } catch {
      this.options?.onLine(`[codex] ${raw}`);
      return;
    }

    const hasId = env.id !== undefined && env.id !== null;
    const hasMethod = typeof env.method === "string";

    if (hasId && !hasMethod) {
      this.handleResponse(env);
      return;
    }
    if (hasId && hasMethod) {
      this.handleServerRequest(env);
      return;
    }
    if (hasMethod) {
      this.handleNotification(env.method as string, env.params);
    }
  }

  private handleResponse(env: RpcEnvelope): void {
    const id = typeof env.id === "number" ? env.id : Number(env.id);
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (env.error) {
      pending.reject(new Error(env.error.message || `rpc error ${env.error.code ?? ""}`));
    } else {
      pending.resolve(env.result);
    }
  }

  private handleServerRequest(env: RpcEnvelope): void {
    // Approvals & permissions — auto-allow for now (mode = workspace-write/never).
    // We still respond so codex doesn't hang waiting.
    const method = env.method ?? "";
    let result: Record<string, unknown> = { decision: "accept" };
    if (method === "item/permissions/requestApproval") {
      const params = (env.params ?? {}) as Record<string, unknown>;
      result = { permissions: params.permissions ?? {}, scope: "turn" };
    } else if (method === "item/tool/requestUserInput") {
      result = { answers: {} };
    } else if (method === "item/tool/call") {
      result = {
        success: false,
        contentItems: [{ type: "inputText", text: "tool not available" }],
      };
    }
    this.writeJson({ jsonrpc: "2.0", id: env.id ?? null, result });
  }

  private handleNotification(method: string, paramsRaw: unknown): void {
    const params = (paramsRaw ?? {}) as Record<string, any>;
    switch (method) {
      case "turn/started":
        this.ensureTurnStarted();
        break;
      case "item/completed": {
        const item = (params.item ?? {}) as Record<string, any>;
        const type = String(item.type ?? "");
        if (type === "agentMessage") {
          const text = typeof item.text === "string" ? item.text : "";
          if (text) this.appendDelta(text);
        } else if (type === "reasoning") {
          // Surface reasoning summary as a log line instead of message body.
          const summary = Array.isArray(item.summary) ? item.summary.join("\n") : "";
          if (summary) this.options?.onLine(`[codex reasoning] ${summary}`);
        } else if (type === "commandExecution") {
          const cmd = String(item.command ?? "");
          const out = String(item.aggregatedOutput ?? "");
          this.emitToolEvent("Bash", cmd, out, item.exitCode);
        } else if (type === "mcpToolCall" || type === "webSearch" || type === "fileChange") {
          this.emitToolEvent(type, JSON.stringify(item).slice(0, 500), "", undefined);
        }
        break;
      }
      case "turn/completed":
      case "thread/status/changed":
        // codex 0.125+ uses thread/status/changed = idle to signal turn end.
        if (method === "thread/status/changed" && params?.status?.type !== "idle") break;
        this.completeTurn();
        break;
      case "error": {
        const msg = String(params.message ?? "unknown");
        this.options?.onError?.(new Error(`codex: ${msg}`));
        break;
      }
      default:
        // Silent for noisy delta/usage notifications we opted out of.
        break;
    }
  }

  private ensureTurnStarted(): void {
    if (!this.currentTurn || this.currentTurn.started) return;
    this.currentTurn.started = true;
    this.options?.onMessageStart?.({ messageId: this.currentTurn.messageId, role: "assistant" });
  }

  private appendDelta(text: string): void {
    if (!this.currentTurn) return;
    this.ensureTurnStarted();
    this.currentTurn.aggregated += text;
    this.options?.onMessageDelta?.({ messageId: this.currentTurn.messageId, delta: text });
  }

  private completeTurn(): void {
    if (!this.currentTurn) return;
    const { messageId, started, aggregated } = this.currentTurn;
    if (started) {
      this.options?.onMessageEnd?.({
        messageId,
        content: aggregated,
        format: "markdown",
      });
    }
    this.options?.onTurnComplete?.();
    this.currentTurn = null;
  }

  private emitToolEvent(name: string, input: string, output: string, exitCode: unknown): void {
    if (!this.currentTurn) return;
    const toolCallId = `tool-${crypto.randomUUID()}`;
    this.options?.onToolCall?.({
      messageId: this.currentTurn.messageId,
      toolCallId,
      toolName: name,
      input: input.slice(0, 2000),
    });
    const status = typeof exitCode === "number" ? (exitCode === 0 ? "success" : "error") : "success";
    this.options?.onToolResult?.({
      messageId: this.currentTurn.messageId,
      toolCallId,
      status,
      output: output.slice(0, 2000),
    });
  }

  // ── RPC helpers ───────────────────────────────────────────────────

  private rpcRequest(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    const promise = new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, REQUEST_TIMEOUT_MS);
      // Best-effort cleanup
      Promise.resolve().then(() => timer.unref?.());
    });
    this.writeJson({ jsonrpc: "2.0", id, method, params });
    return promise;
  }

  private rpcNotify(method: string, params: unknown): void {
    this.writeJson({ jsonrpc: "2.0", method, params });
  }

  private writeJson(payload: unknown): void {
    if (!this.proc) return;
    const line = JSON.stringify(payload) + "\n";
    try {
      this.proc.stdin.write(this.encoder.encode(line));
      const flushed = this.proc.stdin.flush();
      if (flushed && typeof (flushed as Promise<unknown>).then === "function") {
        void (flushed as Promise<unknown>).catch(() => {});
      }
    } catch (err) {
      this.options?.onError?.(new Error(`codex stdin write failed: ${err}`));
    }
  }
}