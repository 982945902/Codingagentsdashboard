import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createAgent as createAgentRest,
  deleteAgent as deleteAgentRest,
  listAgents,
  sendAgentCommand,
  startAgent as startAgentRest,
  stopAgent as stopAgentRest,
  type AgentSnapshot,
  type ApiConfig,
  type CreateAgentRequest,
} from "../lib/api";
import {
  openAgentSocket,
  type AgentCommandRequest,
  type AgentEvent,
  type AgentMessage,
  type AgentSocket,
} from "../lib/agentSocket";

export type ConnectionState = "offline" | "connecting" | "connected" | "error";

function timestamp() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function appendLogs(agent: AgentSnapshot, lines: string[]): AgentSnapshot {
  return {
    ...agent,
    logs: [...agent.logs, ...lines].slice(-200),
    lastActive: "just now",
  };
}

function upsertAgent(current: AgentSnapshot[], nextAgent: AgentSnapshot) {
  return current.some((agent) => agent.id === nextAgent.id)
    ? current.map((agent) => (agent.id === nextAgent.id ? nextAgent : agent))
    : [...current, nextAgent];
}

function appendOrReplaceMessage(messages: AgentMessage[], next: AgentMessage) {
  return messages.some((m) => m.id === next.id)
    ? messages.map((m) => (m.id === next.id ? next : m))
    : [...messages, next];
}

function applyDelta(messages: AgentMessage[], messageId: string, delta: string) {
  const exists = messages.some((m) => m.id === messageId);
  if (!exists) {
    // Synthesize a placeholder if the start event was missed.
    return [
      ...messages,
      {
        id: messageId,
        role: "assistant" as const,
        content: delta,
        format: "markdown" as const,
        streaming: true,
        toolCalls: [],
        createdAt: new Date().toISOString(),
      },
    ];
  }
  return messages.map((m) =>
    m.id === messageId ? { ...m, content: m.content + delta, streaming: true } : m,
  );
}

function applyToolCall(
  messages: AgentMessage[],
  messageId: string,
  toolCallId: string,
  toolName: string,
  input: string,
) {
  return messages.map((m) => {
    if (m.id !== messageId) return m;
    if (m.toolCalls.some((tc) => tc.id === toolCallId)) return m;
    return {
      ...m,
      toolCalls: [
        ...m.toolCalls,
        { id: toolCallId, name: toolName, input, status: "pending" as const, output: "" },
      ],
    };
  });
}

function applyToolResult(
  messages: AgentMessage[],
  messageId: string,
  toolCallId: string,
  status: "success" | "error",
  output: string,
) {
  return messages.map((m) =>
    m.id === messageId
      ? {
          ...m,
          toolCalls: m.toolCalls.map((tc) =>
            tc.id === toolCallId ? { ...tc, status, output } : tc,
          ),
        }
      : m,
  );
}

function applyAgentEvent(current: AgentSnapshot[], event: AgentEvent): AgentSnapshot[] {
  switch (event.type) {
    case "agent.created":
    case "agent.updated":
      return upsertAgent(current, event.agent);
    case "agent.deleted":
      return current.filter((agent) => agent.id !== event.agentId);
    case "agent.log":
      return current.map((agent) =>
        agent.id === event.agentId ? appendLogs(agent, [event.line]) : agent,
      );
    case "command.ack":
      return current.map((agent) =>
        agent.id === event.agentId
          ? appendLogs(agent, [`[${timestamp()}] Command acknowledged: ${event.command}`])
          : agent,
      );
    case "command.error":
      return current.map((agent) =>
        agent.id === event.agentId
          ? {
              ...appendLogs(agent, [`[${timestamp()}] ERROR: ${event.message}`]),
              status: "error",
              currentTask: event.message,
            }
          : agent,
      );
    case "agent.message.start":
      return current.map((agent) =>
        agent.id === event.agentId
          ? { ...agent, messages: appendOrReplaceMessage(agent.messages, event.message) }
          : agent,
      );
    case "agent.message.delta":
      return current.map((agent) =>
        agent.id === event.agentId
          ? { ...agent, messages: applyDelta(agent.messages, event.messageId, event.delta) }
          : agent,
      );
    case "agent.message.end":
      return current.map((agent) =>
        agent.id === event.agentId
          ? { ...agent, messages: appendOrReplaceMessage(agent.messages, event.message) }
          : agent,
      );
    case "agent.tool.call":
      return current.map((agent) =>
        agent.id === event.agentId
          ? {
              ...agent,
              messages: applyToolCall(
                agent.messages,
                event.messageId,
                event.toolCallId,
                event.toolName,
                event.input,
              ),
            }
          : agent,
      );
    case "agent.tool.result":
      return current.map((agent) =>
        agent.id === event.agentId
          ? {
              ...agent,
              messages: applyToolResult(
                agent.messages,
                event.messageId,
                event.toolCallId,
                event.status,
                event.output,
              ),
            }
          : agent,
      );
    case "agent.turn.complete":
      return current;
    default:
      return current;
  }
}

