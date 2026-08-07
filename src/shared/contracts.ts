import { z } from "zod";

export const runtimeKindSchema = z.enum(["codex", "claude", "pi"]);
export type RuntimeKind = z.infer<typeof runtimeKindSchema>;

export const controlModeSchema = z.enum(["managed", "attached"]);
export type ControlMode = z.infer<typeof controlModeSchema>;

export const connectionStatusSchema = z.enum(["online", "offline", "reconnecting"]);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

export const deliveryBehaviorSchema = z.enum(["auto", "steer", "followUp"]);
export type DeliveryBehavior = z.infer<typeof deliveryBehaviorSchema>;

export const agentStatusSchema = z.enum([
  "idle",
  "running",
  "busy",
  "paused",
  "stopped",
  "error",
]);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const approvalDecisionSchema = z.enum(["allow", "deny"]);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export const agentEventTypeSchema = z.enum([
  "created",
  "updated",
  "deleted",
  "log",
  "command",
  "error",
  "messageStart",
  "messageDelta",
  "messageEnd",
  "toolCall",
  "toolResult",
  "turnComplete",
  "approvalRequest",
  "approvalResolved",
]);
export type AgentEventType = z.infer<typeof agentEventTypeSchema>;

export const messageRoleSchema = z.enum(["user", "assistant", "system", "tool"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const agentMessageSchema = z.object({
  id: z.string().min(1),
  role: messageRoleSchema,
  content: z.string().default(""),
  format: z.enum(["text", "markdown"]).default("markdown"),
  /** When true, the message is still being streamed (deltas pending). */
  streaming: z.boolean().default(false),
  /** Tool/function calls attached to this assistant turn. */
  toolCalls: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        input: z.string().default(""),
        status: z.enum(["pending", "success", "error"]).default("pending"),
        output: z.string().default(""),
      }),
    )
    .default([]),
  createdAt: z.string().datetime(),
});
export type AgentMessage = z.infer<typeof agentMessageSchema>;

export const tokenUsageSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheCreation: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const apiCallsSchema = z.object({
  total: z.number().int().nonnegative(),
  success: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
});
export type ApiCalls = z.infer<typeof apiCallsSchema>;

export const agentSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  runtimeKind: runtimeKindSchema,
  controlMode: controlModeSchema.default("managed"),
  connectionStatus: connectionStatusSchema.default("offline"),
  status: agentStatusSchema,
  currentTask: z.string().nullable(),
  uptime: z.string(),
  tasksCompleted: z.number().int().nonnegative(),
  lastActive: z.string(),
  branch: z.string().optional(),
  logs: z.array(z.string()),
  tokenUsage: tokenUsageSchema,
  costUSD: z.number().nonnegative(),
  cacheHitRate: z.number().min(0).max(100),
  apiCalls: apiCallsSchema,
  model: z.string().min(1),
  provider: z.string().optional(),
  thinkingLevel: z.string().optional(),
  hostId: z.string().optional(),
  lastSeenAt: z.string().datetime().optional(),
  capabilities: z
    .object({
      prompt: z.boolean().default(true),
      steer: z.boolean().default(false),
      followUp: z.boolean().default(false),
      abort: z.boolean().default(false),
      compact: z.boolean().default(false),
      setModel: z.boolean().default(false),
      setThinkingLevel: z.boolean().default(false),
      attachments: z.boolean().default(false),
    })
    .optional(),
  contextUsage: z.number().min(0).max(100),
  workspacePath: z.string().min(1),
  /** Last known runtime session id (e.g. Codex/Claude session UUID for --resume). */
  sessionId: z.string().nullable().default(null),
  /** Extra args appended to the runtime CLI invocation. */
  runtimeArgs: z.array(z.string()).default([]),
  /** Structured chat messages exchanged with the agent. */
  messages: z.array(agentMessageSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AgentSnapshot = z.infer<typeof agentSnapshotSchema>;

export const agentEventSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  type: agentEventTypeSchema,
  message: z.string(),
  snapshot: agentSnapshotSchema.optional(),
  /** Optional structured payload accompanying the event (message delta, tool call, etc). */
  payload: z
    .object({
      messageId: z.string().optional(),
      role: messageRoleSchema.optional(),
      delta: z.string().optional(),
      message: agentMessageSchema.optional(),
      toolCallId: z.string().optional(),
      toolName: z.string().optional(),
      toolInput: z.string().optional(),
      toolOutput: z.string().optional(),
      toolStatus: z.enum(["pending", "success", "error"]).optional(),
      approvalId: z.string().optional(),
      approvalKind: z.string().optional(),
      approvalSummary: z.string().optional(),
      approvalDetails: z.string().optional(),
      approvalDecision: approvalDecisionSchema.optional(),
    })
    .partial()
    .optional(),
  createdAt: z.string().datetime(),
});
export type AgentEvent = z.infer<typeof agentEventSchema>;

