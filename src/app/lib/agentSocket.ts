import type { AgentSnapshot, ApiConfig } from "./api";

export interface AgentCommandAttachment {
  name: string;
  size: number;
  mimeType: string;
}

export interface AgentCommandRequest {
  command: string;
  attachments: AgentCommandAttachment[];
}

export type AgentEvent =
  | { type: "agent.created"; agent: AgentSnapshot }
  | { type: "agent.updated"; agent: AgentSnapshot }
  | { type: "agent.deleted"; agentId: string }
  | { type: "agent.log"; agentId: string; line: string }
  | { type: "command.ack"; agentId: string; command: string }
  | { type: "command.error"; agentId: string; message: string };

export type SocketState = "connecting" | "connected" | "closed" | "error";

export interface AgentSocket {
  sendCommand(agentId: string, payload: AgentCommandRequest): void;
  startAgent(agentId: string): void;
  stopAgent(agentId: string): void;
  close(): void;
}

interface AgentSocketHandlers {
  onEvent: (event: AgentEvent) => void;
  onStateChange?: (state: SocketState) => void;
}

function createWebSocketUrl(config: ApiConfig) {
  const wsUrl = new URL(config.serverUrl.trim());
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.pathname = "/ws/agents";
  wsUrl.search = "";
  wsUrl.searchParams.set("apiKey", config.apiKey);
  return wsUrl;
}

export function openAgentSocket(
  config: ApiConfig,
  handlers: AgentSocketHandlers,
): AgentSocket {
  const socket = new WebSocket(createWebSocketUrl(config));
  const pendingMessages: string[] = [];

  handlers.onStateChange?.("connecting");

  const send = (payload: unknown) => {
    const message = JSON.stringify(payload);

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(message);
      return;
    }

    if (socket.readyState === WebSocket.CONNECTING) {
      pendingMessages.push(message);
    }
  };

  socket.addEventListener("open", () => {
    handlers.onStateChange?.("connected");
    while (pendingMessages.length > 0) {
      const message = pendingMessages.shift();
      if (message) socket.send(message);
    }
  });

  socket.addEventListener("message", (message) => {
    try {
      handlers.onEvent(JSON.parse(message.data) as AgentEvent);
    } catch {
      handlers.onStateChange?.("error");
    }
  });

  socket.addEventListener("close", () => handlers.onStateChange?.("closed"));
  socket.addEventListener("error", () => handlers.onStateChange?.("error"));

  return {
    sendCommand(agentId, payload) {
      send({ type: "agent.command", agentId, payload });
    },
    startAgent(agentId) {
      send({ type: "agent.start", agentId });
    },
    stopAgent(agentId) {
      send({ type: "agent.stop", agentId });
    },
    close() {
      socket.close();
    },
  };
}
