import type { AgentCommandRequest } from "../../src/shared/contracts";
import type { AgentRuntime, CliRuntimeOptions, RuntimeStartOptions } from "./types";

type BunReadable = ReadableStream<Uint8Array> | null;
interface CliSubprocess {
  stdin: {
    write(chunk: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer): number;
    end(error?: Error): number | Promise<number>;
  };
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
}

export class CliRuntime implements AgentRuntime {
  readonly kind: CliRuntimeOptions["kind"];
  readonly command: CliRuntimeOptions["command"];
  private readonly args: string[];
  private process?: CliSubprocess;
  private decoder = new TextDecoder();

  constructor(options: CliRuntimeOptions) {
    this.kind = options.kind;
    this.command = options.command;
    this.args = options.args ?? [];
  }

  async start(options: RuntimeStartOptions): Promise<void> {
    if (this.process) return;

    try {
      const subprocess = Bun.spawn([this.command, ...this.args], {
        cwd: options.agent.workspacePath,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      }) as CliSubprocess;
      this.process = subprocess;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${this.command} CLI could not be started. Install it or switch this agent to mock runtime. ${message}`,
      );
    }

    const subprocess = this.process;
    this.readLines(subprocess.stdout, options.onLine);
    this.readLines(subprocess.stderr, (line) => options.onLine(`[stderr] ${line}`));

    void subprocess.exited
      .then((code: number) => options.onExit(code))
      .catch((error: unknown) => options.onError?.(toError(error)));
  }

  async send(request: AgentCommandRequest | string): Promise<void> {
    if (!this.process) {
      throw new Error(`${this.command} CLI runtime is not running`);
    }

    const command = typeof request === "string" ? request : request.command;
    this.process.stdin.write(`${command}\n`);
  }

  async stop(): Promise<void> {
    if (!this.process) return;

    try {
      await this.process.stdin.end();
    } catch {
      // Process may already have closed stdin.
    }

    this.process.kill();
    this.process = undefined;
  }

  private readLines(stream: BunReadable, onLine: (line: string) => void) {
    if (!stream) return;

    void (async () => {
      const reader = stream.getReader();
      let buffered = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffered += this.decoder.decode(value, { stream: true });
          const lines = buffered.split(/\r?\n/);
          buffered = lines.pop() ?? "";

          for (const line of lines) {
            if (line.length > 0) onLine(line);
          }
        }

        buffered += this.decoder.decode();
        if (buffered.length > 0) onLine(buffered);
      } finally {
        reader.releaseLock();
      }
    })();
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
