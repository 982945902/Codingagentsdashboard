import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";
import { AgentSupervisor } from "../agentSupervisor";
import { createAgentStore } from "../store";
import type { AgentRuntime, RuntimeStartOptions } from "../runtimes/types";

const apiKey = "test-key";
const servers: Array<ReturnType<typeof Bun.serve>> = [];
const tempDirs: string[] = [];

class CapturingRuntime implements AgentRuntime {
  kind = "codex" as const;
  private onLine?: (line: string) => void;
  private onExit?: (code: number | null) => void;
  sentCommands: string[] = [];

  async start(options: RuntimeStartOptions) {
    this.onLine = options.onLine;
    this.onExit = options.onExit;
    this.onLine("ready");
  }

  async send(request: { command: string } | string) {
    const command = typeof request === "string" ? request : request.command;
    this.sentCommands.push(command);
    this.onLine?.(`echo ${command}`);
  }

  async stop() {
    this.onExit?.(0);
  }
}

class StructuredRuntime implements AgentRuntime {
  kind = "codex" as const;
  private options?: RuntimeStartOptions;

  async start(options: RuntimeStartOptions) {
    this.options = options;
    options.onLine("ready");
  }

  async send(request: { command: string } | string) {
    const command = typeof request === "string" ? request : request.command;
    const messageId = `msg-${crypto.randomUUID()}`;
    const toolCallId = `tool-${crypto.randomUUID()}`;
    this.options?.onMessageStart?.({ messageId, role: "assistant" });
    this.options?.onMessageDelta?.({ messageId, delta: `Real test reply to: ${command}` });
    this.options?.onToolCall?.({
      messageId,
      toolCallId,
      toolName: "shell",
      input: command,
    });
    this.options?.onToolResult?.({
      messageId,
      toolCallId,
      status: "success",
      output: "ok",
    });
    this.options?.onMessageEnd?.({
      messageId,
      content: `Real test reply to: ${command}`,
      format: "markdown",
    });
    this.options?.onTurnComplete?.();
  }

  async stop() {
    this.options?.onExit(0);
  }
}

function startTestServer(
  useSupervisor: boolean | "structured" = false,
  options: { staticDir?: string } = {},
) {
  const store = createAgentStore();
  const supervisor =
    useSupervisor === "structured"
      ? new AgentSupervisor(store, () => new StructuredRuntime())
      : useSupervisor
        ? new AgentSupervisor(store, () => new CapturingRuntime())
        : undefined;
  const app = createApp({
    settings: {
      apiKey,
      corsOrigins: ["*"],
      host: "127.0.0.1",
      port: 0,
      persistencePath: "",
      whisperCppBin: "whisper-cli",
      whisperCppModel: "",
      whisperLanguage: "auto",
      ffmpegBin: "ffmpeg",
    },
    store,
    supervisor,
    staticDir: options.staticDir,
  });
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      return app.fetch(request, server);
    },
    websocket: {
      open: app.websocket.open,
      message: app.websocket.message,
      close: app.websocket.close,
    },
  });
  servers.push(server);
  return { baseUrl: `http://${server.hostname}:${server.port}`, app };
}

function authed(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      "x-api-key": apiKey,
      ...(init.headers ?? {}),
    },
  };
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
  for (const dir of tempDirs.splice(0)) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