export const createAgentSchema = z.object({
  name: z.string().trim().min(1),
  runtimeKind: runtimeKindSchema.default("codex"),
  controlMode: controlModeSchema.default("managed"),
  workspacePath: z.string().trim().min(1),
  model: z.string().trim().min(1).default("codex"),
  branch: z.string().trim().min(1).optional(),
  currentTask: z.string().trim().min(1).optional(),
  /** Resume an existing CLI session (codex/claude). */
  sessionId: z.string().trim().min(1).optional(),
  runtimeArgs: z.array(z.string()).optional(),
});
export type CreateAgentRequest = z.input<typeof createAgentSchema>;

export const agentCommandSchema = z.object({
  command: z.string().default(""),
  delivery: deliveryBehaviorSchema.default("auto"),
  attachments: z
    .array(
      z.object({
        name: z.string().min(1),
        size: z.number().int().nonnegative(),
        mimeType: z.string().min(1),
        encoding: z.enum(["text", "base64"]).optional(),
        content: z.string().max(262_144).optional(),
      }),
    )
    .default([]),
});
export type AgentCommandRequest = {
  command: string;
  delivery?: DeliveryBehavior;
  attachments?: Array<{
    name: string;
    size: number;
    mimeType: string;
    encoding?: "text" | "base64";
    content?: string;
  }>;
};

/**
 * Wire format for the WebSocket channel between dashboard and backend.
 * Outbound (server -> client) events.
 */
export const wsServerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("agent.created"), agent: agentSnapshotSchema }),
  z.object({ type: z.literal("agent.updated"), agent: agentSnapshotSchema }),
  z.object({ type: z.literal("agent.deleted"), agentId: z.string().min(1) }),
  z.object({
    type: z.literal("agent.log"),
    agentId: z.string().min(1),
    line: z.string(),
  }),
  z.object({
    type: z.literal("command.ack"),
    agentId: z.string().min(1),
    command: z.string(),
  }),
  z.object({
    type: z.literal("command.error"),
    agentId: z.string().min(1),
    message: z.string(),
  }),
  z.object({
    type: z.literal("agent.message.start"),
    agentId: z.string().min(1),
    message: agentMessageSchema,
  }),
  z.object({
    type: z.literal("agent.message.delta"),
    agentId: z.string().min(1),
    messageId: z.string().min(1),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("agent.message.end"),
    agentId: z.string().min(1),
    message: agentMessageSchema,
  }),
  z.object({
    type: z.literal("agent.tool.call"),
    agentId: z.string().min(1),
    messageId: z.string().min(1),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    input: z.string().default(""),
  }),
  z.object({
    type: z.literal("agent.tool.result"),
    agentId: z.string().min(1),
    messageId: z.string().min(1),
    toolCallId: z.string().min(1),
    status: z.enum(["success", "error"]),
    output: z.string().default(""),
  }),
  z.object({
    type: z.literal("agent.turn.complete"),
    agentId: z.string().min(1),
  }),
  z.object({
    type: z.literal("agent.approval.request"),
    agentId: z.string().min(1),
    approvalId: z.string().min(1),
    kind: z.string().min(1),
    summary: z.string(),
    details: z.string().optional(),
  }),
  z.object({
    type: z.literal("agent.approval.resolved"),
    agentId: z.string().min(1),
    approvalId: z.string().min(1),
    decision: approvalDecisionSchema,
  }),
]);
export type WsServerEvent = z.infer<typeof wsServerEventSchema>;

/** Inbound (client -> server) messages. */
export const wsClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("agent.start"), agentId: z.string().min(1) }),
  z.object({ type: z.literal("agent.pause"), agentId: z.string().min(1) }),
  z.object({ type: z.literal("agent.restart"), agentId: z.string().min(1) }),
  z.object({ type: z.literal("agent.stop"), agentId: z.string().min(1) }),
  z.object({
    type: z.literal("agent.abort"),
    agentId: z.string().min(1),
  }),
  z.object({
    type: z.literal("agent.command"),
    agentId: z.string().min(1),
    payload: agentCommandSchema,
  }),
  z.object({
    type: z.literal("agent.approval.response"),
    agentId: z.string().min(1),
    approvalId: z.string().min(1),
    decision: approvalDecisionSchema,
  }),
]);
export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;

const piBridgeCapabilitiesSchema = z.object({
  prompt: z.boolean().default(true),
  steer: z.boolean().default(true),
  followUp: z.boolean().default(true),
  abort: z.boolean().default(true),
  compact: z.boolean().default(true),
  setModel: z.boolean().default(false),
  setThinkingLevel: z.boolean().default(true),
  attachments: z.boolean().default(false),
});

