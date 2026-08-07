import { createHash, timingSafeEqual } from "node:crypto";
import {
  piBridgeClientMessageSchema,
  type AgentSnapshot,
  type PiBridgeRegister,
} from "../src/shared/contracts";
import type { AgentSupervisor } from "./agentSupervisor";
import type { AgentStore } from "./store";
import { PiAttachedRuntime, type PiBridgeSocket } from "./runtimes/piAttachedRuntime";

interface Peer {
  key: string;
  agentId: string;
  sessionId: string;
  socket: PiBridgeSocket;
  runtime: PiAttachedRuntime;
  lastSequence: number;
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function agentIdFor(hostId: string, sessionId: string): string {
  const digest = createHash("sha256").update(`${hostId}\0${sessionId}`).digest("hex").slice(0, 20);
  return `agent-pi-${digest}`;
}

function mergeMessages(
  existing: AgentSnapshot["messages"],
  incoming: AgentSnapshot["messages"],
): AgentSnapshot["messages"] {
  const byId = new Map(existing.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-200);
}

export class PiBridgeManager {
  private readonly peersBySocket = new Map<PiBridgeSocket, Peer>();
  private readonly peersByKey = new Map<string, Peer>();
  private readonly dispatchQueues = new Map<PiBridgeSocket, Promise<void>>();

  constructor(
    private readonly store: AgentStore,
    private readonly supervisor: AgentSupervisor,
    private readonly token: string,
  ) {}

  dispatch(socket: PiBridgeSocket, raw: string): void {
    const previous = this.dispatchQueues.get(socket) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.handleMessage(socket, raw));
    this.dispatchQueues.set(socket, next);
    void next
      .catch(() => {
        try {
          socket.close(1011, "Pi bridge error");
        } catch {
          // Socket already closed.
        }
      })
      .finally(() => {
        if (this.dispatchQueues.get(socket) === next) this.dispatchQueues.delete(socket);
      });
  }

  async handleMessage(socket: PiBridgeSocket, raw: string): Promise<void> {
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      socket.close(1003, "Invalid JSON");
      return;
    }
    const parsed = piBridgeClientMessageSchema.safeParse(input);
    if (!parsed.success) {
      socket.close(1008, "Invalid Pi bridge message");
      return;
    }
    const message = parsed.data;

    if (message.type === "pi.register") {
      await this.register(socket, message);
      return;
    }

    const peer = this.peersBySocket.get(socket);
    if (!peer || peer.sessionId !== message.sessionId) {
      socket.close(1008, "Pi bridge is not registered");
      return;
    }

    if (message.type === "pi.event") {
      if (message.sequence <= peer.lastSequence) return;
      peer.lastSequence = message.sequence;
      if (message.event.kind === "metadata") {
        this.supervisor.updateAttachedAgent(peer.agentId, {
          ...(message.event.name ? { name: message.event.name } : {}),
          ...(message.event.model ? { model: message.event.model } : {}),
          ...(message.event.provider ? { provider: message.event.provider } : {}),
          ...(message.event.thinkingLevel ? { thinkingLevel: message.event.thinkingLevel } : {}),
          lastSeenAt: new Date().toISOString(),
        });
      } else {
        peer.runtime.ingest(message.event);
      }
      return;
    }

    if (message.type === "pi.command.result") {
      peer.runtime.receiveResult(message.commandId, message.accepted, message.error);
      return;
    }

    // Heartbeats intentionally do not persist on every frame. Connection close is
    // the authoritative offline signal and normal events refresh lastSeenAt.
  }

  disconnect(socket: PiBridgeSocket): void {
    const peer = this.peersBySocket.get(socket);
    if (!peer) return;
    this.peersBySocket.delete(socket);
    this.dispatchQueues.delete(socket);
    if (this.peersByKey.get(peer.key)?.socket !== socket) return;
    this.peersByKey.delete(peer.key);
    this.supervisor.detachAgentRuntime(peer.agentId, peer.runtime);
  }

  onlineCount(): number {
    return this.peersByKey.size;
  }

  private async register(socket: PiBridgeSocket, message: PiBridgeRegister): Promise<void> {
    if (!secureEqual(message.token, this.token)) {
      socket.close(1008, "Unauthorized");
      return;
    }

    const key = `${message.hostId}\0${message.sessionId}`;
    const agentId = agentIdFor(message.hostId, message.sessionId);
    const previous = this.peersByKey.get(key);
    if (previous && previous.socket !== socket) {
      previous.socket.close(4001, "Replaced by a newer Pi bridge connection");
      this.peersBySocket.delete(previous.socket);
    }

    const existing = this.store.get(agentId);
    const now = new Date().toISOString();
    const patch: Partial<AgentSnapshot> = {
      name: message.name,
      runtimeKind: "pi",
      controlMode: "attached",
      connectionStatus: "online",
      status: message.state === "busy" ? "busy" : "running",
      workspacePath: message.cwd,
      sessionId: message.sessionId,
      hostId: message.hostId,
      provider: message.provider,
      model: message.model,
      thinkingLevel: message.thinkingLevel,
      capabilities: message.capabilities,
      contextUsage: message.snapshot.contextPercent ?? 0,
      messages: mergeMessages(existing?.messages ?? [], message.snapshot.messages),
      lastSeenAt: now,
      lastActive: "just now",
    };
    this.store.upsertAttached(
      agentId,
      {
        name: message.name,
        runtimeKind: "pi",
        controlMode: "attached",
        workspacePath: message.cwd,
        model: message.model,
        sessionId: message.sessionId,
      },
      patch,
    );

    const runtime = new PiAttachedRuntime(message.sessionId, socket);
    const peer: Peer = {
      key,
      agentId,
      sessionId: message.sessionId,
      socket,
      runtime,
      lastSequence: -1,
    };
    this.peersBySocket.set(socket, peer);
    this.peersByKey.set(key, peer);
    await this.supervisor.attachAgentRuntime(agentId, runtime);
    runtime.ingest({ kind: "state", state: message.state });
    socket.send(JSON.stringify({ type: "pi.registered", version: 1, agentId }));
  }
}
