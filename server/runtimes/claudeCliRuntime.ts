import type { AgentCommandRequest, RuntimeKind } from "../../src/shared/contracts";
import { resolveWorkspacePath } from "./paths";
import type { AgentRuntime, RuntimeStartOptions } from "./types";

interface CliSubprocess {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(signal?: number | string): void;
}

/**
 * Claude Code CLI exposes a non-interactive print mode that streams JSON
 * events: `claude -p --output-format stream-json [--resume <id>] "<prompt>"`.
 * Each user prompt becomes one subprocess; we translate the events into the
 * shared runtime callbacks.
 */
export class ClaudeCliRuntime implements AgentRuntime {
  readonly kind: RuntimeKind = "claude";
  readonly command = "claude" as const;

  private options?: RuntimeStartOptions;
  private current?: CliSubprocess;
  private resumeSessionId: string | null;
  private extraArgs: string[];
  private decoder = new TextDecoder();
  private workspacePath = ".";
  private binary = process.env.CLAUDE_BIN?.trim() || "claude";

  constructor(opts: { args?: string[]; resumeSessionId?: string | null } = {}) {
    this.extraArgs = opts.args ?? [];
    this.resumeSessionId = opts.resumeSessionId ?? null;
  }

  async start(options: RuntimeStartOptions): Promise<void> {
    this.options = options;
    try {
      this.workspacePath = resolveWorkspacePath(options.agent.workspacePath);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      options.onError?.(new Error(msg));
      return;
    }
    if (options.agent.sessionId && !this.resumeSessionId) {
      this.resumeSessionId = options.agent.sessionId;
    }
    options.onLine(`[claude] runtime ready (cwd=${this.workspacePath})`);
  }

