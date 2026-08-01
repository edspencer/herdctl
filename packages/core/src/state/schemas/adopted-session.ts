/**
 * Zod schema for adopted session records (adopted-sessions/<session-id>.yaml)
 *
 * An *adopted* session is a pre-existing Claude Code transcript (typically one a
 * user ran themselves in a terminal) that has been claimed by a herdctl agent so
 * it becomes discoverable, attributed and resumable like any other session.
 *
 * Adoption is deliberately **not** expressed as a job record: a job means "a run
 * happened", and forging one to buy attribution is fragile. This dedicated store
 * is read as a genuine third source by the attribution index, yielding
 * `origin: "adopted"`.
 */

import { z } from "zod";

// =============================================================================
// Constants
// =============================================================================

/**
 * Current on-disk version for adopted session records.
 *
 * Bump this (and widen {@link AdoptedSessionVersionSchema} to a union, the way
 * platform session files do) whenever the record shape changes incompatibly.
 */
export const ADOPTED_SESSION_VERSION = 1;

// =============================================================================
// Schema
// =============================================================================

/**
 * Accepted record versions.
 *
 * Kept as its own schema so future versions are added here as
 * `z.union([z.literal(1), z.literal(2)])` rather than being inlined.
 */
export const AdoptedSessionVersionSchema = z.literal(ADOPTED_SESSION_VERSION);

/**
 * An adoption record, stored as `<stateDir>/adopted-sessions/<session-id>.yaml`
 */
export const AdoptedSessionSchema = z.object({
  /** Record format version — present so the shape can evolve */
  version: AdoptedSessionVersionSchema.default(ADOPTED_SESSION_VERSION),

  /**
   * The Claude Code session ID that was adopted.
   *
   * Duplicated from the file name so a record is self-describing (the same way
   * a job record carries its own `id`).
   */
  sessionId: z.string().min(1, "Session ID cannot be empty"),

  /** Qualified name of the agent that adopted the session */
  agentName: z.string().min(1, "Agent name cannot be empty"),

  /** ISO timestamp of when the adoption was recorded */
  adoptedAt: z.string().datetime({ message: "adoptedAt must be a valid ISO datetime string" }),

  /**
   * The working directory the transcript was originally recorded under, when
   * known. Useful for provenance and for locating the source transcript; resume
   * itself tolerates a recorded-cwd that differs from the process cwd.
   */
  sourceCwd: z.string().optional(),
});

// =============================================================================
// Type Exports
// =============================================================================

export type AdoptedSession = z.infer<typeof AdoptedSessionSchema>;
