import { useMemo, useState } from "react";
import { KanbanBoard } from "./components/KanbanBoard";
import { WorkspacePanel } from "./components/WorkspacePanel";
import {
  ServerSettings,
  type StoredServerSettings,
} from "./components/ServerSettings";
import { useAgents } from "./hooks/useAgents";
import type { ApiConfig } from "./lib/api";
import type { AgentCommandAttachment } from "./lib/agentSocket";
import { Activity, Settings, LayoutGrid } from "lucide-react";

export interface Agent {
  id: string;
  name: string;
  status: "running" | "idle" | "error" | "stopped";
  currentTask: string | null;
  uptime: string;
  tasksCompleted: number;
  lastActive: string;
  branch?: string;
  logs: string[];
  // Model metrics
  tokenUsage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
  costUSD: number;
  cacheHitRate: number;
  apiCalls: {
    total: number;
    success: number;
    errors: number;
  };
  model: string;
  contextUsage: number; // Percentage of context window used
}

const SETTINGS_KEY = "coding-agents-dashboard:server-settings";
const SERVER_URL_PATTERN = /^https?:\/\/.+/i;

const INITIAL_AGENTS: Agent[] = [
    {
      id: "agent-001",
      name: "Frontend Builder",
      status: "running",
      currentTask: "Building React components for dashboard",
      uptime: "2h 34m",
      tasksCompleted: 12,
      lastActive: "2 mins ago",
      branch: "feature/dashboard-ui",
      logs: [
        "[10:23] Starting build process...",
        "[10:24] Compiling components...",
        "[10:25] Build successful",
      ],
      tokenUsage: {
        input: 145230,
        output: 52340,
        cacheRead: 89450,
        cacheCreation: 12300,
      },
      costUSD: 2.45,
      cacheHitRate: 62,
      apiCalls: { total: 234, success: 232, errors: 2 },
      model: "claude-sonnet-4",
      contextUsage: 45,
    },
    {
      id: "agent-002",
      name: "Backend API",
      status: "running",
      currentTask: "Optimizing database queries",
      uptime: "5h 12m",
      tasksCompleted: 8,
      lastActive: "5 mins ago",
      branch: "feature/db-optimization",
      logs: [
        "[09:15] Connected to database",
        "[09:16] Analyzing query performance...",
        "[09:45] Applied index optimizations",
      ],
      tokenUsage: {
        input: 98420,
        output: 34210,
        cacheRead: 45670,
        cacheCreation: 8900,
      },
      costUSD: 1.67,
      cacheHitRate: 48,
      apiCalls: { total: 156, success: 155, errors: 1 },
      model: "claude-sonnet-4",
      contextUsage: 28,
    },
    {
      id: "agent-003",
      name: "Testing Bot",
      status: "idle",
      currentTask: null,
      uptime: "1h 45m",
      tasksCompleted: 24,
      lastActive: "15 mins ago",
      branch: "main",
      logs: [
        "[08:30] Test suite initialized",
        "[08:31] All tests passed (24/24)",
        "[08:32] Waiting for new tasks...",
      ],
      tokenUsage: {
        input: 234560,
        output: 89340,
        cacheRead: 156780,
        cacheCreation: 18900,
      },
      costUSD: 3.89,
      cacheHitRate: 71,
      apiCalls: { total: 412, success: 412, errors: 0 },
      model: "claude-sonnet-4",
      contextUsage: 15,
    },
    {
      id: "agent-004",
      name: "Code Reviewer",
      status: "error",
      currentTask: "Connection lost during review",
      uptime: "3h 22m",
      tasksCompleted: 6,
      lastActive: "1h ago",
      branch: "feature/auth-module",
      logs: [
        "[07:00] Starting code review...",
        "[07:15] Found 3 issues",
        "[07:30] ERROR: Connection timeout",
      ],
      tokenUsage: {
        input: 67890,
        output: 23450,
        cacheRead: 12340,
        cacheCreation: 5600,
      },
      costUSD: 1.12,
      cacheHitRate: 18,
      apiCalls: { total: 89, success: 86, errors: 3 },
      model: "claude-sonnet-4",
      contextUsage: 82,
    },
];

function loadApiConfig(): ApiConfig | null {
  try {
    const stored = window.localStorage.getItem(SETTINGS_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as Partial<StoredServerSettings>;
    if (
      !parsed.autoConnect ||
      !parsed.serverUrl?.trim() ||
      !parsed.apiKey?.trim() ||
      !SERVER_URL_PATTERN.test(parsed.serverUrl.trim())
    ) {
      return null;
    }

    return {
      serverUrl: parsed.serverUrl.trim(),
      apiKey: parsed.apiKey.trim(),
    };
  } catch {
    return null;
  }
}

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(() => loadApiConfig());
  const { agents, connectionState, sendCommand, startAgent, stopAgent } =
    useAgents(apiConfig, INITIAL_AGENTS);

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
    setApiConfig(
      settings.autoConnect &&
        SERVER_URL_PATTERN.test(settings.serverUrl.trim()) &&
        settings.apiKey.trim()
        ? {
            serverUrl: settings.serverUrl.trim(),
            apiKey: settings.apiKey.trim(),
          }
        : null,
    );
    setShowSettings(false);
  };

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
            onStopAgent={stopAgent}
          />
        ) : (
          <KanbanBoard
            agents={agents}
            globalStats={globalStats}
            onSelectAgent={(agent) => setSelectedAgentId(agent.id)}
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
