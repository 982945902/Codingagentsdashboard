import type { Agent } from "../App";

export interface ApiConfig {
  serverUrl: string;
  apiKey: string;
}

export interface CreateAgentRequest {
  name: string;
  runtimeKind?: "mock" | "codex" | "claude";
  workspacePath: string;
  model: string;
}

export type AgentSnapshot = Agent & {
  runtimeKind?: string;
  workspacePath?: string;
};

function normalizeServerUrl(serverUrl: string) {
  return serverUrl.trim().replace(/\/+$/, "");
}

async function requestJson<T>(
  config: ApiConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${normalizeServerUrl(config.serverUrl)}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`API ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

export function listAgents(config: ApiConfig) {
  return requestJson<{ agents: AgentSnapshot[] }>(config, "/api/agents");
}

export function createAgent(config: ApiConfig, body: CreateAgentRequest) {
  return requestJson<{ agent: AgentSnapshot }>(config, "/api/agents", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
