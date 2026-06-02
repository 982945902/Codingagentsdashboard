import { useState } from "react";
import { Agent } from "../App";
import {
  Terminal,
  Activity,
  Cpu,
  MemoryStick,
  GitBranch,
  Send,
  PlayCircle,
  PauseCircle,
  RotateCcw,
  XCircle,
} from "lucide-react";

interface WorkspacePanelProps {
  agents: Agent[];
  selectedAgent: Agent | null;
  onSelectAgent: (agent: Agent) => void;
}

export function WorkspacePanel({
  agents,
  selectedAgent,
  onSelectAgent,
}: WorkspacePanelProps) {
  const [command, setCommand] = useState("");
  const [terminalHistory, setTerminalHistory] = useState<string[]>([
    "$ Connection established",
  ]);

  const currentAgent = selectedAgent || agents[0];

  const handleSendCommand = () => {
    if (!command.trim()) return;

    setTerminalHistory([
      ...terminalHistory,
      `$ ${command}`,
      `> Command sent to ${currentAgent.name}`,
    ]);
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

  return (
    <div className="size-full flex bg-[#0d1117]">
      {/* Left Sidebar - Agent List */}
      <div className="w-64 border-r border-[#30363d] bg-[#0d1117] overflow-y-auto">
        <div className="p-3 border-b border-[#30363d]">
          <h3 className="text-[#c9d1d9]">Agents</h3>
          <p className="text-[#8b949e]">
            {agents.filter((a) => a.status === "running").length} active
          </p>
        </div>

        <div className="p-2 space-y-1">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => onSelectAgent(agent)}
              className={`w-full text-left p-3 rounded-md transition-colors ${
                currentAgent.id === agent.id
                  ? "bg-[#1f6feb] text-white"
                  : "text-[#c9d1d9] hover:bg-[#21262d]"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-2 h-2 rounded-full ${getStatusColor(agent.status)}`} />
                <span className="truncate">{agent.name}</span>
              </div>
              <div
                className={`text-sm opacity-70 truncate ${
                  currentAgent.id === agent.id ? "" : "text-[#8b949e]"
                }`}
              >
                {agent.currentTask || "Idle"}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Main Content - Split View */}
      <div className="flex-1 flex flex-col">
        {/* Agent Info Header */}
        <div className="h-14 border-b border-[#30363d] bg-[#161b22] flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${getStatusColor(currentAgent.status)}`} />
            <span className="text-[#c9d1d9]">{currentAgent.name}</span>
            {currentAgent.branch && (
              <>
                <div className="w-px h-4 bg-[#30363d]" />
                <div className="flex items-center gap-1.5 text-[#8b949e]">
                  <GitBranch className="w-3.5 h-3.5" />
                  <span>{currentAgent.branch}</span>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-[#8b949e]">
              <Cpu className="w-4 h-4" />
              <span>{currentAgent.cpu}%</span>
            </div>
            <div className="flex items-center gap-1.5 text-[#8b949e]">
              <MemoryStick className="w-4 h-4" />
              <span>{currentAgent.memory}%</span>
            </div>
            <div className="flex items-center gap-1.5 text-[#8b949e]">
              <Activity className="w-4 h-4" />
              <span>{currentAgent.uptime}</span>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="border-b border-[#30363d] bg-[#161b22] p-3">
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

        {/* Split Panes */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Terminal/Logs */}
          <div className="flex-1 flex flex-col border-r border-[#30363d]">
            <div className="h-10 border-b border-[#30363d] bg-[#161b22] flex items-center px-3 gap-2 text-[#8b949e]">
              <Terminal className="w-4 h-4" />
              <span>Terminal</span>
            </div>

            <div className="flex-1 bg-[#0d1117] text-[#3fb950] p-4 overflow-y-auto font-mono">
              {currentAgent.logs.map((log, idx) => (
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

          {/* Right: Agent Stats & Info */}
          <div className="w-80 flex flex-col bg-[#0d1117]">
            <div className="h-10 border-b border-[#30363d] bg-[#161b22] flex items-center px-3 gap-2 text-[#8b949e]">
              <Activity className="w-4 h-4" />
              <span>Agent Info</span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Status */}
              <div>
                <div className="text-[#8b949e] mb-2">Status</div>
                <div className="flex items-center gap-2 p-3 bg-[#161b22] rounded-lg border border-[#30363d]">
                  <div className={`w-3 h-3 rounded-full ${getStatusColor(currentAgent.status)}`} />
                  <span className="capitalize text-[#c9d1d9]">{currentAgent.status}</span>
                </div>
              </div>

              {/* Current Task */}
              {currentAgent.currentTask && (
                <div>
                  <div className="text-[#8b949e] mb-2">Current Task</div>
                  <div className="p-3 bg-[#161b22] rounded-lg border border-[#30363d] text-[#c9d1d9]">
                    {currentAgent.currentTask}
                  </div>
                </div>
              )}

              {/* Metrics */}
              <div>
                <div className="text-[#8b949e] mb-2">Metrics</div>
                <div className="space-y-2">
                  <div className="p-3 bg-[#161b22] rounded-lg border border-[#30363d]">
                    <div className="flex items-center justify-between mb-2 text-[#c9d1d9]">
                      <span>CPU Usage</span>
                      <span>{currentAgent.cpu}%</span>
                    </div>
                    <div className="w-full bg-[#21262d] rounded-full h-2">
                      <div
                        className="bg-[#58a6ff] h-2 rounded-full transition-all"
                        style={{ width: `${currentAgent.cpu}%` }}
                      />
                    </div>
                  </div>

                  <div className="p-3 bg-[#161b22] rounded-lg border border-[#30363d]">
                    <div className="flex items-center justify-between mb-2 text-[#c9d1d9]">
                      <span>Memory</span>
                      <span>{currentAgent.memory}%</span>
                    </div>
                    <div className="w-full bg-[#21262d] rounded-full h-2">
                      <div
                        className="bg-[#a371f7] h-2 rounded-full transition-all"
                        style={{ width: `${currentAgent.memory}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Statistics */}
              <div>
                <div className="text-[#8b949e] mb-2">Statistics</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 bg-[#161b22] rounded-lg border border-[#30363d]">
                    <div className="text-[#8b949e]">Uptime</div>
                    <div className="text-[#c9d1d9] mt-1">
                      {currentAgent.uptime}
                    </div>
                  </div>
                  <div className="p-3 bg-[#161b22] rounded-lg border border-[#30363d]">
                    <div className="text-[#8b949e]">Tasks</div>
                    <div className="text-[#c9d1d9] mt-1">
                      {currentAgent.tasksCompleted}
                    </div>
                  </div>
                </div>
              </div>

              {/* Last Active */}
              <div>
                <div className="text-[#8b949e] mb-2">Last Active</div>
                <div className="p-3 bg-[#161b22] rounded-lg border border-[#30363d] text-[#c9d1d9]">
                  {currentAgent.lastActive}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
