import type { AgentSnapshot } from "../../src/shared/contracts";
import { CliRuntime } from "./cliRuntime";
import { MockRuntime } from "./mockRuntime";
import type { AgentRuntime } from "./types";

export function createRuntimeForAgent(agent: Pick<AgentSnapshot, "runtimeKind">): AgentRuntime {
  switch (agent.runtimeKind) {
    case "mock":
      return new MockRuntime();
    case "codex":
      return new CliRuntime({ kind: "codex", command: "codex" });
    case "claude":
      return new CliRuntime({ kind: "claude", command: "claude" });
    default:
      return assertNever(agent.runtimeKind);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported runtime kind: ${String(value)}`);
}
