import {
  agentCommandSchema,
  agentSnapshotSchema,
  createAgentSchema,
  wsClientMessageSchema,
  type AgentEvent,
  type AgentSnapshot,
  type ServerSettings,
  type WsServerEvent,
} from "../src/shared/contracts";
import { existsSync } from "node:fs";
import { extname, join, normalize, relative, resolve } from "node:path";
import { AgentSupervisor } from "./agentSupervisor";
import { PiBridgeManager } from "./piBridgeManager";
import { loadServerSettings } from "./config";
import { createAgentStore, type AgentStore } from "./store";
import { createWhisperTranscriber, type Transcriber } from "./transcription";

export interface AppOptions {
  settings?: ServerSettings;
  store?: AgentStore;
  supervisor?: AgentSupervisor;
  transcriber?: Transcriber | null;
  staticDir?: string;
}

export interface WsClientContext {
  authenticated: boolean;
  channel: "agents" | "pi";
  unsubscribe?: () => void;
}

export interface BunWebSocket {
  readyState: number;
  data: WsClientContext;
  send(message: string): number | void;
  close(code?: number, reason?: string): void;
}

export interface BunWsHandlers {
  open(ws: BunWebSocket): void;
  message(ws: BunWebSocket, message: string | ArrayBufferView | ArrayBuffer): void;
  close(ws: BunWebSocket): void;
}

export interface BunFetchServer {
  upgrade(
    request: Request,
    options?: { data?: WsClientContext; headers?: HeadersInit },
  ): boolean;
}

export interface BunApp {
  fetch(request: Request, server?: BunFetchServer): Response | Promise<Response>;
  websocket: BunWsHandlers;
  /** Subscribe directly to supervisor events (used by the WS layer / tests). */
  subscribe(listener: (event: AgentEvent) => void): () => void;
  /** Trigger supervisor actions programmatically (used by tests). */
  supervisor: AgentSupervisor;
  piBridgeManager: PiBridgeManager;
  store: AgentStore;
}

