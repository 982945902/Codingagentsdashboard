import type { AgentMessage } from "./agentSocket";

export interface ApiConfig {
  serverUrl: string;
  apiKey: string;
}

export type RuntimeKind = "codex" | "claude";

export interface CreateAgentRequest {
  name: string;
  runtimeKind?: RuntimeKind;
  workspacePath: string;
  model: string;
  branch?: string;
  currentTask?: string;
  /** Resume an existing CLI session id (codex/claude). */
  sessionId?: string;
  runtimeArgs?: string[];
}

export interface CommandPayload {
  command: string;
  attachments?: Array<{ name: string; size: number; mimeType: string }>;
}

export interface TranscriptionResponse {
  text: string;
}

export interface AgentSnapshot {
  id: string;
  name: string;
  runtimeKind: RuntimeKind;
  status: "running" | "idle" | "error" | "stopped";
  currentTask: string | null;
  uptime: string;
  tasksCompleted: number;
  lastActive: string;
  branch?: string;
  logs: string[];
  tokenUsage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
  costUSD: number;
  cacheHitRate: number;
  apiCalls: { total: number; success: number; errors: number };
  model: string;
  contextUsage: number;
  workspacePath: string;
  sessionId: string | null;
  runtimeArgs: string[];
  messages: AgentMessage[];
  createdAt: string;
  updatedAt: string;
}

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

export function startAgent(config: ApiConfig, agentId: string) {
  return requestJson<{ ok: true }>(config, `/api/agents/${encodeURIComponent(agentId)}/start`, {
    method: "POST",
  });
}

export function stopAgent(config: ApiConfig, agentId: string) {
  return requestJson<{ ok: true }>(config, `/api/agents/${encodeURIComponent(agentId)}/stop`, {
    method: "POST",
  });
}

export function deleteAgent(config: ApiConfig, agentId: string) {
  return requestJson<{ ok: true }>(config, `/api/agents/${encodeURIComponent(agentId)}`, {
    method: "DELETE",
  });
}

export function sendAgentCommand(
  config: ApiConfig,
  agentId: string,
  payload: CommandPayload,
) {
  return requestJson<{ ok: true }>(
    config,
    `/api/agents/${encodeURIComponent(agentId)}/commands`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function transcribeAudio(
  config: ApiConfig,
  audio: Blob,
): Promise<TranscriptionResponse> {
  const form = new FormData();
  const extension = audio.type.includes("wav")
    ? "wav"
    : audio.type.includes("ogg")
      ? "ogg"
      : audio.type.includes("mpeg") || audio.type.includes("mp3")
        ? "mp3"
        : audio.type.includes("mp4")
          ? "mp4"
          : "webm";
  form.set("audio", audio, `voice.${extension}`);

  const response = await fetch(`${normalizeServerUrl(config.serverUrl)}/api/transcribe`, {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
    },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`API ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<TranscriptionResponse>;
}
