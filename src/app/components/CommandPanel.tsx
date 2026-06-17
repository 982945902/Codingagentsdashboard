import { useState } from "react";
import {
  X,
  Send,
  PlayCircle,
  PauseCircle,
  RefreshCw,
  Terminal,
} from "lucide-react";

interface Agent {
  id: string;
  name: string;
  status: "idle" | "running" | "busy" | "paused" | "stopped" | "error";
  currentTask: string | null;
  uptime: string;
  cpu: number;
  memory: number;
  tasksCompleted: number;
  lastActive: string;
}

interface CommandPanelProps {
  agent: Agent;
  onClose: () => void;
  onSendCommand: (agentId: string, command: string) => void;
}

export function CommandPanel({
  agent,
  onClose,
  onSendCommand,
}: CommandPanelProps) {
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<
    Array<{ type: "sent" | "received"; text: string; time: string }>
  >([
    {
      type: "received",
      text: `Agent ${agent.name} connected`,
      time: "10:23 AM",
    },
  ]);

  const handleSend = () => {
    if (!command.trim()) return;

    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });

    setHistory([
      ...history,
      { type: "sent", text: command, time: timeStr },
      {
        type: "received",
        text: `Command "${command}" queued for execution`,
        time: timeStr,
      },
    ]);

    onSendCommand(agent.id, command);
    setCommand("");
  };

  const quickCommands = [
    { icon: PlayCircle, label: "Start Task", cmd: "start" },
    { icon: PauseCircle, label: "Pause", cmd: "pause" },
    { icon: RefreshCw, label: "Restart", cmd: "restart" },
    { icon: Terminal, label: "Status", cmd: "status" },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
      <div className="fixed inset-x-0 bottom-0 bg-card border-t border-border rounded-t-2xl shadow-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h2 className="text-card-foreground">{agent.name}</h2>
            <div className="opacity-60 mt-0.5">Send commands</div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Commands */}
        <div className="p-4 border-b border-border">
          <div className="opacity-70 mb-2">Quick Commands</div>
          <div className="grid grid-cols-2 gap-2">
            {quickCommands.map((qc) => {
              const Icon = qc.icon;
              return (
                <button
                  key={qc.cmd}
                  onClick={() => setCommand(qc.cmd)}
                  className="flex items-center gap-2 p-3 bg-secondary rounded-lg hover:bg-accent transition-colors"
                >
                  <Icon className="w-4 h-4 text-secondary-foreground" />
                  <span className="text-secondary-foreground">{qc.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Command History */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {history.map((item, idx) => (
            <div
              key={idx}
              className={`flex ${
                item.type === "sent" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] rounded-lg p-3 ${
                  item.type === "sent"
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground"
                }`}
              >
                <div>{item.text}</div>
                <div className="opacity-60 mt-1">{item.time}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Input */}
        <div className="p-4 border-t border-border">
          <div className="flex gap-2">
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === "Enter") handleSend();
              }}
              placeholder="Enter command..."
              className="flex-1 px-4 py-3 bg-input-background rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              onClick={handleSend}
              disabled={!command.trim()}
              className="px-4 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
