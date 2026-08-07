import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { hostname } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

interface BridgeConfig {
  enabled?: boolean;
  url?: string;
  token?: string;
  hostId?: string;
}

interface DashboardMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  format: "text" | "markdown";
  streaming: boolean;
  toolCalls: Array<{
    id: string;
    name: string;
    input: string;
    status: "pending" | "success" | "error";
    output: string;
  }>;
  createdAt: string;
}

const STATUS_KEY = "pi-dashboard-bridge";
const WIDGET_KEY = "pi-dashboard-bridge";
const DEFAULT_URL = "ws://127.0.0.1:8787/ws/bridges/pi";
const DEFAULT_TOKEN = "dev-api-key";
const RECONNECT_MAX_MS = 30_000;

function isLoopbackHost(value: string): boolean {
  const host = value.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function loadConfig(): Required<BridgeConfig> {
  let fileConfig: BridgeConfig = {};
  try {
    fileConfig = JSON.parse(
      readFileSync(join(getAgentDir(), "dashboard", "config.json"), "utf8"),
    ) as BridgeConfig;
  } catch {
    // Missing config is expected for local defaults.
  }
  const explicitToken = process.env.PI_DASHBOARD_TOKEN || fileConfig.token;
  const resolved = {
    enabled: fileConfig.enabled ?? true,
    url: process.env.PI_DASHBOARD_URL || fileConfig.url || DEFAULT_URL,
    token: explicitToken || DEFAULT_TOKEN,
    hostId: process.env.PI_DASHBOARD_HOST_ID || fileConfig.hostId || hostname(),
  };
  const url = new URL(resolved.url);
  if (!isLoopbackHost(url.hostname)) {
    if (!explicitToken || resolved.token === DEFAULT_TOKEN) {
      throw new Error("PI_DASHBOARD_TOKEN must be explicitly configured for a remote dashboard");
    }
    if (url.protocol !== "wss:") {
      throw new Error("Remote Pi dashboard connections must use wss://");
    }
  }
  return resolved;
}

function iso(timestamp: unknown): string {
  const value = typeof timestamp === "number" ? timestamp : Date.now();
  return new Date(value).toISOString();
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; text?: string } => Boolean(part && typeof part === "object"))
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text!)
    .join("\n");
}

function argsOf(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function messageId(message: { role?: string; timestamp?: number }, suffix = ""): string {
  return `pi-msg-${message.role ?? "message"}-${message.timestamp ?? Date.now()}${suffix}`;
}

function snapshotMessages(ctx: ExtensionContext): DashboardMessage[] {
  const result: DashboardMessage[] = [];
  const toolOwners = new Map<string, DashboardMessage>();
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const message = entry.message as any;
    if (message.role === "user") {
      result.push({
        id: entry.id,
        role: "user",
        content: textOf(message.content),
        format: "text",
        streaming: false,
        toolCalls: [],
        createdAt: iso(message.timestamp),
      });
      continue;
    }
    if (message.role === "assistant") {
      const item: DashboardMessage = {
        id: entry.id,
        role: "assistant",
        content: textOf(message.content),
        format: "markdown",
        streaming: false,
        toolCalls: [],
        createdAt: iso(message.timestamp),
      };
      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part?.type !== "toolCall" || typeof part.id !== "string") continue;
          const call = {
            id: part.id,
            name: String(part.name || "tool"),
            input: argsOf(part.arguments),
            status: "pending" as const,
            output: "",
          };
          item.toolCalls.push(call);
          toolOwners.set(call.id, item);
        }
      }
      result.push(item);
      continue;
    }
    if (message.role === "toolResult") {
      const owner = toolOwners.get(String(message.toolCallId));
      const call = owner?.toolCalls.find((candidate) => candidate.id === message.toolCallId);
      if (call) {
        call.status = message.isError ? "error" : "success";
        call.output = textOf(message.content);
      }
    }
  }
  return result.slice(-200);
}

function dashboardHttpUrl(wsUrl: string): string {
  try {
    const url = new URL(wsUrl);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return wsUrl;
  }
}

