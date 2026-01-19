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
// export * from './state';

// Runner exports (PRD 3)
// export * from './runner';

// Work source exports (PRD 4)
// export * from './sources';

// Scheduler exports (PRD 5)
// export * from './scheduler';
