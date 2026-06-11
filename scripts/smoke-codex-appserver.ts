#!/usr/bin/env bun
/**
 * Smoke test: spawn a real `codex app-server` via CodexAppServerRuntime and
 * verify we can do initialize → thread/start → turn/start → message → idle.
 *
 * Usage:
 *   CODEX_BIN=/Users/lishuo121/Library/pnpm/codex bun scripts/smoke-codex-appserver.ts
 */
import { CodexAppServerRuntime } from "../server/runtimes/codexAppServerRuntime";
import type { AgentSnapshot } from "../src/shared/contracts";

const agent: AgentSnapshot = {
  id: "smoke-codex",
  name: "smoke-codex",
  runtimeKind: "codex",
  status: "idle",
  currentTask: null,
  uptime: "0s",
  tasksCompleted: 0,
  lastActive: new Date().toISOString(),
  logs: [],
  tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  costUSD: 0,
  cacheHitRate: 0,
  apiCalls: { total: 0, success: 0, errors: 0 },
  model: "gpt-5-codex",
  contextUsage: 0,
  workspacePath: process.cwd(),
  sessionId: null,
  runtimeArgs: [],
  messages: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const rt = new CodexAppServerRuntime();
let exited = false;

await rt.start({
  agent,
  onLine: (l) => console.log("LINE", l),
  onExit: (c) => {
    console.log("EXIT", c);
    exited = true;
  },
  onError: (e) => console.error("ERROR", e.message),
  onSessionId: (sid) => console.log("SESSION", sid),
  onMessageStart: (e) => console.log("MSG.START", e.messageId, e.role),
  onMessageDelta: (e) => console.log("MSG.DELTA", JSON.stringify(e.delta)),
  onMessageEnd: (e) => console.log("MSG.END", e.messageId, "len=" + e.content.length, e.content.slice(0, 200)),
  onToolCall: (e) => console.log("TOOL.CALL", e.toolName, e.input.slice(0, 120)),
  onToolResult: (e) => console.log("TOOL.RESULT", e.toolCallId, e.status, e.output.slice(0, 120)),
  onTurnComplete: () => console.log("TURN.COMPLETE"),
});

await rt.send("say only OK and nothing else");

// give codex up to 60 s to finish the turn
const start = Date.now();
while (!exited && Date.now() - start < 60_000) {
  await Bun.sleep(500);
  // we declare done when message end has fired — heuristic via env on first run
}
await rt.stop();