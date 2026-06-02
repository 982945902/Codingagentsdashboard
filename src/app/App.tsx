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
  cpu: number;
  memory: number;
  tasksCompleted: number;
  lastActive: string;
  branch?: string;
  logs: string[];
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
  const [view, setView] = useState<"kanban" | "workspace">("kanban");
  const [showSettings, setShowSettings] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  const [agents] = useState<Agent[]>([
    {
      id: "agent-001",
      name: "Frontend Builder",
      status: "running",
      currentTask: "Building React components for dashboard",
      uptime: "2h 34m",
      cpu: 45,
      memory: 62,
      tasksCompleted: 12,
      lastActive: "2 mins ago",
      branch: "feature/dashboard-ui",
      logs: [
        "[10:23] Starting build process...",
        "[10:24] Compiling components...",
        "[10:25] Build successful",
      ],
    },
    {
      id: "agent-002",
      name: "Backend API",
      status: "running",
      currentTask: "Optimizing database queries",
      uptime: "5h 12m",
      cpu: 28,
      memory: 48,
      tasksCompleted: 8,
      lastActive: "5 mins ago",
      branch: "feature/db-optimization",
      logs: [
        "[09:15] Connected to database",
        "[09:16] Analyzing query performance...",
        "[09:45] Applied index optimizations",
      ],
    },
    {
      id: "agent-003",
      name: "Testing Bot",
      status: "idle",
      currentTask: null,
      uptime: "1h 45m",
      cpu: 5,
      memory: 15,
      tasksCompleted: 24,
      lastActive: "15 mins ago",
      branch: "main",
      logs: [
        "[08:30] Test suite initialized",
        "[08:31] All tests passed (24/24)",
        "[08:32] Waiting for new tasks...",
      ],
    },
    {
      id: "agent-004",
      name: "Code Reviewer",
      status: "error",
      currentTask: "Connection lost during review",
      uptime: "3h 22m",
      cpu: 0,
      memory: 12,
      tasksCompleted: 6,
      lastActive: "1h ago",
      branch: "feature/auth-module",
      logs: [
        "[07:00] Starting code review...",
        "[07:15] Found 3 issues",
        "[07:30] ERROR: Connection timeout",
      ],
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

  return (
    <div className="size-full bg-[#0d1117] flex flex-col overflow-hidden">
      {/* Top Navigation Bar */}
      <div className="h-14 border-b border-[#30363d] bg-[#161b22] flex items-center justify-between px-5">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-[#21262d]">
            <Activity className="w-4 h-4 text-[#58a6ff]" />
          </div>
          <span className="text-[#c9d1d9]">Coding Agents</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[#21262d] border border-[#30363d]">
            <button
              onClick={() => setView("kanban")}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${
                view === "kanban"
                  ? "bg-[#1f6feb] text-white"
                  : "text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#30363d]"
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              <span>Kanban</span>
            </button>
            <button
              onClick={() => setView("workspace")}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${
                view === "workspace"
                  ? "bg-[#1f6feb] text-white"
                  : "text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#30363d]"
              }`}
            >
              <Terminal className="w-4 h-4" />
              <span>Workspace</span>
            </button>
          </div>

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
        {view === "kanban" ? (
          <KanbanBoard
            tasks={tasks}
            agents={agents}
            onSelectAgent={setSelectedAgent}
          />
        ) : (
          <WorkspacePanel
            agents={agents}
            selectedAgent={selectedAgent}
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