  async send(request: AgentCommandRequest | string): Promise<void> {
    if (!this.options) throw new Error("ClaudeCliRuntime has not been started");
    const prompt = (typeof request === "string" ? request : request.command).trim();
    if (!prompt) return;

    if (this.current) {
      this.options.onLine("[claude] previous turn still running, waiting…");
      try {
        await this.current.exited;
      } catch {
        // ignore
      }
    }

    const args = this.buildArgs(prompt);
    this.options.onLine(`[claude] ${args.join(" ")}`);

    let proc: CliSubprocess;
    try {
      proc = Bun.spawn([this.binary, ...args], {
        cwd: this.workspacePath,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      }) as CliSubprocess;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.options.onError?.(new Error(`claude CLI could not be started: ${msg}`));
      return;
    }
    this.current = proc;

    const messageId = `msg-${crypto.randomUUID()}`;
    let started = false;
    let aggregated = "";
    const ensureStarted = () => {
      if (started) return;
      started = true;
      this.options?.onMessageStart?.({ messageId, role: "assistant" });
    };

    void this.readJsonLines(proc.stdout, (json, raw) => {
      this.handleClaudeEvent(json, raw, {
        messageId,
        ensureStarted,
        appendDelta: (delta) => {
          if (!delta) return;
          aggregated += delta;
          this.options?.onMessageDelta?.({ messageId, delta });
        },
        hasContent: () => aggregated.length > 0,
      });
    });
    void this.readLines(proc.stderr, (line) => {
      this.options?.onLine(`[claude stderr] ${line}`);
    });

    try {
      const code = await proc.exited;
      if (started) {
        this.options.onMessageEnd?.({
          messageId,
          content: aggregated,
          format: "markdown",
        });
      }
      this.options.onTurnComplete?.();
      if (code !== 0) this.options.onLine(`[claude] exit code ${code}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.options.onError?.(new Error(`claude run failed: ${msg}`));
    } finally {
      this.current = undefined;
    }
  }

  async stop(): Promise<void> {
    if (this.current) {
      try { this.current.kill(); } catch { /* ignore */ }
      this.current = undefined;
    }
    this.options?.onExit(0);
  }

  private buildArgs(prompt: string): string[] {
    // `--output-format stream-json` requires `--verbose` in claude-code 2.x.
    const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
    if (this.resumeSessionId) {
      args.push("--resume", this.resumeSessionId);
    }
    if (this.extraArgs.length > 0) args.push(...this.extraArgs);
    return args;
  }

  private handleClaudeEvent(
    json: Record<string, unknown>,
    raw: string,
    ctx: {
      messageId: string;
      ensureStarted: () => void;
      appendDelta: (d: string) => void;
      hasContent: () => boolean;
    },
  ) {
    const type = String(json.type ?? "").toLowerCase();
    const sessionId =
      (json.session_id as string | undefined) ??
      ((json.session as Record<string, unknown> | undefined)?.id as string | undefined);
    if (sessionId) {
      this.resumeSessionId = sessionId;
      this.options?.onSessionId?.(sessionId);
    }

    if (type === "system" && json.subtype === "init") {
      // initialization event — nothing to forward beyond session id (handled above)
      return;
    }
    if (type === "assistant" || type === "message" || type === "agent_message") {
      const text = extractText(json);
      if (text) {
        ctx.ensureStarted();
        ctx.appendDelta(text);
      }
      return;
    }
    if (type === "delta" || type.includes("_delta")) {
      const delta = String((json.delta as string | undefined) ?? (json.text as string | undefined) ?? "");
      if (delta) {
        ctx.ensureStarted();
        ctx.appendDelta(delta);
      }
      return;
    }
    if (type === "tool_use" || type === "tool_call") {
      ctx.ensureStarted();
      this.options?.onToolCall?.({
        messageId: ctx.messageId,
        toolCallId: String(json.id ?? json.tool_use_id ?? crypto.randomUUID()),
        toolName: String(json.name ?? "tool"),
        input: JSON.stringify(json.input ?? json.arguments ?? {}),
      });
      return;
    }
    if (type === "tool_result") {
      this.options?.onToolResult?.({
        messageId: ctx.messageId,
        toolCallId: String(json.tool_use_id ?? json.id ?? "unknown"),
        status: json.is_error ? "error" : "success",
        output: String(json.content ?? json.output ?? ""),
      });
      return;
    }
    if (type === "result" || type === "done") {
      // If we never got an assistant event but result has the final text, surface it.
      const finalText = (json.result as string | undefined) ?? "";
      if (finalText && !ctx.hasContent()) {
        ctx.ensureStarted();
        ctx.appendDelta(finalText);
      }
      this.emitUsage(json);
      return; // turn complete handled by proc.exited
    }

    this.options?.onLine(`[claude] ${raw}`);
  }

  /**
   * The final `result` event of each `claude -p` run carries the usage for
   * the whole run (one run == one turn here), so forwarding it verbatim
   * matches the delta semantics of onUsage. Assistant events also carry
   * per-message usage, but the result aggregate is the reliable total.
   */
  private emitUsage(json: Record<string, unknown>) {
    const usage = (json.usage ?? {}) as Record<string, unknown>;
    const num = (value: unknown): number | undefined =>
      typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
    const payload = {
      inputTokens: num(usage.input_tokens),
      outputTokens: num(usage.output_tokens),
      cacheReadTokens: num(usage.cache_read_input_tokens),
      cacheCreationTokens: num(usage.cache_creation_input_tokens),
      costUSD: num(json.total_cost_usd),
    };
    if (Object.values(payload).some((value) => value !== undefined)) {
      this.options?.onUsage?.(payload);
    }
  }

  private async readJsonLines(
    stream: ReadableStream<Uint8Array>,
    onJson: (json: Record<string, unknown>, raw: string) => void,
  ) {
    return this.readLines(stream, (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        onJson(parsed, trimmed);
      } catch {
        this.options?.onLine(`[claude] ${trimmed}`);
      }
    });
  }

  private async readLines(
    stream: ReadableStream<Uint8Array>,
    onLine: (line: string) => void,
  ) {
    const reader = stream.getReader();
    let buf = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += this.decoder.decode(value, { stream: true });
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? "";
        for (const line of lines) if (line) onLine(line);
      }
      buf += this.decoder.decode();
      if (buf) onLine(buf);
    } finally {
      reader.releaseLock();
    }
  }
}

function extractText(json: Record<string, unknown>): string {
  const direct = (json.text as string | undefined) ?? (json.content as string | undefined);
  if (typeof direct === "string") return direct;
  // Anthropic message.content is sometimes an array of blocks.
  const blocks = (json.message as Record<string, unknown> | undefined)?.content;
  if (Array.isArray(blocks)) {
    return blocks
      .map((b) => (typeof b === "string" ? b : (b as Record<string, unknown>).text ?? ""))
      .filter(Boolean)
      .join("");
  }
  return "";
}