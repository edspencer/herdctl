/**
 * @herdctl/core
 *
 * Core library for herdctl - Autonomous Agent Fleet Management for Claude Code
 *
 * This package provides:
 * - Config parsing (herdctl.yaml and agent YAML files)
 * - State management (.herdctl/ directory)
 * - Agent runner (Claude SDK wrapper)
 * - Work sources (GitHub Issues, etc.)
 * - Scheduler (interval, cron)
 */

export const VERSION = "0.0.1";

// Config exports (PRD 1)
export * from "./config/index.js";

// State exports (PRD 2)
export * from "./state/index.js";

// Runner exports (PRD 4)
export * from "./runner/index.js";

// Work source exports (PRD 5)
export * from "./work-sources/index.js";

// Scheduler exports (PRD 6)
export * from "./scheduler/index.js";

// Fleet Manager exports (PRD 7)
export * from "./fleet-manager/index.js";