const TEXT_DECODER = new TextDecoder();
const DEFAULT_STATIC_DIR = resolve(process.cwd(), "dist");
const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function createApp(options: AppOptions = {}): BunApp {
  const settings = options.settings ?? loadServerSettings();
  const store =
    options.store ??
    createAgentStore({ persistencePath: settings.persistencePath || undefined });
  const supervisor = options.supervisor ?? new AgentSupervisor(store);
  const transcriber =
    options.transcriber !== undefined
      ? options.transcriber
      : createWhisperTranscriber(settings);
  const staticDir = resolve(options.staticDir ?? DEFAULT_STATIC_DIR);

  const sockets = new Set<BunWebSocket>();
  const piBridgeManager = new PiBridgeManager(store, supervisor, settings.piBridgeToken);

  // Convert internal supervisor events into wire events broadcast to all
  // authenticated WebSocket clients.
  const broadcast = (event: AgentEvent) => {
    const wire = toWireEvent(event);
    if (!wire) return;
    const message = JSON.stringify(wire);
    for (const socket of sockets) {
      if (socket.readyState !== 1 || !socket.data.authenticated) continue;
      try {
        socket.send(message);
      } catch {
        // ignore — socket will be cleaned up on close.
      }
    }
  };

  supervisor.subscribe(broadcast);

  // Also forward store-level mutations (e.g. POST /api/agents creating an agent
  // outside of the supervisor) so REST callers see them on the WS feed too.
  store.subscribe((evt) => {
    if (evt.type === "created") {
      broadcast({
        id: crypto.randomUUID(),
        agentId: evt.agent.id,
        type: "created",
        message: "Agent created",
        snapshot: evt.agent,
        createdAt: new Date().toISOString(),
      });
    }
  });

  function corsHeaders(request: Request): HeadersInit {
    const origin = request.headers.get("origin") ?? "*";
    const allowed =
      settings.corsOrigins.includes("*") || settings.corsOrigins.includes(origin);
    return {
      "access-control-allow-origin": allowed ? origin : settings.corsOrigins[0] ?? "*",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type,x-api-key",
    };
  }

  function json(request: Request, body: unknown, status = 200): Response {
    return Response.json(body, { status, headers: corsHeaders(request) });
  }

  function authorized(request: Request): boolean {
    const url = new URL(request.url);
    return (
      request.headers.get("x-api-key") === settings.apiKey ||
      url.searchParams.get("apiKey") === settings.apiKey
    );
  }

  return {
    store,
    supervisor,
    piBridgeManager,
    subscribe: (listener) => supervisor.subscribe(listener),

    websocket: {
      open(ws) {
        if (ws.data.channel === "pi") return;
        sockets.add(ws);
        if (!ws.data.authenticated) return;
        // Send a snapshot of the current state on connect.
        for (const agent of store.list()) {
          try {
            ws.send(
              JSON.stringify({ type: "agent.updated", agent } satisfies WsServerEvent),
            );
          } catch {
            break;
          }
        }
      },
      message(ws, raw) {
        const text =
          typeof raw === "string"
            ? raw
            : TEXT_DECODER.decode(
                raw instanceof ArrayBuffer
                  ? raw
                  : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength),
              );
        if (ws.data.channel === "pi") {
          piBridgeManager.dispatch(ws, text);
          return;
        }
        if (!ws.data.authenticated) {
          ws.close(1008, "Unauthorized");
          return;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(text);
        } catch {
          return;
        }
        const result = wsClientMessageSchema.safeParse(payload);
        if (!result.success) return;
        const message = result.data;

        switch (message.type) {
          case "agent.start":
            void supervisor.startAgent(message.agentId);
            return;
          case "agent.pause":
            void supervisor.pauseAgent(message.agentId);
            return;
          case "agent.restart":
            void supervisor.restartAgent(message.agentId);
            return;
          case "agent.stop":
            void supervisor.stopAgent(message.agentId);
            return;
          case "agent.abort":
            void supervisor.abortAgent(message.agentId);
            return;
          case "agent.command":
            void supervisor.sendCommand(message.agentId, message.payload);
            return;
          case "agent.approval.response":
            supervisor.respondToApproval(
              message.agentId,
              message.approvalId,
              message.decision,
            );
            return;
        }
      },
      close(ws) {
        if (ws.data.channel === "pi") {
          piBridgeManager.disconnect(ws);
          return;
        }
        sockets.delete(ws);
      },
    },

    async fetch(request, server) {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return json(request, { status: "ok" });
      }

      // ---- WebSocket upgrades ----
      if (url.pathname === "/ws/bridges/pi" && server) {
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
          return json(request, { error: "Upgrade required" }, 426);
        }
        const upgraded = server.upgrade(request, {
          data: { authenticated: false, channel: "pi" },
        });
        if (!upgraded) return json(request, { error: "Upgrade failed" }, 400);
        return undefined as unknown as Response;
      }

      if (url.pathname === "/ws/agents" && server) {
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
          return json(request, { error: "Upgrade required" }, 426);
        }
        const upgraded = server.upgrade(request, {
          data: { authenticated: authorized(request), channel: "agents" },
        });
        if (!upgraded) {
          return json(request, { error: "Upgrade failed" }, 400);
        }
        return undefined as unknown as Response;
      }

      if (!url.pathname.startsWith("/api/")) {
        const staticResponse = await serveStatic(request, url, staticDir);
        return staticResponse ?? json(request, { error: "Not found" }, 404);
      }

      if (!authorized(request)) {
        return json(request, { error: "Unauthorized" }, 401);
      }

      // ---- REST ----
      if (request.method === "POST" && url.pathname === "/api/transcribe") {
        if (!transcriber) {
          return json(
            request,
            {
              error:
                "Voice transcription is not configured. Set WHISPER_CPP_MODEL to a ggml whisper.cpp model path.",
            },
            503,
          );
        }
        try {
          const form = await request.formData();
          const audio = form.get("audio");
          if (!(audio instanceof File)) {
            return json(request, { error: "Missing multipart audio file" }, 400);
          }
          if (!audio.type.startsWith("audio/")) {
            return json(request, { error: "Uploaded file must be audio" }, 400);
          }
          const bytes = new Uint8Array(await audio.arrayBuffer());
          const result = await transcriber.transcribe({
            filename: audio.name || "audio",
            mimeType: audio.type || "application/octet-stream",
            bytes,
          });
          return json(request, result);
        } catch (error) {
          return json(
            request,
            {
              error: "Transcription failed",
              details: error instanceof Error ? error.message : String(error),
            },
            500,
          );
        }
      }

      if (request.method === "GET" && url.pathname === "/api/agents") {
        return json(request, { agents: store.list() });
      }

      if (request.method === "POST" && url.pathname === "/api/agents") {
        try {
          const payload = await request.json();
          const agent = store.create(createAgentSchema.parse(payload));
          return json(request, { agent }, 201);
        } catch (error) {
          return json(
            request,
            {
              error: "Invalid request",
              details: error instanceof Error ? error.message : String(error),
            },
            400,
          );
        }
      }

      const detailMatch = /^\/api\/agents\/([^/]+)$/.exec(url.pathname);
      if (detailMatch) {
        const id = decodeURIComponent(detailMatch[1]);
        if (request.method === "GET") {
          const agent = store.get(id);
          return agent
            ? json(request, { agent })
            : json(request, { error: "Agent not found" }, 404);
        }
        if (request.method === "DELETE") {
          const events = await supervisor.deleteAgent(id);
          const error = events.find((e) => e.type === "error");
          if (error) return json(request, { error: error.message }, 404);
          return json(request, { ok: true });
        }
      }

      const startMatch = /^\/api\/agents\/([^/]+)\/start$/.exec(url.pathname);
      if (request.method === "POST" && startMatch) {
        const events = await supervisor.startAgent(decodeURIComponent(startMatch[1]));
        const error = events.find((e) => e.type === "error");
        if (error) return json(request, { error: error.message }, 400);
        return json(request, { ok: true, events });
      }

      const stopMatch = /^\/api\/agents\/([^/]+)\/stop$/.exec(url.pathname);
      if (request.method === "POST" && stopMatch) {
        const events = await supervisor.stopAgent(decodeURIComponent(stopMatch[1]));
        const error = events.find((e) => e.type === "error");
        if (error) return json(request, { error: error.message }, 400);
        return json(request, { ok: true, events });
      }

      const pauseMatch = /^\/api\/agents\/([^/]+)\/pause$/.exec(url.pathname);
      if (request.method === "POST" && pauseMatch) {
        const events = await supervisor.pauseAgent(decodeURIComponent(pauseMatch[1]));
        const error = events.find((e) => e.type === "error");
        if (error) return json(request, { error: error.message }, 400);
        return json(request, { ok: true, events });
      }

      const restartMatch = /^\/api\/agents\/([^/]+)\/restart$/.exec(url.pathname);
      if (request.method === "POST" && restartMatch) {
        const events = await supervisor.restartAgent(decodeURIComponent(restartMatch[1]));
        const error = events.find((e) => e.type === "error");
        if (error) return json(request, { error: error.message }, 400);
        return json(request, { ok: true, events });
      }

      const abortMatch = /^\/api\/agents\/([^/]+)\/abort$/.exec(url.pathname);
      if (request.method === "POST" && abortMatch) {
        const events = await supervisor.abortAgent(decodeURIComponent(abortMatch[1]));
        const error = events.find((e) => e.type === "error");
        if (error) return json(request, { error: error.message }, 400);
        return json(request, { ok: true, events });
      }

      const commandMatch = /^\/api\/agents\/([^/]+)\/commands$/.exec(url.pathname);
      if (request.method === "POST" && commandMatch) {
        try {
          const payload = await request.json();
          const command = agentCommandSchema.parse(payload);
          const events = await supervisor.sendCommand(
            decodeURIComponent(commandMatch[1]),
            command,
          );
          const error = events.find((e) => e.type === "error");
          if (error) return json(request, { error: error.message }, 400);
          return json(request, { ok: true, events });
        } catch (error) {
          return json(
            request,
            {
              error: "Invalid request",
              details: error instanceof Error ? error.message : String(error),
            },
            400,
          );
        }
      }

      return json(request, { error: "Not found" }, 404);
    },
  };
}

