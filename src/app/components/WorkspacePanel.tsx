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
        return "bg-status-running";
      case "error":
        return "bg-status-error";
      case "idle":
        return "bg-status-idle";
      default:
        return "bg-status-stopped";
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
    <div className="size-full flex flex-col lg:flex-row bg-background overflow-hidden">
      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Agent Header */}
        <div className="border-b border-border bg-card p-3 lg:p-4">
          <div className="flex items-center justify-between mb-3 lg:mb-4">
            <div className="flex items-center gap-2 lg:gap-3">
              <div className={`w-3 h-3 rounded-full ${getStatusColor(agent.status)}`} />
              <span className="text-card-foreground text-sm lg:text-base">{agent.name}</span>
              {agent.branch && (
                <>
                  <div className="w-px h-4 bg-border hidden lg:block" />
                  <div className="flex items-center gap-1.5 text-muted-foreground hidden lg:flex">
                    <GitBranch className="w-3.5 h-3.5" />
                    <span className="text-sm">{agent.branch}</span>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs lg:text-sm">{agent.model}</span>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex gap-2 overflow-x-auto">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.cmd}
                  onClick={() => setCommand(action.cmd)}
                  className="flex items-center gap-2 px-2 lg:px-3 py-1.5 bg-secondary hover:bg-accent rounded-md transition-colors text-secondary-foreground border border-border whitespace-nowrap"
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm">{action.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Model Metrics - Compact version */}
        <div className="border-b border-border bg-background px-3 py-2 lg:px-4 lg:py-2">
          {/* Mobile: 2 rows, Desktop: 1 row */}
          <div className="flex flex-wrap lg:flex-nowrap items-center gap-x-3 gap-y-1.5 lg:gap-4">
            {/* Tokens */}
            <div className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Tokens:</span>
              <span className="text-sm text-card-foreground">{formatNumber(totalTokens)}</span>
            </div>

            <div className="hidden lg:block w-px h-4 bg-border" />

            {/* Cache */}
            <div className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Cache:</span>
              <span className="text-sm text-success">{agent.cacheHitRate}%</span>
            </div>

            <div className="hidden lg:block w-px h-4 bg-border" />

            {/* Cost */}
            <div className="flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Cost:</span>
              <span className="text-sm text-card-foreground">${agent.costUSD.toFixed(2)}</span>
            </div>

            <div className="hidden lg:block w-px h-4 bg-border" />

            {/* API */}
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">API:</span>
              <span className="text-sm text-card-foreground">{agent.apiCalls.total}</span>
              <span className="text-xs text-success">
                ({((agent.apiCalls.success / agent.apiCalls.total) * 100).toFixed(0)}%)
              </span>
            </div>

            <div className="hidden lg:block w-px h-4 bg-border" />

            {/* Context */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Context:</span>
              <span className="text-sm text-card-foreground">{agent.contextUsage}%</span>
              <div className="w-12 lg:w-16 bg-secondary rounded-full h-1.5">
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
          </div>
        </div>

        {/* Terminal - Takes most space on mobile */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="h-10 border-b border-border bg-card flex items-center px-3 gap-2 text-muted-foreground">
            <Terminal className="w-4 h-4" />
            <span className="text-sm">Terminal</span>
          </div>

          <div className="flex-1 bg-background text-success p-3 lg:p-4 overflow-y-auto font-mono text-sm">
            {agent.logs.map((log, idx) => (
              <div key={idx} className="mb-1">
                {log}
              </div>
            ))}
            {terminalHistory.map((line, idx) => (
              <div key={`history-${idx}`} className="mb-1">
                {line}
              </div>
            ))}
          </div>

          {/* Command Input */}
          <div className="border-t border-border bg-card p-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") handleSendCommand();
                }}
                placeholder="Enter command..."
                className="flex-1 px-3 py-2 bg-input-background text-foreground rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-ring font-mono text-sm"
              />
              <button
                onClick={handleSendCommand}
                disabled={!command.trim()}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right: Detailed Stats - Hidden on mobile, shown as sidebar on desktop */}
      <div className="hidden lg:flex lg:w-80 flex-col bg-background overflow-y-auto border-l border-border">
        <div className="h-10 border-b border-border bg-card flex items-center px-3 gap-2 text-muted-foreground">
          <Database className="w-4 h-4" />
          <span>Detailed Stats</span>
        </div>

        <div className="p-4 space-y-4">
          {/* Status */}
          <div>
            <div className="text-muted-foreground mb-2">Status</div>
            <div className="flex items-center gap-2 p-3 bg-card rounded-lg border border-border">
              <div className={`w-3 h-3 rounded-full ${getStatusColor(agent.status)}`} />
              <span className="capitalize text-card-foreground">{agent.status}</span>
            </div>
          </div>

          {/* Current Task */}
          {agent.currentTask && (
            <div>
              <div className="text-muted-foreground mb-2">Current Task</div>
              <div className="p-3 bg-card rounded-lg border border-border text-card-foreground">
                {agent.currentTask}
              </div>
            </div>
          )}

          {/* Token Breakdown */}
          <div>
            <div className="text-muted-foreground mb-2">Token Breakdown</div>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 bg-card rounded border border-border">
                <span className="text-card-foreground">Input</span>
                <span className="text-primary">{formatNumber(agent.tokenUsage.input)}</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-card rounded border border-border">
                <span className="text-card-foreground">Output</span>
                <span className="text-accent-foreground">{formatNumber(agent.tokenUsage.output)}</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-card rounded border border-border">
                <span className="text-card-foreground">Cache Read</span>
                <span className="text-success">{formatNumber(agent.tokenUsage.cacheRead)}</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-card rounded border border-border">
                <span className="text-card-foreground">Cache Creation</span>
                <span className="text-muted-foreground">{formatNumber(agent.tokenUsage.cacheCreation)}</span>
              </div>
            </div>
          </div>

          {/* API Stats */}
          <div>
            <div className="text-muted-foreground mb-2">API Statistics</div>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 bg-card rounded border border-border">
                <span className="text-card-foreground">Success</span>
                <span className="text-success">{agent.apiCalls.success}</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-card rounded border border-border">
                <span className="text-card-foreground">Errors</span>
                <span className="text-destructive">{agent.apiCalls.errors}</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-card rounded border border-border">
                <span className="text-card-foreground">Success Rate</span>
                <span className="text-card-foreground">
                  {((agent.apiCalls.success / agent.apiCalls.total) * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          {/* General Info */}
          <div>
            <div className="text-muted-foreground mb-2">General Info</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 bg-card rounded-lg border border-border">
                <div className="text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Uptime
                </div>
                <div className="text-card-foreground mt-1">{agent.uptime}</div>
              </div>
              <div className="p-3 bg-card rounded-lg border border-border">
                <div className="text-muted-foreground">Tasks</div>
                <div className="text-card-foreground mt-1">{agent.tasksCompleted}</div>
              </div>
            </div>
          </div>

          {/* Last Active */}
          <div>
            <div className="text-muted-foreground mb-2">Last Active</div>
            <div className="p-3 bg-card rounded-lg border border-border text-card-foreground">
              {agent.lastActive}
            </div>
          </div>

          {/* Error Warning */}
          {agent.status === "error" && (
            <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/20">
              <div className="flex items-center gap-2 text-destructive mb-1">
                <AlertCircle className="w-4 h-4" />
                <span>Agent Error</span>
              </div>
              <div className="text-destructive-foreground">
                {agent.currentTask || "Agent encountered an error"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
