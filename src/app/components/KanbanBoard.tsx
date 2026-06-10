import { useState } from "react";
import type { Agent } from "../App";
import type { CreateAgentRequest, RuntimeKind } from "../lib/api";
import {
  DollarSign,
  Zap,
  TrendingUp,
  Activity,
  Clock,
  AlertCircle,
  Plus,
  Trash2,
} from "lucide-react";

interface GlobalStats {
  totalTokens: number;
  totalCost: number;
  avgCacheHitRate: number;
  totalApiCalls: number;
  successRate: number;
}

interface KanbanBoardProps {
  agents: Agent[];
  globalStats: GlobalStats;
  onSelectAgent: (agent: Agent) => void;
  onCreateAgent: (request: CreateAgentRequest) => Promise<void>;
  onRemoveAgent: (agentId: string) => Promise<void>;
  canMutate: boolean;
}

export function KanbanBoard({
  agents,
  globalStats,
  onSelectAgent,
  onCreateAgent,
  onRemoveAgent,
  canMutate,
}: KanbanBoardProps) {
  const [showCreate, setShowCreate] = useState(false);

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

  const handleDelete = async (event: React.MouseEvent, agentId: string) => {
    event.stopPropagation();
    if (!window.confirm("Delete this agent? Running session will be stopped.")) return;
    try {
      await onRemoveAgent(agentId);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to delete agent");
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
        <div className="flex items-center justify-between mb-3 lg:mb-4">
          <h2 className="text-card-foreground">Agents ({agents.length})</h2>
          <button
            onClick={() => setShowCreate(true)}
            disabled={!canMutate}
            title={canMutate ? "Create a new agent" : "Connect to a server first"}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed text-xs lg:text-sm"
          >
            <Plus className="w-4 h-4" />
            <span>New Agent</span>
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="relative bg-card border border-border rounded-lg p-4 lg:p-5 hover:border-primary transition-all group"
            >
              {/* Delete button (top-right) */}
              {canMutate && (
                <button
                  onClick={(e) => handleDelete(e, agent.id)}
                  title="Delete agent"
                  className="absolute top-2 right-2 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => onSelectAgent(agent)}
                className="w-full text-left"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-3 lg:mb-4 pr-7">
                  <div className="flex items-center gap-2 lg:gap-3">
                    <div className={`w-3 h-3 rounded-full ${getStatusColor(agent.status)} shadow-lg`} />
                    <div>
                      <h3 className="text-card-foreground mb-1">{agent.name}</h3>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">{agent.runtimeKind}</span>
                        <span className="text-border">•</span>
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

                {agent.sessionId && (
                  <div className="mt-2 text-xs text-muted-foreground truncate">
                    session: <span className="font-mono">{agent.sessionId.slice(0, 12)}…</span>
                  </div>
                )}
              </button>
            </div>
          ))}
        </div>
      </div>

      {showCreate && (
        <CreateAgentDialog
          onClose={() => setShowCreate(false)}
          onSubmit={async (req) => {
            await onCreateAgent(req);
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

function CreateAgentDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (request: CreateAgentRequest) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [runtimeKind, setRuntimeKind] = useState<RuntimeKind>("codex");
  const [workspacePath, setWorkspacePath] = useState("");
  const [model, setModel] = useState("codex");
  const [sessionId, setSessionId] = useState("");
  const [runtimeArgs, setRuntimeArgs] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const args = runtimeArgs
        .split(/\s+/)
        .map((a: string) => a.trim())
        .filter(Boolean);
      await onSubmit({
        name: name.trim(),
        runtimeKind,
        workspacePath: workspacePath.trim(),
        model: model.trim() || "codex",
        sessionId: sessionId.trim() || undefined,
        runtimeArgs: args.length > 0 ? args : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-card border border-border rounded-2xl shadow-xl p-6 space-y-4"
      >
        <div>
          <h3 className="text-lg text-card-foreground">New Agent</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Spin up a real codex/claude session, or a deterministic mock for the UI.
          </p>
        </div>

        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
            placeholder="Frontend Builder"
          />
        </Field>

        <Field label="Runtime">
          <select
            value={runtimeKind}
            onChange={(e) => setRuntimeKind(e.target.value as RuntimeKind)}
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
          >
            <option value="mock">mock (deterministic stub)</option>
            <option value="codex">codex (codex exec --json)</option>
            <option value="claude">claude (claude -p stream-json)</option>
          </select>
        </Field>

        <Field label="Workspace path">
          <input
            value={workspacePath}
            onChange={(e) => setWorkspacePath(e.target.value)}
            required
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono"
            placeholder="/Users/me/code/my-project"
          />
        </Field>

        <Field label="Model">
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
            placeholder="codex / claude-sonnet-4"
          />
        </Field>

        <Field label="Resume session id (optional)">
          <input
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono"
            placeholder="e.g. abcdef12-..."
          />
        </Field>

        <Field label="Extra CLI args (space-separated, optional)">
          <input
            value={runtimeArgs}
            onChange={(e) => setRuntimeArgs(e.target.value)}
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono"
            placeholder="--model gpt-5"
          />
        </Field>

        {error && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm rounded-md bg-secondary hover:bg-accent text-secondary-foreground"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim() || !workspacePath.trim()}
            className="px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? "Creating…" : "Create agent"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  );
}