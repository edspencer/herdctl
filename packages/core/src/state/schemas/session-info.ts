/**
 * Zod schemas for session info (sessions/<agent-name>.json)
 *
 * Defines the schema for tracking Claude session information per agent,
 * enabling session resume and fork capabilities.
 */

import { z } from "zod";

// =============================================================================
// Session Mode Schema
// =============================================================================

/**
 * The operational mode of the session
 */
export const SessionModeSchema = z.enum([
  "autonomous",
  "interactive",
  "review",
]);

// =============================================================================
// Session Info Schema
// =============================================================================

/**
 * Runtime type for session tracking
 */
export const RuntimeTypeSchema = z.enum(["sdk", "cli"]);

/**
 * Session info schema for individual agent session files
 *
 * Each session is stored as .herdctl/sessions/<agent-name>.json
 */
export const SessionInfoSchema = z.object({
  /** Name of the agent this session belongs to */
  agent_name: z.string().min(1, "Agent name cannot be empty"),

  /** Claude session ID for resuming conversations */
  session_id: z.string().min(1, "Session ID cannot be empty"),

  /** ISO timestamp when the session was created */
  created_at: z.string().datetime({ message: "created_at must be a valid ISO datetime string" }),

  /** ISO timestamp when the session was last used */
  last_used_at: z.string().datetime({ message: "last_used_at must be a valid ISO datetime string" }),

  /** Number of jobs executed in this session */
  job_count: z.number().int().nonnegative(),

  /** Current operational mode of the session */
  mode: SessionModeSchema,

  /**
   * Working directory (cwd) when the session was created
   * Used to detect working directory changes that would make the session invalid
   */
  working_directory: z.string().optional(),

  /**
   * Runtime type used when the session was created
   * Defaults to "sdk" for legacy sessions
   */
  runtime_type: RuntimeTypeSchema.optional().default("sdk"),

  /**
   * Whether Docker was enabled when the session was created
   * Defaults to false for legacy sessions
   */
  docker_enabled: z.boolean().optional().default(false),
});

// =============================================================================
// Type Exports
// =============================================================================

export type SessionMode = z.infer<typeof SessionModeSchema>;
export type RuntimeType = z.infer<typeof RuntimeTypeSchema>;
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Options for creating a new session
 */
export interface CreateSessionOptions {
  /** Name of the agent */
  agent_name: string;
  /** Claude session ID */
  session_id: string;
  /** Operational mode (defaults to 'autonomous') */
  mode?: SessionMode;
  /** Working directory (cwd) for the session */
  working_directory?: string;
  /** Runtime type (defaults to 'sdk') */
  runtime_type?: RuntimeType;
  /** Whether Docker is enabled (defaults to false) */
  docker_enabled?: boolean;
}

/**
 * Create initial session info for a new session
 *
 * @param options - Session creation options
 * @returns A validated SessionInfo object
 */
export function createSessionInfo(options: CreateSessionOptions): SessionInfo {
  const now = new Date().toISOString();

  return {
    agent_name: options.agent_name,
    session_id: options.session_id,
    created_at: now,
    last_used_at: now,
    job_count: 0,
    mode: options.mode ?? "autonomous",
    working_directory: options.working_directory,
    runtime_type: options.runtime_type ?? "sdk",
    docker_enabled: options.docker_enabled ?? false,
  };
}
