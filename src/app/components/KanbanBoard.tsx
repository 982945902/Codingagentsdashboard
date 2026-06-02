import { Agent, Task } from "../App";
import { DollarSign, Zap, TrendingUp, Activity, Clock, AlertCircle } from "lucide-react";

interface GlobalStats {
  totalTokens: number;
  totalCost: number;
  avgCacheHitRate: number;
  totalApiCalls: number;
  successRate: number;
}

interface KanbanBoardProps {
  tasks: Task[];
  agents: Agent[];
  globalStats: GlobalStats;
  onSelectAgent: (agent: Agent) => void;
}

export function KanbanBoard({ tasks, agents, globalStats, onSelectAgent }: KanbanBoardProps) {
  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const getStatusColor = (status: Agent["status"]) => {
    switch (status) {
      case "running":
        return "bg-status-running";
      case "error":
        return "bg-status-error";
      case "idle":
        return "bg-status-idle";
      default:
        return "bg-status-stopped";
    }
  };

  const getStatusBgColor = (status: Agent["status"]) => {
    switch (status) {
      case "running":
        return "bg-status-running/20";
      case "error":
        return "bg-status-error/20";
      case "idle":
        return "bg-status-idle/20";
      default:
        return "bg-status-stopped/20";
    }
  };

  return (
    <div className="size-full overflow-y-auto bg-background p-3 lg:p-6">
      {/* Global Stats */}
      <div className="mb-4 lg:mb-6">
        <h2 className="text-card-foreground mb-3 lg:mb-4">Global Statistics</h2>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 lg:gap-4">
          <div className="bg-card border border-border rounded-lg p-3 lg:p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Activity className="w-3 h-3 lg:w-4 lg:h-4" />
              <span className="text-xs lg:text-sm">Total Tokens</span>
            </div>
            <div className="text-lg lg:text-2xl text-card-foreground">{formatNumber(globalStats.totalTokens)}</div>
          </div>

          <div className="bg-card border border-border rounded-lg p-3 lg:p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <DollarSign className="w-3 h-3 lg:w-4 lg:h-4" />
              <span className="text-xs lg:text-sm">Total Cost</span>
            </div>
            <div className="text-lg lg:text-2xl text-card-foreground">${globalStats.totalCost.toFixed(2)}</div>
          </div>

          <div className="bg-card border border-border rounded-lg p-3 lg:p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Zap className="w-3 h-3 lg:w-4 lg:h-4" />
              <span className="text-xs lg:text-sm">Avg Cache Hit</span>
            </div>
            <div className="text-lg lg:text-2xl text-success">{globalStats.avgCacheHitRate.toFixed(0)}%</div>
          </div>

          <div className="bg-card border border-border rounded-lg p-3 lg:p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <TrendingUp className="w-3 h-3 lg:w-4 lg:h-4" />
              <span className="text-xs lg:text-sm">API Calls</span>
            </div>
            <div className="text-lg lg:text-2xl text-card-foreground">{globalStats.totalApiCalls}</div>
          </div>

          <div className="bg-card border border-border rounded-lg p-3 lg:p-4 col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <TrendingUp className="w-3 h-3 lg:w-4 lg:h-4" />
              <span className="text-xs lg:text-sm">Success Rate</span>
            </div>
            <div className="text-lg lg:text-2xl text-success">{globalStats.successRate.toFixed(1)}%</div>
          </div>
        </div>
      </div>

      {/* Agents Grid */}
      <div>
        <h2 className="text-card-foreground mb-3 lg:mb-4">Agents ({agents.length})</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => onSelectAgent(agent)}
              className="bg-card border border-border rounded-lg p-4 lg:p-5 hover:border-primary transition-all text-left group"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3 lg:mb-4">
                <div className="flex items-center gap-2 lg:gap-3">
                  <div className={`w-3 h-3 rounded-full ${getStatusColor(agent.status)} shadow-lg`} />
                  <div>
                    <h3 className="text-card-foreground mb-1">{agent.name}</h3>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">{agent.model}</span>
                      {agent.branch && (
                        <>
                          <span className="text-border">•</span>
                          <span className="text-muted-foreground">{agent.branch}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className={`px-2 lg:px-3 py-1 rounded-md ${getStatusBgColor(agent.status)} border border-border`}>
                  <span className="text-xs capitalize text-card-foreground">{agent.status}</span>
                </div>
              </div>

              {/* Current Task */}
              {agent.currentTask ? (
                <div className="mb-3 lg:mb-4 p-2 lg:p-3 bg-background rounded-lg border border-border">
                  <div className="text-xs text-muted-foreground mb-1">Current Task</div>
                  <div className="text-sm text-card-foreground line-clamp-2">{agent.currentTask}</div>
                </div>
              ) : (
                <div className="mb-3 lg:mb-4 p-2 lg:p-3 bg-background rounded-lg border border-border">
                  <div className="text-sm text-muted-foreground">No active task</div>
                </div>
              )}

              {/* Metrics Grid */}
              <div className="grid grid-cols-4 gap-2 mb-3">
                <div className="bg-background rounded-lg p-2 border border-border">
                  <div className="text-xs text-muted-foreground mb-1">Tokens</div>
                  <div className="text-sm text-card-foreground truncate">
                    {formatNumber(agent.tokenUsage.input + agent.tokenUsage.output)}
                  </div>
                </div>

                <div className="bg-background rounded-lg p-2 border border-border">
                  <div className="text-xs text-muted-foreground mb-1">Cost</div>
                  <div className="text-sm text-card-foreground truncate">${agent.costUSD.toFixed(2)}</div>
                </div>

                <div className="bg-background rounded-lg p-2 border border-border">
                  <div className="text-xs text-muted-foreground mb-1">Cache</div>
                  <div className="text-sm text-success">{agent.cacheHitRate}%</div>
                </div>

                <div className="bg-background rounded-lg p-2 border border-border">
                  <div className="text-xs text-muted-foreground mb-1">Tasks</div>
                  <div className="text-sm text-card-foreground">{agent.tasksCompleted}</div>
                </div>
              </div>

              {/* Context Usage Bar */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1.5 text-xs text-muted-foreground">
                  <span>Context Usage</span>
                  <span>{agent.contextUsage}%</span>
                </div>
                <div className="w-full bg-secondary rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all ${
                      agent.contextUsage >= 95
                        ? "bg-status-error"
                        : agent.contextUsage >= 80
                        ? "bg-status-idle"
                        : "bg-primary"
                    }`}
                    style={{ width: `${agent.contextUsage}%` }}
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-border">
                <div className="flex items-center gap-3 lg:gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>{agent.uptime}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Activity className="w-3 h-3" />
                    <span>{agent.lastActive}</span>
                  </div>
                </div>

                {agent.status === "error" && (
                  <div className="flex items-center gap-1 text-destructive">
                    <AlertCircle className="w-3 h-3" />
                    <span className="text-xs">Error</span>
                  </div>
                )}
              </div>

              {/* API Success Rate */}
              <div className="mt-2 lg:mt-3 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">API Success Rate</span>
                <span className="text-success">
                  {((agent.apiCalls.success / agent.apiCalls.total) * 100).toFixed(1)}%
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