export default function piDashboardBridge(pi: ExtensionAPI) {
  const config = loadConfig();
  let ctx: ExtensionContext | null = null;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectMs = 1_000;
  let stopped = false;
  let sequence = 0;
  let currentUserId: string | null = null;
  let currentUserText = "";
  let currentAssistantId: string | null = null;
  let currentAssistantText = "";
  let lastAssistantId: string | null = null;
  const toolOwners = new Map<string, string>();

  function sessionId(): string {
    return ctx?.sessionManager.getSessionId() || process.env.PI_SESSION_ID || "unknown";
  }

  function send(value: unknown): boolean {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(value));
    return true;
  }

  function sendEvent(event: Record<string, unknown>): void {
    send({
      type: "pi.event",
      version: 1,
      sessionId: sessionId(),
      sequence: sequence++,
      event,
    });
  }

  function makeSnapshot() {
    const usage = ctx?.getContextUsage();
    return {
      messages: ctx ? snapshotMessages(ctx) : [],
      contextPercent: usage?.percent ?? null,
      contextTokens: usage?.tokens ?? null,
      contextWindow: usage?.contextWindow,
    };
  }

  function register(): void {
    if (!ctx) return;
    const registered = send({
      type: "pi.register",
      version: 1,
      token: config.token,
      sessionId: sessionId(),
      hostId: config.hostId,
      name: pi.getSessionName() || `pi-${sessionId().slice(0, 8)}`,
      cwd: ctx.cwd,
      provider: ctx.model?.provider || "unknown",
      model: ctx.model?.id || "unknown",
      thinkingLevel: pi.getThinkingLevel(),
      state: ctx.isIdle() ? "idle" : "busy",
      capabilities: {
        prompt: true,
        steer: true,
        followUp: true,
        abort: true,
        compact: true,
        setModel: false,
        setThinkingLevel: true,
        attachments: false,
      },
      snapshot: makeSnapshot(),
    });
    if (!registered) return;
    if (currentUserId) {
      sendEvent({
        kind: "message.start",
        message: {
          id: currentUserId,
          role: "user",
          content: currentUserText,
          format: "text",
          streaming: false,
          toolCalls: [],
          createdAt: new Date().toISOString(),
        },
      });
    }
    if (currentAssistantId) {
      sendEvent({
        kind: "message.start",
        message: {
          id: currentAssistantId,
          role: "assistant",
          content: currentAssistantText,
          format: "markdown",
          streaming: true,
          toolCalls: [],
          createdAt: new Date().toISOString(),
        },
      });
    }
  }

  function updateUi(connected: boolean): void {
    if (!ctx?.hasUI) return;
    const label = connected
      ? ctx.ui.theme.fg("success", "dashboard connected")
      : ctx.ui.theme.fg("dim", "dashboard offline");
    ctx.ui.setStatus(STATUS_KEY, label);
    if (connected) {
      ctx.ui.setWidget(WIDGET_KEY, [
        ctx.ui.theme.fg("accent", "Coding Agents Dashboard"),
        `Web UI: ${dashboardHttpUrl(config.url)}`,
        `Session: ${pi.getSessionName() || sessionId()}`,
      ]);
    }
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectMs);
    reconnectTimer.unref?.();
    reconnectMs = Math.min(RECONNECT_MAX_MS, reconnectMs * 2);
  }

  function connect(): void {
    if (stopped || !ctx || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
    try {
      const next = new WebSocket(config.url);
      socket = next;
      next.addEventListener("open", () => {
        if (socket !== next) return;
        reconnectMs = 1_000;
        sequence = 0;
        register();
        updateUi(true);
        heartbeatTimer = setInterval(() => {
          send({ type: "pi.heartbeat", version: 1, sessionId: sessionId() });
        }, 15_000);
        heartbeatTimer.unref?.();
      });
      next.addEventListener("message", (raw) => {
        let message: any;
        try {
          message = JSON.parse(String(raw.data));
        } catch {
          return;
        }
        if (message?.type === "pi.command") void handleCommand(message);
      });
      next.addEventListener("close", () => {
        if (socket === next) socket = null;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        updateUi(false);
        scheduleReconnect();
      });
      next.addEventListener("error", () => {
        // close drives reconnect and keeps noisy connection errors out of the transcript.
      });
    } catch {
      scheduleReconnect();
    }
  }

  async function handleCommand(command: any): Promise<void> {
    let accepted = true;
    let error: string | undefined;
    try {
      if (!ctx) throw new Error("Pi session is not ready");
      if (command.action === "prompt") {
        const text = String(command.text || "").trim();
        if (!text) throw new Error("Prompt text is required");
        if (ctx.isIdle()) pi.sendUserMessage(text);
        else pi.sendUserMessage(text, {
          deliverAs: command.delivery === "steer" ? "steer" : "followUp",
        });
      } else if (command.action === "abort") {
        ctx.abort();
      } else if (command.action === "compact") {
        ctx.compact();
      } else {
        throw new Error(`Unsupported command: ${String(command.action)}`);
      }
    } catch (cause) {
      accepted = false;
      error = cause instanceof Error ? cause.message : String(cause);
    }
    send({
      type: "pi.command.result",
      version: 1,
      sessionId: sessionId(),
      commandId: String(command.commandId || "unknown"),
      accepted,
      ...(error ? { error } : {}),
    });
  }

  pi.registerCommand("dashboard", {
    description: "Show Coding Agents Dashboard bridge status",
    handler: async (_args, commandCtx) => {
      ctx = commandCtx;
      commandCtx.ui.notify(
        `${socket?.readyState === WebSocket.OPEN ? "Connected" : "Offline"}: ${dashboardHttpUrl(config.url)}`,
        socket?.readyState === WebSocket.OPEN ? "info" : "warning",
      );
      if (socket?.readyState !== WebSocket.OPEN) connect();
    },
  });

  pi.on("session_start", async (_event, eventCtx) => {
    ctx = eventCtx;
    stopped = false;
    updateUi(false);
    if (config.enabled) connect();
  });

  pi.on("session_info_changed", async (event, eventCtx) => {
    ctx = eventCtx;
    sendEvent({ kind: "metadata", name: event.name || `pi-${sessionId().slice(0, 8)}` });
  });

  pi.on("model_select", async (event, eventCtx) => {
    ctx = eventCtx;
    sendEvent({ kind: "metadata", model: event.model.id, provider: event.model.provider });
  });

  pi.on("thinking_level_select", async (event, eventCtx) => {
    ctx = eventCtx;
    sendEvent({ kind: "metadata", thinkingLevel: event.level });
  });

  pi.on("agent_start", async (_event, eventCtx) => {
    ctx = eventCtx;
    sendEvent({ kind: "state", state: "busy" });
  });

  pi.on("agent_settled", async (_event, eventCtx) => {
    ctx = eventCtx;
    sendEvent({ kind: "state", state: "idle" });
    const usage = eventCtx.getContextUsage();
    sendEvent({ kind: "usage", contextPercent: usage?.percent ?? null });
  });

  pi.on("message_start", async (event, eventCtx) => {
    ctx = eventCtx;
    const message: any = event.message;
    if (message.role !== "user" && message.role !== "assistant") return;
    const id = messageId(message, `-${sequence}`);
    if (message.role === "user") {
      currentUserId = id;
      currentUserText = textOf(message.content);
    } else {
      currentAssistantId = id;
      currentAssistantText = "";
      lastAssistantId = id;
    }
    sendEvent({
      kind: "message.start",
      message: {
        id,
        role: message.role,
        content: message.role === "user" ? currentUserText : "",
        format: message.role === "user" ? "text" : "markdown",
        streaming: message.role === "assistant",
        toolCalls: [],
        createdAt: iso(message.timestamp),
      },
    });
  });

  pi.on("message_update", async (event, eventCtx) => {
    ctx = eventCtx;
    const delta: any = event.assistantMessageEvent;
    if (delta?.type === "text_delta" && currentAssistantId) {
      const text = String(delta.delta || "");
      currentAssistantText += text;
      sendEvent({ kind: "message.delta", messageId: currentAssistantId, delta: text });
    }
  });

  pi.on("message_end", async (event, eventCtx) => {
    ctx = eventCtx;
    const message: any = event.message;
    if (message.role !== "user" && message.role !== "assistant") return;
    const id = message.role === "user" ? currentUserId : currentAssistantId;
    if (!id) return;
    sendEvent({
      kind: "message.end",
      message: {
        id,
        role: message.role,
        content: textOf(message.content),
        format: message.role === "user" ? "text" : "markdown",
        streaming: false,
        toolCalls: [],
        createdAt: iso(message.timestamp),
      },
    });
    if (message.role === "user") {
      currentUserId = null;
      currentUserText = "";
    } else {
      lastAssistantId = id;
      currentAssistantId = null;
      currentAssistantText = "";
      const usage = message.usage;
      if (usage) {
        sendEvent({
          kind: "usage",
          inputTokens: Number(usage.input || 0),
          outputTokens: Number(usage.output || 0),
          cacheReadTokens: Number(usage.cacheRead || 0),
          cacheCreationTokens: Number(usage.cacheWrite || 0),
          costUSD: Number(usage.cost?.total || 0),
          contextPercent: eventCtx.getContextUsage()?.percent ?? null,
        });
      }
    }
  });

  pi.on("tool_execution_start", async (event, eventCtx) => {
    ctx = eventCtx;
    const parent = currentAssistantId || lastAssistantId;
    if (!parent) return;
    toolOwners.set(event.toolCallId, parent);
    sendEvent({
      kind: "tool.call",
      messageId: parent,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      input: argsOf(event.args),
    });
  });

  pi.on("tool_execution_end", async (event, eventCtx) => {
    ctx = eventCtx;
    const parent = toolOwners.get(event.toolCallId) || lastAssistantId;
    if (!parent) return;
    sendEvent({
      kind: "tool.result",
      messageId: parent,
      toolCallId: event.toolCallId,
      status: event.isError ? "error" : "success",
      output: textOf(event.result?.content),
    });
    toolOwners.delete(event.toolCallId);
  });

  pi.on("session_shutdown", async (_event, eventCtx) => {
    stopped = true;
    ctx = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    reconnectTimer = null;
    heartbeatTimer = null;
    socket?.close(1000, "Pi session shutdown");
    socket = null;
    if (eventCtx.hasUI) {
      eventCtx.ui.setStatus(STATUS_KEY, undefined);
      eventCtx.ui.setWidget(WIDGET_KEY, undefined);
    }
  });
}
