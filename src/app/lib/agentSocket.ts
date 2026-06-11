import type { AgentSnapshot, ApiConfig } from "./api";

export interface AgentCommandAttachment {
  name: string;
  size: number;
  mimeType: string;
  encoding?: "text" | "base64";
  content?: string;
}

export interface AgentCommandRequest {
  command: string;
  attachments: AgentCommandAttachment[];
}

export interface AgentToolCall {
  id: string;
  name: string;
  input: string;
  status: "pending" | "success" | "error";
  output: string;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  format: "text" | "markdown";
  streaming: boolean;
  toolCalls: AgentToolCall[];
  createdAt: string;
}

export type AgentEvent =
  | { type: "agent.created"; agent: AgentSnapshot }
  | { type: "agent.updated"; agent: AgentSnapshot }
  | { type: "agent.deleted"; agentId: string }
  | { type: "agent.log"; agentId: string; line: string }
  | { type: "command.ack"; agentId: string; command: string }
  | { type: "command.error"; agentId: string; message: string }
  | { type: "agent.message.start"; agentId: string; message: AgentMessage }
  | { type: "agent.message.delta"; agentId: string; messageId: string; delta: string }
  | { type: "agent.message.end"; agentId: string; message: AgentMessage }
  | {
      type: "agent.tool.call";
      agentId: string;
      messageId: string;
      toolCallId: string;
      toolName: string;
      input: string;
    }
  | {
      type: "agent.tool.result";
      agentId: string;
      messageId: string;
      toolCallId: string;
      status: "success" | "error";
      output: string;
    }
  | { type: "agent.turn.complete"; agentId: string }
  | {
      type: "agent.approval.request";
      agentId: string;
      approvalId: string;
      kind: string;
      summary: string;
      details?: string;
    }
  | {
      type: "agent.approval.resolved";
      agentId: string;
      approvalId: string;
      decision: ApprovalDecision;
    };

export type ApprovalDecision = "allow" | "deny";

export type SocketState = "connecting" | "connected" | "closed" | "error";

export interface AgentSocket {
  sendCommand(agentId: string, payload: AgentCommandRequest): void;
  startAgent(agentId: string): void;
  pauseAgent(agentId: string): void;
  restartAgent(agentId: string): void;
  stopAgent(agentId: string): void;
  respondToApproval(agentId: string, approvalId: string, decision: ApprovalDecision): void;
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
    pauseAgent(agentId) {
      send({ type: "agent.pause", agentId });
    },
    restartAgent(agentId) {
      send({ type: "agent.restart", agentId });
    },
    stopAgent(agentId) {
      send({ type: "agent.stop", agentId });
    },
    respondToApproval(agentId, approvalId, decision) {
      send({ type: "agent.approval.response", agentId, approvalId, decision });
    },
    close() {
      socket.close();
    },
  };
}
