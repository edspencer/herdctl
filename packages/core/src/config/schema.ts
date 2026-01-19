/**
 * Zod schemas for herdctl configuration files
 *
 * Validates herdctl.yaml fleet configuration
 */

import { z } from "zod";

// =============================================================================
// Permission Schemas
// =============================================================================

export const PermissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
]);

export const BashPermissionsSchema = z.object({
  allowed_commands: z.array(z.string()).optional(),
  denied_patterns: z.array(z.string()).optional(),
});

export const PermissionsSchema = z.object({
  mode: PermissionModeSchema.optional().default("acceptEdits"),
  allowed_tools: z.array(z.string()).optional(),
  denied_tools: z.array(z.string()).optional(),
  bash: BashPermissionsSchema.optional(),
});

// =============================================================================
// Work Source Schemas
// =============================================================================

export const WorkSourceTypeSchema = z.enum(["github"]);

export const WorkSourceLabelsSchema = z.object({
  ready: z.string().optional(),
  in_progress: z.string().optional(),
});

export const WorkSourceSchema = z.object({
  type: WorkSourceTypeSchema,
  labels: WorkSourceLabelsSchema.optional(),
  cleanup_in_progress: z.boolean().optional(),
});

// =============================================================================
// Instance Schemas
// =============================================================================

export const InstancesSchema = z.object({
  max_concurrent: z.number().int().positive().optional().default(1),
});

// =============================================================================
// Docker Schemas
// =============================================================================

export const DockerSchema = z.object({
  enabled: z.boolean().optional().default(false),
  base_image: z.string().optional(),
});

// =============================================================================
// Session Schema (for agent session config)
// Note: Defined here before DefaultsSchema to allow it to reference SessionSchema
// =============================================================================

export const SessionSchema = z.object({
  max_turns: z.number().int().positive().optional(),
  timeout: z.string().optional(), // e.g., "30m", "1h"
  model: z.string().optional(),
});

// =============================================================================
// Defaults Schema
// =============================================================================

export const DefaultsSchema = z.object({
  docker: DockerSchema.optional(),
  permissions: PermissionsSchema.optional(),
  work_source: WorkSourceSchema.optional(),
  instances: InstancesSchema.optional(),
  // Extended defaults for agent-level configuration
  session: SessionSchema.optional(),
  model: z.string().optional(),
  max_turns: z.number().int().positive().optional(),
  permission_mode: PermissionModeSchema.optional(),
});

// =============================================================================
// Workspace Schema
// =============================================================================

export const WorkspaceSchema = z.object({
  root: z.string(),
  auto_clone: z.boolean().optional().default(true),
  clone_depth: z.number().int().positive().optional().default(1),
  default_branch: z.string().optional().default("main"),
});

// =============================================================================
// Agent Reference Schema
// =============================================================================

export const AgentReferenceSchema = z.object({
  path: z.string(),
});

// =============================================================================
// Identity Schema (for agent identity)
// =============================================================================

export const IdentitySchema = z.object({
  name: z.string().optional(),
  role: z.string().optional(),
  personality: z.string().optional(),
});

// =============================================================================
// Schedule Schema (for agent schedules)
// =============================================================================

export const ScheduleTypeSchema = z.enum(["interval", "cron", "webhook", "chat"]);

export const ScheduleSchema = z.object({
  type: ScheduleTypeSchema,
  interval: z.string().optional(), // "5m", "1h", etc.
  expression: z.string().optional(), // cron expression
  prompt: z.string().optional(),
  work_source: WorkSourceSchema.optional(),
});

// =============================================================================
// MCP Server Schema
// =============================================================================

export const McpServerSchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
});

// =============================================================================
// Agent Chat Schema (agent-specific chat config)
// =============================================================================

export const AgentChatSchema = z.object({
  discord: z
    .object({
      channel_ids: z.array(z.string()).optional(),
      respond_to_mentions: z.boolean().optional().default(true),
    })
    .optional(),
});

// =============================================================================
// Agent Workspace Schema (can be string path or full workspace object)
// =============================================================================

export const AgentWorkspaceSchema = z.union([z.string(), WorkspaceSchema]);

// =============================================================================
// Agent Configuration Schema
// =============================================================================

export const AgentConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  workspace: AgentWorkspaceSchema.optional(),
  repo: z.string().optional(),
  identity: IdentitySchema.optional(),
  system_prompt: z.string().optional(),
  work_source: WorkSourceSchema.optional(),
  schedules: z.record(z.string(), ScheduleSchema).optional(),
  session: SessionSchema.optional(),
  permissions: PermissionsSchema.optional(),
  mcp_servers: z.record(z.string(), McpServerSchema).optional(),
  chat: AgentChatSchema.optional(),
  docker: DockerSchema.optional(),
  model: z.string().optional(),
  max_turns: z.number().int().positive().optional(),
  permission_mode: PermissionModeSchema.optional(),
});

// =============================================================================
// Chat Schemas
// =============================================================================

export const DiscordChatSchema = z.object({
  enabled: z.boolean().optional().default(false),
  token_env: z.string().optional(),
});

export const ChatSchema = z.object({
  discord: DiscordChatSchema.optional(),
});

// =============================================================================
// Webhook Schema
// =============================================================================

export const WebhooksSchema = z.object({
  enabled: z.boolean().optional().default(false),
  port: z.number().int().positive().optional().default(8081),
  secret_env: z.string().optional(),
});

// =============================================================================
// Fleet Configuration Schema
// =============================================================================

export const FleetConfigSchema = z.object({
  version: z.number().int().positive().default(1),
  fleet: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
    })
    .optional(),
  defaults: DefaultsSchema.optional(),
  workspace: WorkspaceSchema.optional(),
  agents: z.array(AgentReferenceSchema).optional().default([]),
  chat: ChatSchema.optional(),
  webhooks: WebhooksSchema.optional(),
  docker: DockerSchema.optional(),
});

// =============================================================================
// Type Exports
// =============================================================================

export type PermissionMode = z.infer<typeof PermissionModeSchema>;
export type BashPermissions = z.infer<typeof BashPermissionsSchema>;
export type Permissions = z.infer<typeof PermissionsSchema>;
export type WorkSourceType = z.infer<typeof WorkSourceTypeSchema>;
export type WorkSourceLabels = z.infer<typeof WorkSourceLabelsSchema>;
export type WorkSource = z.infer<typeof WorkSourceSchema>;
export type Instances = z.infer<typeof InstancesSchema>;
export type Docker = z.infer<typeof DockerSchema>;
export type Defaults = z.infer<typeof DefaultsSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type AgentReference = z.infer<typeof AgentReferenceSchema>;
export type DiscordChat = z.infer<typeof DiscordChatSchema>;
export type Chat = z.infer<typeof ChatSchema>;
export type Webhooks = z.infer<typeof WebhooksSchema>;
export type FleetConfig = z.infer<typeof FleetConfigSchema>;
export type Identity = z.infer<typeof IdentitySchema>;
export type Session = z.infer<typeof SessionSchema>;
export type ScheduleType = z.infer<typeof ScheduleTypeSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type McpServer = z.infer<typeof McpServerSchema>;
export type AgentChat = z.infer<typeof AgentChatSchema>;
export type AgentWorkspace = z.infer<typeof AgentWorkspaceSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
