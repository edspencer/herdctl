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
});

// =============================================================================
// Type Exports
// =============================================================================

export type SessionMode = z.infer<typeof SessionModeSchema>;
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
  };
}
