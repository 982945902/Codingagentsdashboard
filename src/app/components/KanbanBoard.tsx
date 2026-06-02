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
        return "bg-[#3fb950]";
      case "error":
        return "bg-[#f85149]";
      case "idle":
        return "bg-[#d29922]";
      default:
        return "bg-[#6e7681]";
    }
  };

  const getStatusBgColor = (status: Agent["status"]) => {
    switch (status) {
      case "running":
        return "bg-[#3fb95033]";
      case "error":
        return "bg-[#f8514933]";
      case "idle":
        return "bg-[#d2940033]";
      default:
        return "bg-[#6e768133]";
    }
  };

  return (
    <div className="size-full overflow-y-auto bg-[#0d1117] p-6">
      {/* Global Stats */}
      <div className="mb-6">
        <h2 className="text-[#c9d1d9] mb-4">Global Statistics</h2>
        <div className="grid grid-cols-5 gap-4">
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
            <div className="flex items-center gap-2 text-[#8b949e] mb-2">
              <Activity className="w-4 h-4" />
              <span>Total Tokens</span>
            </div>
            <div className="text-2xl text-[#c9d1d9]">{formatNumber(globalStats.totalTokens)}</div>
          </div>

          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
            <div className="flex items-center gap-2 text-[#8b949e] mb-2">
              <DollarSign className="w-4 h-4" />
              <span>Total Cost</span>
            </div>
            <div className="text-2xl text-[#c9d1d9]">${globalStats.totalCost.toFixed(2)}</div>
          </div>

          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
            <div className="flex items-center gap-2 text-[#8b949e] mb-2">
              <Zap className="w-4 h-4" />
              <span>Avg Cache Hit</span>
            </div>
            <div className="text-2xl text-[#3fb950]">{globalStats.avgCacheHitRate.toFixed(0)}%</div>
          </div>

          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
            <div className="flex items-center gap-2 text-[#8b949e] mb-2">
              <TrendingUp className="w-4 h-4" />
              <span>API Calls</span>
            </div>
            <div className="text-2xl text-[#c9d1d9]">{globalStats.totalApiCalls}</div>
          </div>

          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
            <div className="flex items-center gap-2 text-[#8b949e] mb-2">
              <TrendingUp className="w-4 h-4" />
              <span>Success Rate</span>
            </div>
            <div className="text-2xl text-[#3fb950]">{globalStats.successRate.toFixed(1)}%</div>
          </div>
        </div>
      </div>

      {/* Agents Grid */}
      <div>
        <h2 className="text-[#c9d1d9] mb-4">Agents ({agents.length})</h2>
        <div className="grid grid-cols-2 gap-4">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => onSelectAgent(agent)}
              className="bg-[#161b22] border border-[#30363d] rounded-lg p-5 hover:border-[#58a6ff] transition-all text-left group"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${getStatusColor(agent.status)} shadow-lg`} />
                  <div>
                    <h3 className="text-[#c9d1d9] mb-1">{agent.name}</h3>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-[#8b949e]">{agent.model}</span>
                      {agent.branch && (
                        <>
                          <span className="text-[#30363d]">•</span>
                          <span className="text-[#8b949e]">{agent.branch}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className={`px-3 py-1 rounded-md ${getStatusBgColor(agent.status)} border border-[#30363d] text-[#0a0a0a]`}>
                  <span className="text-xs capitalize text-[#c9d1d9]">{agent.status}</span>
                </div>
              </div>

              {/* Current Task */}
              {agent.currentTask ? (
                <div className="mb-4 p-3 bg-[#0d1117] rounded-lg border border-[#30363d]">
                  <div className="text-xs text-[#8b949e] mb-1">Current Task</div>
                  <div className="text-sm text-[#c9d1d9] line-clamp-2">{agent.currentTask}</div>
                </div>
              ) : (
                <div className="mb-4 p-3 bg-[#0d1117] rounded-lg border border-[#30363d]">
                  <div className="text-sm text-[#8b949e]">No active task</div>
                </div>
              )}

              {/* Metrics Grid */}
              <div className="grid grid-cols-4 gap-2 mb-3">
                <div className="bg-[#0d1117] rounded-lg p-2 border border-[#30363d]">
                  <div className="text-xs text-[#8b949e] mb-1">Tokens</div>
                  <div className="text-sm text-[#c9d1d9]">
                    {formatNumber(agent.tokenUsage.input + agent.tokenUsage.output)}
                  </div>
                </div>

                <div className="bg-[#0d1117] rounded-lg p-2 border border-[#30363d]">
                  <div className="text-xs text-[#8b949e] mb-1">Cost</div>
                  <div className="text-sm text-[#c9d1d9]">${agent.costUSD.toFixed(2)}</div>
                </div>

                <div className="bg-[#0d1117] rounded-lg p-2 border border-[#30363d]">
                  <div className="text-xs text-[#8b949e] mb-1">Cache</div>
                  <div className="text-sm text-[#3fb950]">{agent.cacheHitRate}%</div>
                </div>

                <div className="bg-[#0d1117] rounded-lg p-2 border border-[#30363d]">
                  <div className="text-xs text-[#8b949e] mb-1">Tasks</div>
                  <div className="text-sm text-[#c9d1d9]">{agent.tasksCompleted}</div>
                </div>
              </div>

              {/* Context Usage Bar */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1.5 text-xs text-[#8b949e]">
                  <span>Context Usage</span>
                  <span>{agent.contextUsage}%</span>
                </div>
                <div className="w-full bg-[#21262d] rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all ${
                      agent.contextUsage >= 95
                        ? "bg-[#f85149]"
                        : agent.contextUsage >= 80
                        ? "bg-[#d29922]"
                        : "bg-[#58a6ff]"
                    }`}
                    style={{ width: `${agent.contextUsage}%` }}
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-[#30363d]">
                <div className="flex items-center gap-4 text-xs text-[#8b949e]">
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
                  <div className="flex items-center gap-1 text-[#f85149]">
                    <AlertCircle className="w-3 h-3" />
                    <span className="text-xs">Error</span>
                  </div>
                )}
              </div>

              {/* API Success Rate */}
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-[#8b949e]">API Success Rate</span>
                <span className="text-[#3fb950]">
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
