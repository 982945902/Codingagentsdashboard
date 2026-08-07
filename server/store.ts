import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  agentSnapshotSchema,
  createAgentSchema,
  type AgentEvent,
  type AgentSnapshot,
  type CreateAgentRequest,
} from "../src/shared/contracts";
import type { RuntimeUsage } from "./runtimes/types";

export type StoreEvent =
  | { type: "created"; agent: AgentSnapshot }
  | { type: "updated"; agent: AgentSnapshot }
  | { type: "deleted"; agentId: string }
  | { type: "log"; agent: AgentSnapshot; line: string };

export type StoreListener = (event: StoreEvent) => void;

export interface AgentStore {
  list(): AgentSnapshot[];
  get(id: string): AgentSnapshot | undefined;
  create(request: CreateAgentRequest): AgentSnapshot;
  /** Create or update an externally attached runtime using a deterministic id. */
  upsertAttached(
    id: string,
    request: CreateAgentRequest,
    patch?: Partial<AgentSnapshot>,
  ): AgentSnapshot;
  update(id: string, patch: Partial<AgentSnapshot>): AgentSnapshot | undefined;
  /** Accumulate a runtime usage delta into tokenUsage/costUSD and derive cacheHitRate. */
  applyUsage(id: string, usage: RuntimeUsage): AgentSnapshot | undefined;
  /** Record one completed runtime turn (success) or runtime error in apiCalls. */
  recordApiCall(id: string, outcome: "success" | "error"): AgentSnapshot | undefined;
  delete(id: string): boolean;
  appendLog(id: string, line: string): AgentSnapshot | undefined;
  events(): AgentEvent[];
  subscribe(listener: StoreListener): () => void;
}

export interface AgentStoreOptions {
  seed?: AgentSnapshot[];
  /** Optional file path used to persist snapshots between server restarts. */
  persistencePath?: string;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function event(
  agentId: string,
  type: AgentEvent["type"],
  message: string,
  snapshot?: AgentSnapshot,
): AgentEvent {
  return {
    id: crypto.randomUUID(),
    agentId,
    type,
    message,
    snapshot: snapshot ? clone(snapshot) : undefined,
    createdAt: new Date().toISOString(),
  };
}

function loadFromDisk(path: string): AgentSnapshot[] | null {
  try {
    if (!existsSync(path)) return null;
    const text = readFileSync(path, "utf8");
    if (!text) return null;
    const parsed = JSON.parse(text) as AgentSnapshot[];
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((agent) => agentSnapshotSchema.safeParse(agent))
      .filter((result) => result.success)
      .map((result) => result.data);
  } catch {
    return null;
  }
}

function persistSafely(path: string, agents: AgentSnapshot[]) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(agents, null, 2));
  } catch {
    // Best-effort persistence — never block the request path.
  }
}

