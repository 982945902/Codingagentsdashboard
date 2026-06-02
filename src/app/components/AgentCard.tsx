import { Activity, CheckCircle, AlertCircle, Pause } from "lucide-react";

interface Agent {
  id: string;
  name: string;
  status: "running" | "idle" | "error" | "stopped";
  currentTask: string | null;
  uptime: string;
  cpu: number;
  memory: number;
  tasksCompleted: number;
  lastActive: string;
}

interface AgentCardProps {
  agent: Agent;
  onClick: () => void;
}

export function AgentCard({ agent, onClick }: AgentCardProps) {
  const statusConfig = {
    running: {
      icon: Activity,
      color: "text-green-600 dark:text-green-400",
      bg: "bg-green-500/10",
      label: "Running",
    },
    idle: {
      icon: Pause,
      color: "text-yellow-600 dark:text-yellow-400",
      bg: "bg-yellow-500/10",
      label: "Idle",
    },
    error: {
      icon: AlertCircle,
      color: "text-destructive",
      bg: "bg-destructive/10",
      label: "Error",
    },
    stopped: {
      icon: CheckCircle,
      color: "text-muted-foreground",
      bg: "bg-muted",
      label: "Stopped",
    },
  };

  const config = statusConfig[agent.status];
  const StatusIcon = config.icon;

  return (
    <button
      onClick={onClick}
      className="w-full bg-card border border-border rounded-xl p-4 hover:bg-accent transition-colors text-left"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${config.bg}`}>
            <StatusIcon className={`w-5 h-5 ${config.color}`} />
          </div>
          <div>
            <div className="text-card-foreground">{agent.name}</div>
            <div className="opacity-60 mt-0.5">ID: {agent.id}</div>
          </div>
        </div>
        <div className={`px-2 py-1 rounded-md ${config.bg}`}>
          <span className={`${config.color}`}>{config.label}</span>
        </div>
      </div>

      {/* Current Task */}
      {agent.currentTask && (
        <div className="mb-3 p-2 bg-secondary rounded-lg">
          <div className="opacity-70 mb-1">Current Task</div>
          <div className="text-secondary-foreground">{agent.currentTask}</div>
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-secondary rounded-lg p-2">
          <div className="opacity-70">CPU</div>
          <div className="flex items-baseline gap-1">
            <span className="text-secondary-foreground">{agent.cpu}</span>
            <span className="opacity-60">%</span>
          </div>
        </div>
        <div className="bg-secondary rounded-lg p-2">
          <div className="opacity-70">Memory</div>
          <div className="flex items-baseline gap-1">
            <span className="text-secondary-foreground">{agent.memory}</span>
            <span className="opacity-60">%</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between opacity-70">
        <span>Uptime: {agent.uptime}</span>
        <span>{agent.tasksCompleted} tasks</span>
      </div>
    </button>
  );
}