export const piBridgeSnapshotSchema = z.object({
  messages: z.array(agentMessageSchema).default([]),
  contextPercent: z.number().min(0).max(100).nullable().optional(),
  contextTokens: z.number().int().nonnegative().nullable().optional(),
  contextWindow: z.number().int().positive().optional(),
});
export type PiBridgeSnapshot = z.infer<typeof piBridgeSnapshotSchema>;

export const piBridgeRegisterSchema = z.object({
  type: z.literal("pi.register"),
  version: z.literal(1),
  token: z.string().min(1),
  sessionId: z.string().min(1),
  hostId: z.string().min(1),
  name: z.string().min(1),
  cwd: z.string().min(1),
  provider: z.string().default("unknown"),
  model: z.string().min(1),
  thinkingLevel: z.string().default("off"),
  state: z.enum(["idle", "busy"]).default("idle"),
  capabilities: piBridgeCapabilitiesSchema,
  snapshot: piBridgeSnapshotSchema,
});
export type PiBridgeRegister = z.infer<typeof piBridgeRegisterSchema>;

const piBridgeAgentMessageEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message.start"), message: agentMessageSchema }),
  z.object({ kind: z.literal("message.delta"), messageId: z.string().min(1), delta: z.string() }),
  z.object({ kind: z.literal("message.end"), message: agentMessageSchema }),
  z.object({
    kind: z.literal("tool.call"),
    messageId: z.string().min(1),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    input: z.string().default(""),
  }),
  z.object({
    kind: z.literal("tool.result"),
    messageId: z.string().min(1),
    toolCallId: z.string().min(1),
    status: z.enum(["success", "error"]),
    output: z.string().default(""),
  }),
  z.object({ kind: z.literal("state"), state: z.enum(["idle", "busy"]) }),
  z.object({
    kind: z.literal("usage"),
    contextPercent: z.number().min(0).max(100).nullable().optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    cacheReadTokens: z.number().int().nonnegative().optional(),
    cacheCreationTokens: z.number().int().nonnegative().optional(),
    costUSD: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("metadata"),
    name: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
    thinkingLevel: z.string().min(1).optional(),
  }),
]);
export type PiBridgeAgentEvent = z.infer<typeof piBridgeAgentMessageEventSchema>;

export const piBridgeClientMessageSchema = z.discriminatedUnion("type", [
  piBridgeRegisterSchema,
  z.object({
    type: z.literal("pi.event"),
    version: z.literal(1),
    sessionId: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    event: piBridgeAgentMessageEventSchema,
  }),
  z.object({
    type: z.literal("pi.command.result"),
    version: z.literal(1),
    sessionId: z.string().min(1),
    commandId: z.string().min(1),
    accepted: z.boolean(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal("pi.heartbeat"),
    version: z.literal(1),
    sessionId: z.string().min(1),
  }),
]);
export type PiBridgeClientMessage = z.infer<typeof piBridgeClientMessageSchema>;

export const piBridgeServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("pi.registered"),
    version: z.literal(1),
    agentId: z.string().min(1),
  }),
  z.object({
    type: z.literal("pi.command"),
    version: z.literal(1),
    commandId: z.string().min(1),
    action: z.enum(["prompt", "abort", "compact"]),
    text: z.string().optional(),
    delivery: deliveryBehaviorSchema.optional(),
  }),
]);
export type PiBridgeServerMessage = z.infer<typeof piBridgeServerMessageSchema>;

export const serverSettingsSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.coerce.number().int().min(0).max(65535).default(8787),
  apiKey: z.string().min(1).default("dev-api-key"),
  /** Separate token used by Pi bridge extensions. Defaults to apiKey for local development. */
  piBridgeToken: z.string().min(1).default("dev-api-key"),
  corsOrigins: z.array(z.string().min(1)).default(["*"]),
  /** Path used to persist agent snapshots between restarts. Empty disables persistence. */
  persistencePath: z.string().default(".data/agents.json"),
  /** whisper.cpp CLI executable used by /api/transcribe. */
  whisperCppBin: z.string().trim().min(1).default("whisper-cli"),
  /** ggml model path. Empty disables voice transcription. */
  whisperCppModel: z.string().trim().default(""),
  /** Spoken language for whisper.cpp; "auto" enables auto-detection. */
  whisperLanguage: z.string().trim().min(1).default("auto"),
  /** ffmpeg executable used to convert browser-recorded formats to WAV. */
  ffmpegBin: z.string().trim().min(1).default("ffmpeg"),
});
export type ServerSettings = z.infer<typeof serverSettingsSchema>;
