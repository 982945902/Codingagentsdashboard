import { z } from "zod";

export const runtimeKindSchema = z.enum(["mock", "codex", "claude"]);
export type RuntimeKind = z.infer<typeof runtimeKindSchema>;

export const agentStatusSchema = z.enum(["running", "idle", "error", "stopped"]);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const agentEventTypeSchema = z.enum([
  "created",
  "updated",
  "log",
  "command",
  "error",
]);
export type AgentEventType = z.infer<typeof agentEventTypeSchema>;

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
  contextUsage: z.number().min(0).max(100),
  workspacePath: z.string().min(1),
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
  createdAt: z.string().datetime(),
});
export type AgentEvent = z.infer<typeof agentEventSchema>;

export const createAgentSchema = z.object({
  name: z.string().trim().min(1),
  runtimeKind: runtimeKindSchema.default("mock"),
  workspacePath: z.string().trim().min(1),
  model: z.string().trim().min(1).default("codex"),
  branch: z.string().trim().min(1).optional(),
  currentTask: z.string().trim().min(1).optional(),
});
export type CreateAgentRequest = z.infer<typeof createAgentSchema>;

export const agentCommandSchema = z.object({
  command: z.string().default(""),
  attachments: z
    .array(
      z.object({
        name: z.string().min(1),
        size: z.number().int().nonnegative(),
        mimeType: z.string().min(1),
      }),
    )
    .default([]),
});
export type AgentCommandRequest = {
  command: string;
  attachments?: Array<{
    name: string;
    size: number;
    mimeType: string;
  }>;
};

export const serverSettingsSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().int().min(0).max(65535).default(8787),
  apiKey: z.string().min(1).default("dev-api-key"),
  corsOrigins: z.array(z.string().min(1)).default(["*"]),
});
export type ServerSettings = z.infer<typeof serverSettingsSchema>;
