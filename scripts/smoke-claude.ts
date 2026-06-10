/**
 * Smoke test: run the real ClaudeCliRuntime against the local `claude` CLI
 * and dump every structured event we receive. Run with:
 *   bun run scripts/smoke-claude.ts
 */
import { ClaudeCliRuntime } from "../server/runtimes/claudeCliRuntime";

const runtime = new ClaudeCliRuntime();
const events: string[] = [];

await runtime.start({
  agent: {
    id: "smoke-claude",
    name: "smoke",
    workspacePath: process.cwd(),
    sessionId: null,
    runtimeArgs: [],
  } as any,
  onLine: (line) => events.push(`LOG ${line}`),
  onExit: (code) => events.push(`EXIT ${code}`),
  onError: (err) => events.push(`ERR ${err.message}`),
  onSessionId: (id) => events.push(`SESSION ${id}`),
  onMessageStart: (e) => events.push(`MSG.START ${e.messageId} role=${e.role}`),
  onMessageDelta: (e) => events.push(`MSG.DELTA ${JSON.stringify(e.delta)}`),
  onMessageEnd: (e) => events.push(`MSG.END len=${e.content.length}`),
  onToolCall: (e) => events.push(`TOOL.CALL ${e.toolName} ${e.input}`),
  onToolResult: (e) => events.push(`TOOL.RESULT ${e.toolCallId} ${e.status}`),
  onTurnComplete: () => events.push(`TURN.COMPLETE`),
});

await runtime.send("say only the literal word OK");

await runtime.stop();

for (const e of events) console.log(e);