export function useAgents(config: ApiConfig | null, fallbackAgents: AgentSnapshot[]) {
  const [agents, setAgents] = useState<AgentSnapshot[]>(fallbackAgents);
  const [socket, setSocket] = useState<AgentSocket | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("offline");

  useEffect(() => {
    if (!config) {
      setSocket(null);
      setAgents(fallbackAgents);
      setConnectionState("offline");
      return;
    }

    let cancelled = false;
    setConnectionState("connecting");

    listAgents(config)
      .then(({ agents: nextAgents }) => {
        if (cancelled) return;
        setAgents(nextAgents);
      })
      .catch(() => {
        if (!cancelled) setConnectionState("error");
      });

    const nextSocket = openAgentSocket(config, {
      onEvent: (event) => {
        if (!cancelled) setAgents((current) => applyAgentEvent(current, event));
      },
      onStateChange: (state) => {
        if (cancelled) return;
        if (state === "connected") setConnectionState("connected");
        if (state === "error") setConnectionState("error");
        if (state === "closed") setConnectionState("offline");
      },
    });

    setSocket(nextSocket);

    return () => {
      cancelled = true;
      nextSocket.close();
      setSocket(null);
    };
  }, [config?.serverUrl, config?.apiKey, fallbackAgents]);

  const sendCommand = useCallback(
    (agentId: string, payload: AgentCommandRequest) => {
      setAgents((current) =>
        current.map((agent) =>
          agent.id === agentId
            ? appendLogs(agent, [
                `[${timestamp()}] > ${payload.command.trim() || "(attachments only)"}`,
              ])
            : agent,
        ),
      );

      // Send via WebSocket only (avoid duplicate — REST + WS both trigger sendCommand on the backend)
      socket?.sendCommand(agentId, payload);
    },
    [socket, config],
  );

  const startAgent = useCallback(
    (agentId: string) => {
      setAgents((current) =>
        current.map((agent) =>
          agent.id === agentId
            ? appendLogs(agent, [`[${timestamp()}] Start requested`])
            : agent,
        ),
      );
      // WebSocket only — avoid duplicate REST + WS
      socket?.startAgent(agentId);
    },
    [socket, config],
  );

  const stopAgent = useCallback(
    (agentId: string) => {
      setAgents((current) =>
        current.map((agent) =>
          agent.id === agentId
            ? appendLogs(agent, [`[${timestamp()}] Stop requested`])
            : agent,
        ),
      );
      // WebSocket only — avoid duplicate REST + WS
      socket?.stopAgent(agentId);
    },
    [socket, config],
  );

  const createAgent = useCallback(
    async (request: CreateAgentRequest) => {
      if (!config) throw new Error("Not connected to a server");
      const { agent } = await createAgentRest(config, request);
      setAgents((current) => upsertAgent(current, agent));
      return agent;
    },
    [config],
  );

  const removeAgent = useCallback(
    async (agentId: string) => {
      if (!config) {
        setAgents((current) => current.filter((a) => a.id !== agentId));
        return;
      }
      await deleteAgentRest(config, agentId);
      setAgents((current) => current.filter((a) => a.id !== agentId));
    },
    [config],
  );

  return useMemo(
    () => ({
      agents,
      connectionState,
      sendCommand,
      startAgent,
      stopAgent,
      createAgent,
      removeAgent,
    }),
    [agents, connectionState, sendCommand, startAgent, stopAgent, createAgent, removeAgent],
  );
}