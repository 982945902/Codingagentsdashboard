import { useState } from "react";
import { Agent } from "../App";
import {
  Terminal,
  Activity,
  GitBranch,
  Send,
  PlayCircle,
  PauseCircle,
  RotateCcw,
  XCircle,
  DollarSign,
  Zap,
  TrendingUp,
  Database,
  Clock,
  AlertCircle,
} from "lucide-react";

interface WorkspacePanelProps {
  agent: Agent;
  onBack: () => void;
}

export function WorkspacePanel({ agent, onBack }: WorkspacePanelProps) {
  const [command, setCommand] = useState("");
  const [terminalHistory, setTerminalHistory] = useState<string[]>([
    "$ Connection established",
  ]);

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const handleSendCommand = () => {
    if (!command.trim()) return;

    setTerminalHistory([
      ...terminalHistory,
      `$ ${command}`,
      `> Command sent to ${agent.name}`,
    ]);
    console.log(`Sending command to ${agent.id}: ${command}`);
    setCommand("");
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

  const quickActions = [
    { icon: PlayCircle, label: "Start", cmd: "start" },
    { icon: PauseCircle, label: "Pause", cmd: "pause" },
    { icon: RotateCcw, label: "Restart", cmd: "restart" },
    { icon: XCircle, label: "Stop", cmd: "stop" },
  ];

  const totalTokens = agent.tokenUsage.input + agent.tokenUsage.output;
  const totalCacheTokens = agent.tokenUsage.cacheRead + agent.tokenUsage.cacheCreation;

  return (
    <div className="size-full flex bg-[#0d1117] overflow-hidden">
      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Agent Header */}
        <div className="border-b border-[#30363d] bg-[#161b22] p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${getStatusColor(agent.status)}`} />
              <span className="text-[#c9d1d9]">{agent.name}</span>
              {agent.branch && (
                <>
                  <div className="w-px h-4 bg-[#30363d]" />
                  <div className="flex items-center gap-1.5 text-[#8b949e]">
                    <GitBranch className="w-3.5 h-3.5" />
                    <span>{agent.branch}</span>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[#8b949e]">{agent.model}</span>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex gap-2">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.cmd}
                  onClick={() => setCommand(action.cmd)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-[#21262d] hover:bg-[#30363d] rounded-md transition-colors text-[#c9d1d9] border border-[#30363d]"
                >
                  <Icon className="w-4 h-4" />
                  <span>{action.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Model Metrics */}
        <div className="border-b border-[#30363d] bg-[#0d1117] p-4">
          <h3 className="text-[#c9d1d9] mb-3">Model Metrics</h3>
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3">
              <div className="flex items-center gap-2 text-[#8b949e] mb-2">
                <Activity className="w-4 h-4" />
                <span>Total Tokens</span>
              </div>
              <div className="text-xl text-[#c9d1d9] mb-1">{formatNumber(totalTokens)}</div>
              <div className="text-xs text-[#8b949e]">
                In: {formatNumber(agent.tokenUsage.input)} / Out: {formatNumber(agent.tokenUsage.output)}
              </div>
            </div>

            <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3">
              <div className="flex items-center gap-2 text-[#8b949e] mb-2">
                <Zap className="w-4 h-4" />
                <span>Cache</span>
              </div>
              <div className="text-xl text-[#3fb950] mb-1">{agent.cacheHitRate}%</div>
              <div className="text-xs text-[#8b949e]">
                {formatNumber(totalCacheTokens)} tokens
              </div>
            </div>

            <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3">
              <div className="flex items-center gap-2 text-[#8b949e] mb-2">
                <DollarSign className="w-4 h-4" />
                <span>Cost</span>
              </div>
              <div className="text-xl text-[#c9d1d9] mb-1">${agent.costUSD.toFixed(2)}</div>
              <div className="text-xs text-[#8b949e]">
                ${(agent.costUSD / agent.apiCalls.total).toFixed(4)}/call
              </div>
            </div>

            <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3">
              <div className="flex items-center gap-2 text-[#8b949e] mb-2">
                <TrendingUp className="w-4 h-4" />
                <span>API Calls</span>
              </div>
              <div className="text-xl text-[#c9d1d9] mb-1">{agent.apiCalls.total}</div>
              <div className="text-xs text-[#3fb950]">
                {((agent.apiCalls.success / agent.apiCalls.total) * 100).toFixed(1)}% success
              </div>
            </div>
          </div>

          {/* Context Usage Bar */}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1.5 text-[#8b949e]">
              <span>Context Window Usage</span>
              <span>{agent.contextUsage}%</span>
            </div>
            <div className="w-full bg-[#21262d] rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${
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
        </div>

        {/* Split Panes */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Terminal/Logs */}
          <div className="flex-1 flex flex-col border-r border-[#30363d]">
            <div className="h-10 border-b border-[#30363d] bg-[#161b22] flex items-center px-3 gap-2 text-[#8b949e]">
              <Terminal className="w-4 h-4" />
              <span>Terminal</span>
            </div>

            <div className="flex-1 bg-[#0d1117] text-[#3fb950] p-4 overflow-y-auto font-mono">
              {agent.logs.map((log, idx) => (
                <div key={idx} className="mb-1 text-[#3fb9a5]">
                  {log}
                </div>
              ))}
              {terminalHistory.map((line, idx) => (
                <div key={`history-${idx}`} className="mb-1 text-[#3fb998]">
                  {line}
                </div>
              ))}
            </div>

            {/* Command Input */}
            <div className="border-t border-[#30363d] bg-[#161b22] p-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === "Enter") handleSendCommand();
                  }}
                  placeholder="Enter command..."
                  className="flex-1 px-3 py-2 bg-[#0d1117] text-[#c9d1d9] rounded-md border border-[#30363d] focus:outline-none focus:border-[#1f6feb] font-mono"
                />
                <button
                  onClick={handleSendCommand}
                  disabled={!command.trim()}
                  className="px-4 py-2 bg-[#238636] text-white rounded-md hover:bg-[#2ea043] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Right: Detailed Stats */}
          <div className="w-80 flex flex-col bg-[#0d1117] overflow-y-auto">
            <div className="h-10 border-b border-[#30363d] bg-[#161b22] flex items-center px-3 gap-2 text-[#8b949e]">
              <Database className="w-4 h-4" />
              <span>Detailed Stats</span>
            </div>

            <div className="p-4 space-y-4">
              {/* Status */}
              <div>
                <div className="text-[#8b949e] mb-2">Status</div>
                <div className="flex items-center gap-2 p-3 bg-[#161b22] rounded-lg border border-[#30363d]">
                  <div className={`w-3 h-3 rounded-full ${getStatusColor(agent.status)}`} />
                  <span className="capitalize text-[#c9d1d9]">{agent.status}</span>
                </div>
              </div>

              {/* Current Task */}
              {agent.currentTask && (
                <div>
                  <div className="text-[#8b949e] mb-2">Current Task</div>
                  <div className="p-3 bg-[#161b22] rounded-lg border border-[#30363d] text-[#c9d1d9]">
                    {agent.currentTask}
                  </div>
                </div>
              )}

              {/* Token Breakdown */}
              <div>
                <div className="text-[#8b949e] mb-2">Token Breakdown</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2 bg-[#161b22] rounded border border-[#30363d]">
                    <span className="text-[#c9d1d9]">Input</span>
                    <span className="text-[#58a6ff]">{formatNumber(agent.tokenUsage.input)}</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-[#161b22] rounded border border-[#30363d]">
                    <span className="text-[#c9d1d9]">Output</span>
                    <span className="text-[#a371f7]">{formatNumber(agent.tokenUsage.output)}</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-[#161b22] rounded border border-[#30363d]">
                    <span className="text-[#c9d1d9]">Cache Read</span>
                    <span className="text-[#3fb950]">{formatNumber(agent.tokenUsage.cacheRead)}</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-[#161b22] rounded border border-[#30363d]">
                    <span className="text-[#c9d1d9]">Cache Creation</span>
                    <span className="text-[#8b949e]">{formatNumber(agent.tokenUsage.cacheCreation)}</span>
                  </div>
                </div>
              </div>

              {/* API Stats */}
              <div>
                <div className="text-[#8b949e] mb-2">API Statistics</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2 bg-[#161b22] rounded border border-[#30363d]">
                    <span className="text-[#c9d1d9]">Success</span>
                    <span className="text-[#3fb950]">{agent.apiCalls.success}</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-[#161b22] rounded border border-[#30363d]">
                    <span className="text-[#c9d1d9]">Errors</span>
                    <span className="text-[#f85149]">{agent.apiCalls.errors}</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-[#161b22] rounded border border-[#30363d]">
                    <span className="text-[#c9d1d9]">Success Rate</span>
                    <span className="text-[#c9d1d9]">
                      {((agent.apiCalls.success / agent.apiCalls.total) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* General Info */}
              <div>
                <div className="text-[#8b949e] mb-2">General Info</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 bg-[#161b22] rounded-lg border border-[#30363d]">
                    <div className="text-[#8b949e] flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Uptime
                    </div>
                    <div className="text-[#c9d1d9] mt-1">{agent.uptime}</div>
                  </div>
                  <div className="p-3 bg-[#161b22] rounded-lg border border-[#30363d]">
                    <div className="text-[#8b949e]">Tasks</div>
                    <div className="text-[#c9d1d9] mt-1">{agent.tasksCompleted}</div>
                  </div>
                </div>
              </div>

              {/* Last Active */}
              <div>
                <div className="text-[#8b949e] mb-2">Last Active</div>
                <div className="p-3 bg-[#161b22] rounded-lg border border-[#30363d] text-[#c9d1d9]">
                  {agent.lastActive}
                </div>
              </div>

              {/* Error Warning */}
              {agent.status === "error" && (
                <div className="p-3 bg-[#f8514933] rounded-lg border border-[#f8514966]">
                  <div className="flex items-center gap-2 text-[#ff7b72] mb-1">
                    <AlertCircle className="w-4 h-4" />
                    <span>Agent Error</span>
                  </div>
                  <div className="text-[#ff7b72]/80">
                    {agent.currentTask || "Agent encountered an error"}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
