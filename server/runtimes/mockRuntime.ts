import type { AgentCommandRequest, RuntimeKind } from "../../src/shared/contracts";
import type { AgentRuntime, RuntimeStartOptions } from "./types";

export class MockRuntime implements AgentRuntime {
  readonly kind: RuntimeKind = "mock";
  private onLine?: (line: string) => void;
  private onExit?: (code: number | null) => void;
  private started = false;

  async start(options: RuntimeStartOptions): Promise<void> {
    this.started = true;
    this.onLine = options.onLine;
    this.onExit = options.onExit;

    this.emit(`mock:${options.agent.id}:started`);
    this.emit(`mock:${options.agent.id}:workspace:${options.agent.workspacePath}`);
    this.emit(`mock:${options.agent.id}:ready`);
  }

  async send(request: AgentCommandRequest | string): Promise<void> {
    this.assertStarted();
    const command = typeof request === "string" ? request : request.command;
    this.emit(`mock:command:${command}`);
    this.emit("mock:complete");
  }

  async stop(): Promise<void> {
    if (!this.started) return;

    this.emit("mock:stopped");
    this.started = false;
    this.onExit?.(0);
  }

  private emit(line: string) {
    this.onLine?.(line);
  }

  private assertStarted() {
    if (!this.started) {
      throw new Error("Mock runtime has not been started");
    }
  }
}
