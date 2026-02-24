/**
 * Installation metadata schema for agent distribution
 *
 * Validates the `metadata.json` file that lives in each installed agent's
 * directory root. This file tracks where an agent was installed from and when.
 *
 * The schema is intentionally extensible (no .strict()) to support future
 * features like agentic initialization without breaking existing installs.
 */

import { z } from "zod";

// =============================================================================
// Source Type Schema
// =============================================================================

/**
 * Source types for installed agents
 *
 * - `github`: Installed from a GitHub repository
 * - `local`: Installed from a local filesystem path
 */
export const SourceTypeSchema = z.enum(["github", "local"]);

/** Union type of valid source types */
export type SourceType = z.infer<typeof SourceTypeSchema>;

// =============================================================================
// Source Schema
// =============================================================================

/**
 * Source information schema
 *
 * Tracks the origin of an installed agent. The `type` field is required,
 * while other fields are optional and depend on the source type:
 *
 * - `url`: The original source URL or path (GitHub URL, local path)
 * - `ref`: Git reference (tag, branch, commit SHA) for GitHub sources
 * - `version`: Version from herdctl.json at install time
 */
export const InstallationSourceSchema = z
  .object({
    /** The type of source (github or local) */
    type: SourceTypeSchema,

    /** The original source URL or path */
    url: z.string().optional(),

    /** Git reference (tag, branch, commit) for version-controlled sources */
    ref: z.string().optional(),

    /** Version from herdctl.json at install time */
    version: z.string().optional(),
  })
  .passthrough();

/** Type for installation source information */
export type InstallationSource = z.infer<typeof InstallationSourceSchema>;

// =============================================================================
// ISO 8601 Timestamp Schema
// =============================================================================

/**
 * ISO 8601 timestamp pattern
 *
 * Matches formats like:
 * - 2024-01-15T10:30:00Z
 * - 2024-01-15T10:30:00.123Z
 * - 2024-01-15T10:30:00+00:00
 * - 2024-01-15T10:30:00-05:00
 */
const ISO8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Schema for ISO 8601 formatted timestamps
 */
export const ISO8601TimestampSchema = z.string().regex(ISO8601_PATTERN, {
  message:
    "Timestamp must be in ISO 8601 format (e.g., 2024-01-15T10:30:00Z or 2024-01-15T10:30:00+00:00)",
});

// =============================================================================
// Installation Metadata Schema
// =============================================================================

/**
 * Installation metadata schema
 *
 * This schema validates the `metadata.json` file that tracks installation
 * information for each agent. It is intentionally extensible (uses default
 * Zod behavior, not .strict()) to allow adding future fields like
 * `initialization` without breaking existing installs.
 *
 * @example
 * ```json
 * {
 *   "source": {
 *     "type": "github",
 *     "url": "https://github.com/user/agent-repo",
 *     "ref": "v1.0.0",
 *     "version": "1.0.0"
 *   },
 *   "installed_at": "2024-01-15T10:30:00Z",
 *   "installed_by": "herdctl@0.5.0"
 * }
 * ```
 */
export const InstallationMetadataSchema = z
  .object({
    /** Source information - where the agent was installed from */
    source: InstallationSourceSchema,

    /** ISO 8601 timestamp of when the agent was installed */
    installed_at: ISO8601TimestampSchema,

    /** herdctl version that performed the installation (e.g., "herdctl@0.5.0") */
    installed_by: z.string().optional(),
  })
  .passthrough();

/** Type for installation metadata */
export type InstallationMetadata = z.infer<typeof InstallationMetadataSchema>;
