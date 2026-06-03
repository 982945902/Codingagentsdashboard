import { useCallback, useEffect, useMemo, useState } from "react";
import type { Agent } from "../App";
import { listAgents, type AgentSnapshot, type ApiConfig } from "../lib/api";
import {
  openAgentSocket,
  type AgentCommandRequest,
  type AgentEvent,
  type AgentSocket,
} from "../lib/agentSocket";

export type ConnectionState = "offline" | "connecting" | "connected" | "error";

function timestamp() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function appendLogs(agent: AgentSnapshot, lines: string[]) {
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

function applyCommandUpdate(agent: AgentSnapshot, payload: AgentCommandRequest) {
  const normalizedCommand = payload.command.trim().toLowerCase();
  const attachmentSuffix =
    payload.attachments.length > 0
      ? ` with ${payload.attachments.length} attachment(s)`
      : "";
  const commandLabel = payload.command.trim() || "attachments";
  const nextAgent = appendLogs(agent, [
    `[${timestamp()}] Received command: ${commandLabel}${attachmentSuffix}`,
  ]);

  switch (normalizedCommand) {
    case "start":
      return {
        ...nextAgent,
        status: "running" as const,
        currentTask: nextAgent.currentTask ?? "Ready for commands",
      };
    case "pause":
      return { ...nextAgent, status: "idle" as const };
    case "restart":
      return {
        ...nextAgent,
        status: "running" as const,
        currentTask: nextAgent.currentTask ?? "Restarting workspace",
        apiCalls: {
          ...nextAgent.apiCalls,
          total: nextAgent.apiCalls.total + 1,
          success: nextAgent.apiCalls.success + 1,
        },
      };
    case "stop":
      return { ...nextAgent, status: "stopped" as const, currentTask: null };
    case "status":
      return appendLogs(nextAgent, [
        `[${timestamp()}] ${nextAgent.name}: ${nextAgent.status}, ${nextAgent.apiCalls.success}/${nextAgent.apiCalls.total} successful API calls`,
      ]);
    default: {
      const estimatedInput = Math.max(payload.command.length * 8, 120);
      const estimatedOutput = Math.max(Math.round(payload.command.length * 3.5), 60);

      return {
        ...nextAgent,
        status: "running" as const,
        currentTask: payload.command.trim() || nextAgent.currentTask,
        tokenUsage: {
          input: nextAgent.tokenUsage.input + estimatedInput,
          output: nextAgent.tokenUsage.output + estimatedOutput,
          cacheRead:
            nextAgent.tokenUsage.cacheRead + Math.round(estimatedInput * 0.4),
          cacheCreation:
            nextAgent.tokenUsage.cacheCreation + Math.round(estimatedInput * 0.08),
        },
        costUSD:
          nextAgent.costUSD +
          estimatedInput * 0.000003 +
          estimatedOutput * 0.000015,
        apiCalls: {
          ...nextAgent.apiCalls,
          total: nextAgent.apiCalls.total + 1,
          success: nextAgent.apiCalls.success + 1,
        },
        contextUsage: Math.min(nextAgent.contextUsage + 2, 98),
      };
    }
  }
}

function applyAgentEvent(current: AgentSnapshot[], event: AgentEvent) {
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
    default:
      return current;
  }
}

export function useAgents(config: ApiConfig | null, fallbackAgents: Agent[]) {
  const [agents, setAgents] = useState<AgentSnapshot[]>(fallbackAgents);
  const [socket, setSocket] = useState<AgentSocket | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("offline");

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
        if (!cancelled) {
          setAgents((current) => applyAgentEvent(current, event));
        }
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
          agent.id === agentId ? applyCommandUpdate(agent, payload) : agent,
        ),
      );
      socket?.sendCommand(agentId, payload);
    },
    [socket],
  );

  const startAgent = useCallback(
    (agentId: string) => {
      setAgents((current) =>
        current.map((agent) =>
          agent.id === agentId
            ? {
                ...appendLogs(agent, [`[${timestamp()}] Start requested`]),
                status: "running",
                currentTask: agent.currentTask ?? "Starting workspace",
              }
            : agent,
        ),
      );
      socket?.startAgent(agentId);
    },
    [socket],
  );

  const stopAgent = useCallback(
    (agentId: string) => {
      setAgents((current) =>
        current.map((agent) =>
          agent.id === agentId
            ? {
                ...appendLogs(agent, [`[${timestamp()}] Stop requested`]),
                status: "stopped",
                currentTask: null,
              }
            : agent,
        ),
      );
      socket?.stopAgent(agentId);
    },
    [socket],
  );

  return useMemo(
    () => ({ agents, connectionState, sendCommand, startAgent, stopAgent }),
    [agents, connectionState, sendCommand, startAgent, stopAgent],
  );
}
