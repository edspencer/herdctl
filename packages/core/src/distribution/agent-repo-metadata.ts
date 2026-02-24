/**
 * Agent Repository Metadata Schema (`herdctl.json`)
 *
 * Validates the metadata file that agent authors include in their repositories
 * to describe their agent for registry listing and installation validation.
 *
 * This file is found at the root of an agent repository and provides:
 * - Basic info: name, version, description, author
 * - Source info: repository, homepage, license
 * - Discovery: keywords, category, tags
 * - Requirements: herdctl version, runtime, env vars, workspace, docker
 * - Presentation: screenshots, examples
 */

import { z } from "zod";

import { AGENT_NAME_PATTERN } from "../config/schema.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * Semver pattern for version validation.
 * Matches versions like "1.0.0", "2.3.4-beta.1", "1.0.0+build.123"
 */
const SEMVER_PATTERN =
  /^\d+\.\d+\.\d+(?:-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/;

/**
 * Semver range pattern for version constraints.
 * Matches ranges like ">=1.0.0", "^2.0.0", "~1.2.3", "1.x", "*", ">=1.0.0 <2.0.0"
 *
 * This is a permissive pattern that accepts common semver range formats.
 * Full semver range validation is complex; this pattern catches obvious errors
 * while allowing valid npm-style version ranges.
 */
const SEMVER_RANGE_PATTERN =
  /^(?:[~^<>=]*\d+(?:\.\d+(?:\.\d+)?)?(?:-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?(?:\s+[<>=]+\d+(?:\.\d+(?:\.\d+)?)?(?:-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?)*|\d+(?:\.\d+)?\.x(?:\.x)?|\*)$/;

// =============================================================================
// Requirements Schema
// =============================================================================

/**
 * Requirements schema for agent dependencies and constraints.
 *
 * Specifies what the agent needs to run properly:
 * - herdctl version compatibility
 * - Runtime backend (cli, sdk)
 * - Required environment variables
 * - Workspace requirement
 * - Docker requirement
 */
export const AgentRequiresSchema = z
  .object({
    /** Minimum herdctl version required (semver range, e.g., ">=0.1.0") */
    herdctl: z
      .string()
      .regex(SEMVER_RANGE_PATTERN, {
        message: "herdctl version must be a valid semver range (e.g., '>=0.1.0', '^1.0.0')",
      })
      .optional(),

    /** Runtime backend required (e.g., "cli" for Claude CLI) */
    runtime: z.string().optional(),

    /** Required environment variable names (user must set these) */
    env: z.array(z.string()).optional(),

    /** Whether the agent requires a workspace directory */
    workspace: z.boolean().optional(),

    /** Whether the agent requires Docker */
    docker: z.boolean().optional(),
  })
  .strict();

export type AgentRequires = z.infer<typeof AgentRequiresSchema>;

// =============================================================================
// Agent Repository Metadata Schema
// =============================================================================

/**
 * Schema for `herdctl.json` metadata files in agent repositories.
 *
 * This metadata is used for:
 * - Registry listing and search
 * - Installation validation
 * - Displaying agent information
 *
 * @example
 * ```json
 * {
 *   "$schema": "https://herdctl.dev/schemas/agent-metadata.json",
 *   "name": "website-monitor",
 *   "version": "1.0.0",
 *   "description": "Monitor website uptime and send Discord alerts",
 *   "author": "herdctl-examples",
 *   "repository": "github:herdctl-examples/website-monitor-agent",
 *   "license": "MIT",
 *   "keywords": ["monitoring", "uptime", "alerts"],
 *   "requires": {
 *     "herdctl": ">=0.1.0",
 *     "runtime": "cli",
 *     "env": ["WEBSITES", "DISCORD_WEBHOOK_URL"],
 *     "workspace": true
 *   },
 *   "category": "operations",
 *   "tags": ["monitoring", "automation"]
 * }
 * ```
 */
export const AgentRepoMetadataSchema = z
  .object({
    /** JSON schema URL for IDE validation (optional) */
    $schema: z.string().optional(),

    /**
     * Agent name - must match AGENT_NAME_PATTERN.
     * This should match the `name` field in the agent's `agent.yaml`.
     */
    name: z.string().regex(AGENT_NAME_PATTERN, {
      message:
        "Agent name must start with a letter or number and contain only letters, numbers, underscores, and hyphens",
    }),

    /** Agent version (semver format, e.g., "1.0.0") */
    version: z.string().regex(SEMVER_PATTERN, {
      message: "Version must be a valid semver string (e.g., '1.0.0', '2.3.4-beta.1')",
    }),

    /** Human-readable description of what the agent does */
    description: z.string().min(1, { message: "Description cannot be empty" }),

    /** Author name or organization */
    author: z.string().min(1, { message: "Author cannot be empty" }),

    /** Source repository specifier (e.g., "github:user/repo") */
    repository: z.string().optional(),

    /** Homepage URL */
    homepage: z.string().url({ message: "Homepage must be a valid URL" }).optional(),

    /** SPDX license identifier (e.g., "MIT", "Apache-2.0") */
    license: z.string().optional(),

    /** Keywords for search and discovery */
    keywords: z.array(z.string()).optional(),

    /** Requirements and dependencies */
    requires: AgentRequiresSchema.optional(),

    /** Agent category for browsing (e.g., "operations", "development", "data") */
    category: z.string().optional(),

    /** Tags for filtering (similar to keywords but for categorization) */
    tags: z.array(z.string()).optional(),

    /** URLs to screenshot images for showcase */
    screenshots: z
      .array(z.string().url({ message: "Screenshot URLs must be valid URLs" }))
      .optional(),

    /** Example use cases as name-description pairs */
    examples: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export type AgentRepoMetadata = z.infer<typeof AgentRepoMetadataSchema>;

// =============================================================================
// Re-export AGENT_NAME_PATTERN for convenience
// =============================================================================

export { AGENT_NAME_PATTERN };
