import type { AgentSnapshot } from "../../src/shared/contracts";
import { ClaudeCliRuntime } from "./claudeCliRuntime";
import { CodexAppServerRuntime } from "./codexAppServerRuntime";
import type { AgentRuntime } from "./types";

export function createRuntimeForAgent(
  agent: Pick<AgentSnapshot, "runtimeKind" | "sessionId" | "runtimeArgs">,
): AgentRuntime {
  switch (agent.runtimeKind) {
    case "codex":
      return new CodexAppServerRuntime({
        args: agent.runtimeArgs ?? [],
        resumeSessionId: agent.sessionId ?? null,
      });
    case "claude":
      return new ClaudeCliRuntime({
        args: agent.runtimeArgs ?? [],
        resumeSessionId: agent.sessionId ?? null,
      });
    case "pi":
      throw new Error("Pi runtimes attach through /ws/bridges/pi and cannot be spawned by the dashboard");
    default:
      return assertNever(agent.runtimeKind);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported runtime kind: ${String(value)}`);
}
