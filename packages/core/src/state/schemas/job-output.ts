/**
 * Zod schemas for job output messages (job-<id>.jsonl)
 *
 * Defines the schema for streaming job output from Claude SDK.
 * Each line in the JSONL file is a JobOutputMessage.
 */

import { z } from "zod";

// =============================================================================
// Message Type Schema
// =============================================================================

/**
 * Types of messages from Claude SDK streaming output
 */
export const JobOutputTypeSchema = z.enum([
  "system",
  "assistant",
  "tool_use",
  "tool_result",
  "error",
]);

// =============================================================================
// Base Message Schema
// =============================================================================

/**
 * Base fields present in all job output messages
 */
export const JobOutputBaseSchema = z.object({
  /** Message type */
  type: JobOutputTypeSchema,
  /** ISO timestamp when message was recorded */
  timestamp: z.string(),
});

// =============================================================================
// Specific Message Type Schemas
// =============================================================================

/**
 * System message schema
 */
export const SystemMessageSchema = JobOutputBaseSchema.extend({
  type: z.literal("system"),
  /** System message content */
  content: z.string().optional(),
  /** Optional subtype for system messages */
  subtype: z.string().optional(),
});

/**
 * Assistant message schema
 */
export const AssistantMessageSchema = JobOutputBaseSchema.extend({
  type: z.literal("assistant"),
  /** Assistant response content */
  content: z.string().optional(),
  /** Whether this is a partial/streaming chunk */
  partial: z.boolean().optional(),
  /** Token usage info if available */
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
});

/**
 * Tool use message schema
 */
export const ToolUseMessageSchema = JobOutputBaseSchema.extend({
  type: z.literal("tool_use"),
  /** Tool being invoked */
  tool_name: z.string(),
  /** Unique identifier for this tool call */
  tool_use_id: z.string().optional(),
  /** Tool input parameters */
  input: z.unknown().optional(),
});

/**
 * Tool result message schema
 */
export const ToolResultMessageSchema = JobOutputBaseSchema.extend({
  type: z.literal("tool_result"),
  /** ID of the tool call this is a result for */
  tool_use_id: z.string().optional(),
  /** Tool execution result */
  result: z.unknown().optional(),
  /** Whether the tool execution succeeded */
  success: z.boolean().optional(),
  /** Error message if tool failed */
  error: z.string().optional(),
});

/**
 * Error message schema
 */
export const ErrorMessageSchema = JobOutputBaseSchema.extend({
  type: z.literal("error"),
  /** Error message */
  message: z.string(),
  /** Error code if available */
  code: z.string().optional(),
  /** Stack trace if available */
  stack: z.string().optional(),
});

// =============================================================================
// Union Schema for All Message Types
// =============================================================================

/**
 * Schema that validates any job output message type
 */
export const JobOutputMessageSchema = z.discriminatedUnion("type", [
  SystemMessageSchema,
  AssistantMessageSchema,
  ToolUseMessageSchema,
  ToolResultMessageSchema,
  ErrorMessageSchema,
]);

// =============================================================================
// Type Exports
// =============================================================================

export type JobOutputType = z.infer<typeof JobOutputTypeSchema>;
export type JobOutputBase = z.infer<typeof JobOutputBaseSchema>;
export type SystemMessage = z.infer<typeof SystemMessageSchema>;
export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;
export type ToolUseMessage = z.infer<typeof ToolUseMessageSchema>;
export type ToolResultMessage = z.infer<typeof ToolResultMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type JobOutputMessage = z.infer<typeof JobOutputMessageSchema>;

// =============================================================================
// Input Types (without timestamp - added automatically)
// =============================================================================

/**
 * Input type for appending messages (timestamp added automatically)
 */
export type JobOutputInput =
  | Omit<SystemMessage, "timestamp">
  | Omit<AssistantMessage, "timestamp">
  | Omit<ToolUseMessage, "timestamp">
  | Omit<ToolResultMessage, "timestamp">
  | Omit<ErrorMessage, "timestamp">;

/**
 * Validate a job output message
 */
export function validateJobOutputMessage(message: unknown): JobOutputMessage | null {
  const result = JobOutputMessageSchema.safeParse(message);
  return result.success ? result.data : null;
}

/**
 * Check if a message has the minimum required fields
 */
export function isValidJobOutputInput(input: unknown): input is JobOutputInput {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  const obj = input as Record<string, unknown>;
  return typeof obj.type === "string" && JobOutputTypeSchema.safeParse(obj.type).success;
}
