import {
  createAgentSchema,
  type AgentEvent,
  type AgentSnapshot,
  type CreateAgentRequest,
} from "../src/shared/contracts";

export interface AgentStore {
  list(): AgentSnapshot[];
  get(id: string): AgentSnapshot | undefined;
  create(request: CreateAgentRequest): AgentSnapshot;
  update(id: string, patch: Partial<AgentSnapshot>): AgentSnapshot | undefined;
  appendLog(id: string, line: string): AgentSnapshot | undefined;
  events(): AgentEvent[];
}

const now = "2026-06-03T00:00:00.000Z";

const seededAgents: AgentSnapshot[] = [
  {
    id: "agent-001",
    name: "Frontend Builder",
    runtimeKind: "mock",
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
    tokenUsage: { input: 145230, output: 52340, cacheRead: 89450, cacheCreation: 12300 },
    costUSD: 2.45,
    cacheHitRate: 62,
    apiCalls: { total: 234, success: 232, errors: 2 },
    model: "claude-sonnet-4",
    contextUsage: 45,
    workspacePath: "/work/frontend",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "agent-002",
    name: "Backend API",
    runtimeKind: "mock",
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
    tokenUsage: { input: 98420, output: 34210, cacheRead: 45670, cacheCreation: 8900 },
    costUSD: 1.67,
    cacheHitRate: 48,
    apiCalls: { total: 156, success: 155, errors: 1 },
    model: "claude-sonnet-4",
    contextUsage: 28,
    workspacePath: "/work/backend",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "agent-003",
    name: "Testing Bot",
    runtimeKind: "mock",
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
    tokenUsage: { input: 234560, output: 89340, cacheRead: 156780, cacheCreation: 18900 },
    costUSD: 3.89,
    cacheHitRate: 71,
    apiCalls: { total: 412, success: 412, errors: 0 },
    model: "claude-sonnet-4",
    contextUsage: 15,
    workspacePath: "/work/testing",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "agent-004",
    name: "Code Reviewer",
    runtimeKind: "mock",
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
    tokenUsage: { input: 67890, output: 23450, cacheRead: 12340, cacheCreation: 5600 },
    costUSD: 1.12,
    cacheHitRate: 18,
    apiCalls: { total: 89, success: 86, errors: 3 },
    model: "claude-sonnet-4",
    contextUsage: 82,
    workspacePath: "/work/review",
    createdAt: now,
    updatedAt: now,
  },
];

function clone<T>(value: T): T {
  return structuredClone(value);
}

function event(agentId: string, type: AgentEvent["type"], message: string, snapshot?: AgentSnapshot): AgentEvent {
  return {
    id: crypto.randomUUID(),
    agentId,
    type,
    message,
    snapshot: snapshot ? clone(snapshot) : undefined,
    createdAt: new Date().toISOString(),
  };
}

export function createAgentStore(seed: AgentSnapshot[] = seededAgents): AgentStore {
  const agents = new Map(seed.map((agent) => [agent.id, clone(agent)]));
  const agentEvents: AgentEvent[] = [];

  return {
    list: () => [...agents.values()].map(clone),
    get: (id) => {
      const agent = agents.get(id);
      return agent ? clone(agent) : undefined;
    },
    create: (request) => {
      const parsed = createAgentSchema.parse(request);
      const createdAt = new Date().toISOString();
      const agent: AgentSnapshot = {
        id: `agent-${crypto.randomUUID().slice(0, 8)}`,
        name: parsed.name,
        runtimeKind: parsed.runtimeKind,
        status: "idle",
        currentTask: parsed.currentTask ?? null,
        uptime: "0m",
        tasksCompleted: 0,
        lastActive: "just now",
        branch: parsed.branch,
        logs: [`[${createdAt}] Agent created`],
        tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        costUSD: 0,
        cacheHitRate: 0,
        apiCalls: { total: 0, success: 0, errors: 0 },
        model: parsed.model,
        contextUsage: 0,
        workspacePath: parsed.workspacePath,
        createdAt,
        updatedAt: createdAt,
      };
      agents.set(agent.id, agent);
      agentEvents.push(event(agent.id, "created", "Agent created", agent));
      return clone(agent);
    },
    update: (id, patch) => {
      const current = agents.get(id);
      if (!current) return undefined;
      const next = { ...current, ...patch, id, updatedAt: new Date().toISOString() };
      agents.set(id, next);
      agentEvents.push(event(id, "updated", "Agent updated", next));
      return clone(next);
    },
    appendLog: (id, line) => {
      const current = agents.get(id);
      if (!current) return undefined;
      const next = {
        ...current,
        logs: [...current.logs, line].slice(-30),
        updatedAt: new Date().toISOString(),
      };
      agents.set(id, next);
      agentEvents.push(event(id, "log", line, next));
      return clone(next);
    },
    events: () => agentEvents.map(clone),
  };
}
