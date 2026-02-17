/**
 * Centralized logger utility for herdctl
 *
 * Provides environment-aware logging that respects HERDCTL_LOG_LEVEL
 * and DEBUG environment variables.
 */

import type { LogLevel } from "../fleet-manager/types.js";

// Re-export LogLevel for convenience
export type { LogLevel };

/**
 * Numeric order for log level comparison
 * Lower numbers = more verbose
 */
export const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Get the current log level from environment
 *
 * Priority:
 * 1. HERDCTL_LOG_LEVEL environment variable (debug/info/warn/error)
 * 2. DEBUG=1 or DEBUG=true enables debug level
 * 3. Default: 'info'
 */
export function getLogLevel(): LogLevel {
  const envLevel = process.env.HERDCTL_LOG_LEVEL?.toLowerCase();
  if (envLevel && envLevel in LOG_LEVEL_ORDER) {
    return envLevel as LogLevel;
  }
  // Also support DEBUG=1 or DEBUG=true for debug level
  if (process.env.DEBUG === "1" || process.env.DEBUG === "true") {
    return "debug";
  }
  return "info"; // Default
}

/**
 * Check if a log level should be displayed based on current settings
 *
 * @param level - The level to check
 * @returns true if the level should be logged
 */
export function shouldLog(level: LogLevel): boolean {
  const currentLevel = getLogLevel();
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[currentLevel];
}

/**
 * Create a logger with a specific prefix
 *
 * Returns a logger object that respects the HERDCTL_LOG_LEVEL
 * environment variable. Each method accepts an optional data
 * parameter that is JSON-serialized into the log output.
 *
 * @param prefix - The prefix to use for log messages (e.g., 'CLIRuntime')
 * @returns A logger object with debug/info/warn/error methods
 *
 * @example
 * ```typescript
 * const logger = createLogger('CLIRuntime');
 * logger.debug('Starting process...'); // Only shown if HERDCTL_LOG_LEVEL=debug
 * logger.info('Process started');      // Shown at info level and below
 * logger.info('Connected', { host: 'localhost' }); // With structured data
 * logger.error('Process failed');      // Always shown
 * ```
 */
export function createLogger(prefix: string) {
  const fmt = (message: string, data?: Record<string, unknown>) =>
    data
      ? `[${prefix}] ${message} ${JSON.stringify(data)}`
      : `[${prefix}] ${message}`;

  return {
    debug: (message: string, data?: Record<string, unknown>) => {
      if (shouldLog("debug")) {
        console.debug(fmt(message, data));
      }
    },
    info: (message: string, data?: Record<string, unknown>) => {
      if (shouldLog("info")) {
        console.info(fmt(message, data));
      }
    },
    warn: (message: string, data?: Record<string, unknown>) => {
      if (shouldLog("warn")) {
        console.warn(fmt(message, data));
      }
    },
    error: (message: string, data?: Record<string, unknown>) => {
      if (shouldLog("error")) {
        console.error(fmt(message, data));
      }
    },
  };
}