function toWireEvent(event: AgentEvent): WsServerEvent | null {
  switch (event.type) {
    case "created":
      return event.snapshot
        ? { type: "agent.created", agent: ensureSnapshot(event.snapshot) }
        : null;
    case "updated":
      return event.snapshot
        ? { type: "agent.updated", agent: ensureSnapshot(event.snapshot) }
        : null;
    case "deleted":
      return { type: "agent.deleted", agentId: event.agentId };
    case "log":
      return { type: "agent.log", agentId: event.agentId, line: event.message };
    case "command":
      return {
        type: "command.ack",
        agentId: event.agentId,
        command: event.message,
      };
    case "error":
      return {
        type: "command.error",
        agentId: event.agentId,
        message: event.message,
      };
    case "messageStart":
      if (!event.payload?.message) return null;
      return {
        type: "agent.message.start",
        agentId: event.agentId,
        message: event.payload.message,
      };
    case "messageDelta":
      if (!event.payload?.messageId || event.payload.delta === undefined) return null;
      return {
        type: "agent.message.delta",
        agentId: event.agentId,
        messageId: event.payload.messageId,
        delta: event.payload.delta,
      };
    case "messageEnd":
      if (!event.payload?.message) return null;
      return {
        type: "agent.message.end",
        agentId: event.agentId,
        message: event.payload.message,
      };
    case "toolCall":
      if (
        !event.payload?.messageId ||
        !event.payload.toolCallId ||
        !event.payload.toolName
      )
        return null;
      return {
        type: "agent.tool.call",
        agentId: event.agentId,
        messageId: event.payload.messageId,
        toolCallId: event.payload.toolCallId,
        toolName: event.payload.toolName,
        input: event.payload.toolInput ?? "",
      };
    case "toolResult":
      if (
        !event.payload?.messageId ||
        !event.payload.toolCallId ||
        !event.payload.toolStatus ||
        event.payload.toolStatus === "pending"
      )
        return null;
      return {
        type: "agent.tool.result",
        agentId: event.agentId,
        messageId: event.payload.messageId,
        toolCallId: event.payload.toolCallId,
        status: event.payload.toolStatus,
        output: event.payload.toolOutput ?? "",
      };
    case "turnComplete":
      return { type: "agent.turn.complete", agentId: event.agentId };
    case "approvalRequest":
      if (!event.payload?.approvalId || !event.payload.approvalKind) return null;
      return {
        type: "agent.approval.request",
        agentId: event.agentId,
        approvalId: event.payload.approvalId,
        kind: event.payload.approvalKind,
        summary: event.payload.approvalSummary ?? event.message,
        details: event.payload.approvalDetails,
      };
    case "approvalResolved":
      if (!event.payload?.approvalId || !event.payload.approvalDecision) return null;
      return {
        type: "agent.approval.resolved",
        agentId: event.agentId,
        approvalId: event.payload.approvalId,
        decision: event.payload.approvalDecision,
      };
    default:
      return null;
  }
}

function ensureSnapshot(value: AgentSnapshot): AgentSnapshot {
  return agentSnapshotSchema.parse(value);
}

async function serveStatic(
  request: Request,
  url: URL,
  staticDir: string,
): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (!existsSync(join(staticDir, "index.html"))) return null;

  const pathname = decodeURIComponent(url.pathname);
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const candidate = safeJoin(staticDir, requestedPath);
  const filePath =
    candidate && existsSync(candidate) && !candidate.endsWith("/")
      ? candidate
      : join(staticDir, "index.html");
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;

  const headers = new Headers();
  headers.set(
    "content-type",
    CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
  );
  if (filePath !== join(staticDir, "index.html")) {
    headers.set("cache-control", "public, max-age=31536000, immutable");
  }
  return new Response(request.method === "HEAD" ? null : file, { headers });
}

function safeJoin(root: string, pathname: string): string | null {
  const withoutLeadingSlash = pathname.replace(/^\/+/, "");
  const normalized = normalize(withoutLeadingSlash);
  const fullPath = resolve(root, normalized);
  const rel = relative(root, fullPath);
  if (rel.startsWith("..") || rel === ".." || rel.includes(`..${"/"}`)) return null;
  return fullPath;
}