function createStaticFixture() {
  const dir = mkdtempSync(join(tmpdir(), "agents-static-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><div id=\"root\">app</div>");
  writeFileSync(join(dir, "assets", "app.js"), "console.log('app');");
  return dir;
}

describe("Bun HTTP app", () => {
  it("serves health without auth", async () => {
    const { baseUrl } = startTestServer();

    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  it("serves built frontend assets and falls back to index for SPA routes", async () => {
    const staticDir = createStaticFixture();
    const { baseUrl } = startTestServer(false, { staticDir });

    const root = await fetch(`${baseUrl}/`);
    const asset = await fetch(`${baseUrl}/assets/app.js`);
    const route = await fetch(`${baseUrl}/agents/abc`);

    expect(root.status).toBe(200);
    expect(await root.text()).toContain("<div id=\"root\">app</div>");
    expect(root.headers.get("content-type")).toContain("text/html");
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("console.log('app');");
    expect(asset.headers.get("content-type")).toContain("javascript");
    expect(route.status).toBe(200);
    expect(await route.text()).toContain("<div id=\"root\">app</div>");
  });

  it("requires an API key for agent routes", async () => {
    const { baseUrl } = startTestServer();

    const response = await fetch(`${baseUrl}/api/agents`);

    expect(response.status).toBe(401);
  });

  it("lists and fetches agents with auth", async () => {
    const { baseUrl, app } = startTestServer();
    const agent = app.store.create({
      name: "Docs Agent",
      runtimeKind: "codex",
      workspacePath: "/tmp/docs",
      model: "codex",
    });

    const listResponse = await fetch(`${baseUrl}/api/agents`, authed());
    const listBody = await listResponse.json();
    const detailResponse = await fetch(`${baseUrl}/api/agents/${agent.id}`, authed());
    const detailBody = await detailResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listBody.agents).toHaveLength(1);
    expect(detailResponse.status).toBe(200);
    expect(detailBody.agent.name).toBe("Docs Agent");
  });

  it("creates agents with auth", async () => {
    const { baseUrl } = startTestServer();

    const response = await fetch(
      `${baseUrl}/api/agents`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Docs Agent",
          workspacePath: "/tmp/docs",
          model: "claude-sonnet-4",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.agent.name).toBe("Docs Agent");
    expect(body.agent.status).toBe("idle");
    expect(body.agent.runtimeKind).toBe("codex");
  });

  it("starts, sends commands to, and stops agents through REST", async () => {
    const { baseUrl, app } = startTestServer(true);
    const agent = app.store.create({
      name: "Command Agent",
      runtimeKind: "codex",
      workspacePath: "/tmp/command-agent",
      model: "codex",
    });

    const start = await fetch(
      `${baseUrl}/api/agents/${agent.id}/start`,
      authed({ method: "POST" }),
    );
    expect(start.status).toBe(200);

    const command = await fetch(
      `${baseUrl}/api/agents/${agent.id}/commands`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "status" }),
      }),
    );
    expect(command.status).toBe(200);

    const stop = await fetch(
      `${baseUrl}/api/agents/${agent.id}/stop`,
      authed({ method: "POST" }),
    );
    expect(stop.status).toBe(200);

    const detail = await fetch(`${baseUrl}/api/agents/${agent.id}`, authed());
    const body = await detail.json();
    expect(body.agent.status).toBe("stopped");
  });

  it("rejects commands when the agent is not running", async () => {
    const { baseUrl, app } = startTestServer(true);
    const agent = app.store.create({
      name: "Idle Agent",
      runtimeKind: "codex",
      workspacePath: "/tmp/idle-agent",
      model: "codex",
    });

    const command = await fetch(
      `${baseUrl}/api/agents/${agent.id}/commands`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "status" }),
      }),
    );
    expect(command.status).toBe(400);
  });

  it("deletes agents", async () => {
    const { baseUrl, app } = startTestServer(true);
    const agent = app.store.create({
      name: "Deleted Agent",
      runtimeKind: "codex",
      workspacePath: "/tmp/deleted-agent",
      model: "codex",
    });

    const del = await fetch(
      `${baseUrl}/api/agents/${agent.id}`,
      authed({ method: "DELETE" }),
    );
    expect(del.status).toBe(200);

    const detail = await fetch(`${baseUrl}/api/agents/${agent.id}`, authed());
    expect(detail.status).toBe(404);
  });

  it("handles missing agents, invalid requests, and CORS preflight", async () => {
    const { baseUrl } = startTestServer();

    const missing = await fetch(`${baseUrl}/api/agents/nope`, authed());
    const invalid = await fetch(
      `${baseUrl}/api/agents`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "" }),
      }),
    );
    const preflight = await fetch(`${baseUrl}/api/agents`, { method: "OPTIONS" });

    expect(missing.status).toBe(404);
    expect(invalid.status).toBe(400);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("delivers supervisor events over the WebSocket channel", async () => {
    const { baseUrl, app } = startTestServer(true);
    const agent = app.store.create({
      name: "WebSocket Agent",
      runtimeKind: "codex",
      workspacePath: "/tmp/ws-agent",
      model: "codex",
    });
    const wsUrl = baseUrl.replace("http://", "ws://") + `/ws/agents?apiKey=${apiKey}`;

    const messages: string[] = [];
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("ws error")));
    });
    ws.addEventListener("message", (event) => {
      messages.push(String(event.data));
    });

    await app.supervisor.startAgent(agent.id);
    await new Promise((resolve) => setTimeout(resolve, 50));
    ws.close();

    const types = messages.map((m) => JSON.parse(m).type);
    expect(types).toContain("agent.updated");
    expect(types.some((t) => t === "agent.log")).toBe(true);
  });

  it("delivers structured chat and tool events over the WebSocket channel", async () => {
    const { baseUrl, app } = startTestServer("structured");
    const agent = app.store.create({
      name: "Structured Agent",
      runtimeKind: "codex",
      workspacePath: "/tmp/structured-agent",
      model: "codex",
    });
    const wsUrl = baseUrl.replace("http://", "ws://") + `/ws/agents?apiKey=${apiKey}`;

    const messages: string[] = [];
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("ws error")));
    });
    ws.addEventListener("message", (event) => {
      messages.push(String(event.data));
    });

    await app.supervisor.startAgent(agent.id);
    await app.supervisor.sendCommand(agent.id, { command: "status" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    ws.close();

    const events = messages.map((m) => JSON.parse(m));
    const types = events.map((e) => e.type);

    expect(types).toContain("agent.message.start");
    expect(types).toContain("agent.message.delta");
    expect(types).toContain("agent.message.end");
    expect(types).toContain("agent.tool.call");
    expect(types).toContain("agent.tool.result");
    expect(types).toContain("agent.turn.complete");

    const start = events.find((e) => e.type === "agent.message.start");
    const end = events.find((e) => e.type === "agent.message.end");
    const toolCall = events.find((e) => e.type === "agent.tool.call");
    const toolResult = events.find((e) => e.type === "agent.tool.result");

    expect(start.message.role).toBe("assistant");
    expect(end.message.content).toContain("Real test reply");
    expect(toolCall.toolName).toBe("shell");
    expect(toolResult.status).toBe("success");
    expect(toolCall.messageId).toBe(toolResult.messageId);
  });
});
