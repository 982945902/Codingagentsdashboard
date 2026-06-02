import { useState } from "react";
import { KanbanBoard } from "./components/KanbanBoard";
import { WorkspacePanel } from "./components/WorkspacePanel";
import { ServerSettings } from "./components/ServerSettings";
import { Activity, Settings, LayoutGrid, Terminal } from "lucide-react";

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

export interface Task {
  id: string;
  title: string;
  description: string;
  status: "backlog" | "in-progress" | "review" | "done";
  assignedTo: string | null;
  priority: "low" | "medium" | "high";
  createdAt: string;
}

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  const [agents] = useState<Agent[]>([
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
  ]);

  const [tasks] = useState<Task[]>([
    {
      id: "task-001",
      title: "Implement user authentication",
      description: "Add JWT-based auth system",
      status: "in-progress",
      assignedTo: "agent-001",
      priority: "high",
      createdAt: "2026-06-02T08:00:00Z",
    },
    {
      id: "task-002",
      title: "Optimize database queries",
      description: "Improve query performance for dashboard",
      status: "in-progress",
      assignedTo: "agent-002",
      priority: "high",
      createdAt: "2026-06-02T07:30:00Z",
    },
    {
      id: "task-003",
      title: "Write unit tests",
      description: "Add test coverage for API endpoints",
      status: "done",
      assignedTo: "agent-003",
      priority: "medium",
      createdAt: "2026-06-02T06:00:00Z",
    },
    {
      id: "task-004",
      title: "Review PR #234",
      description: "Code review for authentication module",
      status: "review",
      assignedTo: "agent-004",
      priority: "high",
      createdAt: "2026-06-02T09:00:00Z",
    },
    {
      id: "task-005",
      title: "Setup CI/CD pipeline",
      description: "Configure GitHub Actions workflow",
      status: "backlog",
      assignedTo: null,
      priority: "medium",
      createdAt: "2026-06-02T10:00:00Z",
    },
  ]);

  // Calculate global stats
  const globalStats = {
    totalTokens: agents.reduce((sum, a) => sum + a.tokenUsage.input + a.tokenUsage.output, 0),
    totalCost: agents.reduce((sum, a) => sum + a.costUSD, 0),
    avgCacheHitRate: agents.reduce((sum, a) => sum + a.cacheHitRate, 0) / agents.length,
    totalApiCalls: agents.reduce((sum, a) => sum + a.apiCalls.total, 0),
    successRate: (agents.reduce((sum, a) => sum + a.apiCalls.success, 0) /
                  agents.reduce((sum, a) => sum + a.apiCalls.total, 0)) * 100,
  };

  return (
    <div className="size-full bg-[#0d1117] flex flex-col overflow-hidden">
      {/* Top Navigation Bar */}
      <div className="h-14 border-b border-[#30363d] bg-[#161b22] flex items-center justify-between px-5">
        <div className="flex items-center gap-3">
          {selectedAgent ? (
            <>
              <button
                onClick={() => setSelectedAgent(null)}
                className="p-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] transition-colors"
              >
                <LayoutGrid className="w-4 h-4 text-[#58a6ff]" />
              </button>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  selectedAgent.status === "running" ? "bg-[#3fb950]" :
                  selectedAgent.status === "error" ? "bg-[#f85149]" :
                  selectedAgent.status === "idle" ? "bg-[#d29922]" : "bg-[#6e7681]"
                }`} />
                <span className="text-[#c9d1d9]">{selectedAgent.name}</span>
              </div>
            </>
          ) : (
            <>
              <div className="p-1.5 rounded-lg bg-[#21262d]">
                <Activity className="w-4 h-4 text-[#58a6ff]" />
              </div>
              <span className="text-[#c9d1d9]">Coding Agents</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 rounded-lg bg-[#21262d] border border-[#30363d] hover:bg-[#30363d] transition-colors text-[#8b949e]"
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
            onBack={() => setSelectedAgent(null)}
          />
        ) : (
          <KanbanBoard
            tasks={tasks}
            agents={agents}
            globalStats={globalStats}
            onSelectAgent={setSelectedAgent}
          />
        )}
      </div>

      {/* Settings Sidebar */}
      {showSettings && (
        <ServerSettings onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}