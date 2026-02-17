/**
 * Logger utilities for the Slack connector
 *
 * Provides configurable logging with level-based filtering.
 */

import { createLogger } from "@herdctl/core";
import type { SlackConnectorLogger } from "./types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Log level for Slack connector operations
 */
export type SlackLogLevel = "minimal" | "standard" | "verbose";

/**
 * Options for creating a Slack logger
 */
export interface SlackLoggerOptions {
  /** Prefix for log messages */
  prefix: string;

  /** Log level */
  logLevel?: SlackLogLevel;
}

// =============================================================================
// Logger Factory
// =============================================================================

/**
 * Create a logger with the specified configuration
 */
export function createSlackLogger(
  options: SlackLoggerOptions
): SlackConnectorLogger {
  const { prefix, logLevel = "standard" } = options;

  return {
    debug: (msg: string, data?: Record<string, unknown>) => {
      if (logLevel === "verbose") {
        console.debug(`${prefix} ${msg}`, data ? JSON.stringify(data) : "");
      }
    },
    info: (msg: string, data?: Record<string, unknown>) => {
      if (logLevel !== "minimal") {
        console.info(`${prefix} ${msg}`, data ? JSON.stringify(data) : "");
      }
    },
    warn: (msg: string, data?: Record<string, unknown>) => {
      console.warn(`${prefix} ${msg}`, data ? JSON.stringify(data) : "");
    },
    error: (msg: string, data?: Record<string, unknown>) => {
      console.error(`${prefix} ${msg}`, data ? JSON.stringify(data) : "");
    },
  };
}

/**
 * Create a default logger for Slack operations
 */
export function createDefaultSlackLogger(
  agentName?: string
): SlackConnectorLogger {
  const prefix = agentName ? `slack:${agentName}` : "slack";
  return createLogger(prefix);
}
