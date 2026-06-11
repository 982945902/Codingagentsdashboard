import { useCallback, useMemo, useState } from "react";
import { KanbanBoard } from "./components/KanbanBoard";
import { WorkspacePanel } from "./components/WorkspacePanel";
import {
  ServerSettings,
  type StoredServerSettings,
} from "./components/ServerSettings";
import { useAgents } from "./hooks/useAgents";
import {
  transcribeAudio,
  type ApiConfig,
  type CreateAgentRequest,
  type AgentSnapshot,
} from "./lib/api";
import type { AgentCommandAttachment } from "./lib/agentSocket";
import { Activity, Settings, LayoutGrid } from "lucide-react";

/** Re-export so child components can keep importing `Agent` from App. */
export type Agent = AgentSnapshot;

const SETTINGS_KEY = "coding-agents-dashboard:server-settings";
const SERVER_URL_PATTERN = /^https?:\/\/.+/i;

function loadApiConfig(): ApiConfig {
  const defaultConfig: ApiConfig = {
    serverUrl: `${window.location.protocol}//${window.location.host}`,
    apiKey: "dev-api-key",
  };

  try {
    const stored = window.localStorage.getItem(SETTINGS_KEY);
    if (!stored) return defaultConfig;

    const parsed = JSON.parse(stored) as Partial<StoredServerSettings>;
    if (
      !parsed.autoConnect ||
      !parsed.serverUrl?.trim() ||
      !parsed.apiKey?.trim() ||
      !SERVER_URL_PATTERN.test(parsed.serverUrl.trim())
    ) {
      return defaultConfig;
    }

    // If stored URL points to a different port on localhost, prefer same-origin
    // (the vite proxy handles routing to the backend)
    try {
      const storedUrl = new URL(parsed.serverUrl.trim());
      const currentHost = window.location.host;
      if (
        storedUrl.hostname === "localhost" ||
        storedUrl.hostname === "127.0.0.1"
      ) {
        if (storedUrl.host !== currentHost) {
          return defaultConfig;
        }
      }
    } catch {
      // URL parse failed, use default
      return defaultConfig;
    }

    return {
      serverUrl: parsed.serverUrl.trim(),
      apiKey: parsed.apiKey.trim(),
    };
  } catch {
    return defaultConfig;
  }
}

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [apiConfig, setApiConfig] = useState<ApiConfig>(() => loadApiConfig());
  const {
    agents,
    connectionState,
    pendingApprovals,
    sendCommand,
    startAgent,
    pauseAgent,
    restartAgent,
    stopAgent,
    respondToApproval,
    createAgent,
    removeAgent,
  } = useAgents(apiConfig);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  const handleSendCommand = (
    agentId: string,
    command: string,
    attachments: AgentCommandAttachment[] = [],
  ) => {
    sendCommand(agentId, { command, attachments });
    const agentName = agents.find((agent) => agent.id === agentId)?.name ?? "agent";
    return [`> Command sent to ${agentName}`];
  };

  const handleSettingsSaved = (settings: StoredServerSettings) => {
    const defaultConfig: ApiConfig = {
      serverUrl: `${window.location.protocol}//${window.location.host}`,
      apiKey: "dev-api-key",
    };
    setApiConfig(
      settings.autoConnect &&
        SERVER_URL_PATTERN.test(settings.serverUrl.trim()) &&
        settings.apiKey.trim()
        ? {
            serverUrl: settings.serverUrl.trim(),
            apiKey: settings.apiKey.trim(),
          }
        : defaultConfig,
    );
    setShowSettings(false);
  };

  const handleCreateAgent = async (request: CreateAgentRequest) => {
    const agent = await createAgent(request);
    setSelectedAgentId(agent.id);
  };

  const handleRemoveAgent = async (agentId: string) => {
    if (selectedAgentId === agentId) setSelectedAgentId(null);
    await removeAgent(agentId);
  };

  const handleTranscribeAudio = useCallback(
    async (audio: Blob) => {
      const { text } = await transcribeAudio(apiConfig, audio);
      return text;
    },
    [apiConfig],
  );

  const totalApiCalls = agents.reduce((sum, a) => sum + a.apiCalls.total, 0);
  const successfulApiCalls = agents.reduce((sum, a) => sum + a.apiCalls.success, 0);

  const globalStats = {
    totalTokens: agents.reduce((sum, a) => sum + a.tokenUsage.input + a.tokenUsage.output, 0),
    totalCost: agents.reduce((sum, a) => sum + a.costUSD, 0),
    avgCacheHitRate:
      agents.length > 0
        ? agents.reduce((sum, a) => sum + a.cacheHitRate, 0) / agents.length
        : 0,
    totalApiCalls,
    successRate: totalApiCalls > 0 ? (successfulApiCalls / totalApiCalls) * 100 : 0,
  };

  return (
    <div className="size-full bg-background flex flex-col overflow-hidden">
      {/* Top Navigation Bar */}
      <div className="h-12 lg:h-14 border-b border-border bg-card flex items-center justify-between px-3 lg:px-5">
        <div className="flex items-center gap-2 lg:gap-3">
          {selectedAgent ? (
            <>
              <button
                onClick={() => setSelectedAgentId(null)}
                className="p-1.5 rounded-lg bg-secondary hover:bg-accent transition-colors"
              >
                <LayoutGrid className="w-4 h-4 text-primary" />
              </button>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  selectedAgent.status === "running" ? "bg-status-running" :
                  selectedAgent.status === "busy" ? "bg-status-busy" :
                  selectedAgent.status === "paused" ? "bg-status-paused" :
                  selectedAgent.status === "error" ? "bg-status-error" :
                  selectedAgent.status === "idle" ? "bg-status-idle" : "bg-status-stopped"
                }`} />
                <span className="text-card-foreground text-sm lg:text-base">{selectedAgent.name}</span>
              </div>
            </>
          ) : (
            <>
              <div className="p-1.5 rounded-lg bg-secondary">
                <Activity className="w-4 h-4 text-primary" />
              </div>
              <span className="text-card-foreground text-sm lg:text-base">Coding Agents</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 px-2 py-1 rounded-md bg-secondary border border-border">
            <div
              className={`w-2 h-2 rounded-full ${
                connectionState === "connected"
                  ? "bg-status-running"
                  : connectionState === "connecting"
                  ? "bg-status-idle"
                  : connectionState === "error"
                  ? "bg-status-error"
                  : "bg-status-stopped"
              }`}
            />
            <span className="text-xs text-muted-foreground capitalize">
              {connectionState}
            </span>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 rounded-lg bg-secondary border border-border hover:bg-accent transition-colors text-muted-foreground"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {selectedAgent ? (
          <WorkspacePanel
            agent={selectedAgent}
            onBack={() => setSelectedAgentId(null)}
            onSendCommand={handleSendCommand}
            onStartAgent={startAgent}
            onPauseAgent={pauseAgent}
            onRestartAgent={restartAgent}
            onStopAgent={stopAgent}
            allAgents={agents}
            pendingApprovals={pendingApprovals[selectedAgent.id] ?? []}
            onRespondToApproval={respondToApproval}
            onTranscribeAudio={handleTranscribeAudio}
          />
        ) : (
          <KanbanBoard
            agents={agents}
            globalStats={globalStats}
            onSelectAgent={(agent) => setSelectedAgentId(agent.id)}
            onCreateAgent={handleCreateAgent}
            onRemoveAgent={handleRemoveAgent}
            canMutate={Boolean(apiConfig)}
          />
        )}
      </div>

      {/* Settings Sidebar */}
      {showSettings && (
        <ServerSettings
          onClose={() => setShowSettings(false)}
          onSaved={handleSettingsSaved}
        />
      )}
    </div>
  );
}