export function createAgentStore(
  optionsOrSeed: AgentSnapshot[] | AgentStoreOptions = {},
): AgentStore {
  const options: AgentStoreOptions = Array.isArray(optionsOrSeed)
    ? { seed: optionsOrSeed }
    : optionsOrSeed;
  const initialSeed = options.seed ?? [];
  const restoredFromDisk = options.persistencePath
    ? loadFromDisk(options.persistencePath)
    : null;
  const seed = restoredFromDisk ?? initialSeed;

  const agents = new Map(seed.map((agent) => [agent.id, clone(agent)]));
  const agentEvents: AgentEvent[] = [];
  const listeners = new Set<StoreListener>();

  function emit(storeEvent: StoreEvent) {
    for (const listener of listeners) {
      try {
        listener(storeEvent);
      } catch {
        // Listeners must not break the store.
      }
    }
    if (options.persistencePath) {
      persistSafely(options.persistencePath, [...agents.values()]);
    }
  }

  function updateAgent(
    id: string,
    patch: Partial<AgentSnapshot>,
  ): AgentSnapshot | undefined {
    const current = agents.get(id);
    if (!current) return undefined;
    const next: AgentSnapshot = {
      ...current,
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    };
    agents.set(id, next);
    agentEvents.push(event(id, "updated", "Agent updated", next));
    emit({ type: "updated", agent: clone(next) });
    return clone(next);
  }

  return {
    list: () => [...agents.values()].map(clone),
    get: (id) => {
      const agent = agents.get(id);
      return agent ? clone(agent) : undefined;
    },
    create: (request) => {
      const parsed = createAgentSchema.parse(request);
      if (parsed.runtimeKind === "pi" || parsed.controlMode === "attached") {
        throw new Error("Attached Pi runtimes must register through the Pi bridge");
      }
      const createdAt = new Date().toISOString();
      const agent: AgentSnapshot = {
        id: `agent-${crypto.randomUUID().slice(0, 8)}`,
        name: parsed.name,
        runtimeKind: parsed.runtimeKind,
        controlMode: parsed.controlMode,
        connectionStatus: "offline",
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
        sessionId: parsed.sessionId ?? null,
        runtimeArgs: parsed.runtimeArgs ?? [],
        messages: [],
        createdAt,
        updatedAt: createdAt,
      };
      agents.set(agent.id, agent);
      agentEvents.push(event(agent.id, "created", "Agent created", agent));
      emit({ type: "created", agent: clone(agent) });
      return clone(agent);
    },
    upsertAttached: (id, request, patch = {}) => {
      const existing = agents.get(id);
      if (existing) {
        return updateAgent(id, {
          ...patch,
          controlMode: "attached",
          updatedAt: new Date().toISOString(),
        })!;
      }
      const parsed = createAgentSchema.parse({ ...request, controlMode: "attached" });
      const createdAt = new Date().toISOString();
      const agent: AgentSnapshot = {
        id,
        name: parsed.name,
        runtimeKind: parsed.runtimeKind,
        controlMode: "attached",
        connectionStatus: "online",
        status: "running",
        currentTask: parsed.currentTask ?? null,
        uptime: "0m",
        tasksCompleted: 0,
        lastActive: "just now",
        branch: parsed.branch,
        logs: [`[${createdAt}] Attached runtime connected`],
        tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        costUSD: 0,
        cacheHitRate: 0,
        apiCalls: { total: 0, success: 0, errors: 0 },
        model: parsed.model,
        contextUsage: 0,
        workspacePath: parsed.workspacePath,
        sessionId: parsed.sessionId ?? null,
        runtimeArgs: parsed.runtimeArgs ?? [],
        messages: [],
        createdAt,
        updatedAt: createdAt,
        ...patch,
      };
      agents.set(id, agent);
      agentEvents.push(event(agent.id, "created", "Attached runtime connected", agent));
      emit({ type: "created", agent: clone(agent) });
      return clone(agent);
    },
    update: updateAgent,
    applyUsage: (id, usage) => {
      const current = agents.get(id);
      if (!current) return undefined;
      const add = (base: number, delta?: number) =>
        delta !== undefined && Number.isFinite(delta) && delta > 0
          ? Math.round(base + delta)
          : base;
      const tokenUsage = {
        input: add(current.tokenUsage.input, usage.inputTokens),
        output: add(current.tokenUsage.output, usage.outputTokens),
        cacheRead: add(current.tokenUsage.cacheRead, usage.cacheReadTokens),
        cacheCreation: add(current.tokenUsage.cacheCreation, usage.cacheCreationTokens),
      };
      const patch: Partial<AgentSnapshot> = { tokenUsage };
      if (usage.costUSD !== undefined && Number.isFinite(usage.costUSD) && usage.costUSD > 0) {
        patch.costUSD = current.costUSD + usage.costUSD;
      }
      const promptTokens = tokenUsage.input + tokenUsage.cacheRead;
      if (promptTokens > 0) {
        patch.cacheHitRate = Math.round((tokenUsage.cacheRead / promptTokens) * 100);
      }
      if (usage.contextPercent !== undefined && Number.isFinite(usage.contextPercent)) {
        patch.contextUsage = Math.min(100, Math.max(0, usage.contextPercent));
      }
      return updateAgent(id, patch);
    },
    recordApiCall: (id, outcome) => {
      const current = agents.get(id);
      if (!current) return undefined;
      return updateAgent(id, {
        apiCalls: {
          total: current.apiCalls.total + 1,
          success: current.apiCalls.success + (outcome === "success" ? 1 : 0),
          errors: current.apiCalls.errors + (outcome === "error" ? 1 : 0),
        },
      });
    },
    delete: (id) => {
      const existed = agents.delete(id);
      if (existed) {
        agentEvents.push(event(id, "deleted", "Agent deleted"));
        emit({ type: "deleted", agentId: id });
      }
      return existed;
    },
    appendLog: (id, line) => {
      const current = agents.get(id);
      if (!current) return undefined;
      const next: AgentSnapshot = {
        ...current,
        logs: [...current.logs, line].slice(-200),
        updatedAt: new Date().toISOString(),
      };
      agents.set(id, next);
      agentEvents.push(event(id, "log", line, next));
      emit({ type: "log", agent: clone(next), line });
      return clone(next);
    },
    events: () => agentEvents.map(clone),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
