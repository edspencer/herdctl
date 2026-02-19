/**
 * Configurable logger for Discord connector operations
 *
 * Implements log level filtering based on configuration:
 * - minimal: Only errors and critical state changes
 * - standard: Connection events, message counts, session operations (default)
 * - verbose: All messages logged with optional content redaction
 */

import type { AgentChatDiscord } from "@herdctl/core";
import type { DiscordConnectorLogger } from "./types.js";

/**
 * Log level hierarchy for filtering
 * Higher number = more severe = always logged
 */
export type DiscordLogLevel = "minimal" | "standard" | "verbose";

/**
 * Maps log level names to numeric values for comparison
 */
const LOG_LEVEL_VALUES: Record<DiscordLogLevel, number> = {
  verbose: 0, // Most permissive - logs everything
  standard: 1, // Default - logs info and above
  minimal: 2, // Most restrictive - logs errors only
};

/**
 * Maps method names to their required log levels
 */
const METHOD_LEVELS: Record<keyof DiscordConnectorLogger, number> = {
  debug: 0, // Only in verbose
  info: 1, // Standard and above
  warn: 2, // Always logged
  error: 2, // Always logged
};

/**
 * Options for configuring the Discord logger
 */
export interface DiscordLoggerOptions {
  /**
   * Name of the agent this logger is for
   */
  agentName: string;

  /**
   * Log level setting from config
   * @default "standard"
   */
  logLevel?: DiscordLogLevel;

  /**
   * Whether to redact message content in verbose mode
   * @default true
   */
  redactContent?: boolean;

  /**
   * Custom prefix for log messages
   * @default "[discord:agentName]"
   */
  prefix?: string;
}

/**
 * Keys that should be redacted in data objects when redactContent is true
 */
const REDACTABLE_KEYS = [
  "content",
  "message",
  "prompt",
  "text",
  "body",
  "token",
  "secret",
  "password",
];

/**
 * Redact sensitive content from a data object
 */
function redactData(
  data: Record<string, unknown>,
  keysToRedact: string[] = REDACTABLE_KEYS,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (keysToRedact.includes(key.toLowerCase())) {
      if (typeof value === "string") {
        result[key] = `[REDACTED ${value.length} chars]`;
      } else if (Array.isArray(value)) {
        result[key] = `[REDACTED ${value.length} items]`;
      } else {
        result[key] = "[REDACTED]";
      }
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = redactData(value as Record<string, unknown>, keysToRedact);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Configurable logger for Discord connector operations
 *
 * Implements log level filtering based on configuration:
 * - minimal: Only errors and critical state changes (warn/error)
 * - standard: Connection events, message counts, session operations (info/warn/error)
 * - verbose: All messages logged with optional content redaction (debug/info/warn/error)
 *
 * @example
 * ```typescript
 * const logger = new DiscordLogger({
 *   agentName: 'my-agent',
 *   logLevel: 'standard',
 *   redactContent: true,
 * });
 *
 * logger.info('Connected to Discord', { username: 'Bot#1234' });
 * logger.debug('Debug message', { sensitive: 'data' }); // Filtered out in standard mode
 * ```
 */
export class DiscordLogger implements DiscordConnectorLogger {
  private readonly agentName: string;
  private readonly logLevel: DiscordLogLevel;
  private readonly redactContent: boolean;
  private readonly prefix: string;
  private readonly levelValue: number;

  constructor(options: DiscordLoggerOptions) {
    this.agentName = options.agentName;
    this.logLevel = options.logLevel ?? "standard";
    this.redactContent = options.redactContent ?? true;
    this.prefix = options.prefix ?? `[discord:${options.agentName}]`;
    this.levelValue = LOG_LEVEL_VALUES[this.logLevel];
  }

  /**
   * Check if a log method should output based on current log level
   */
  private shouldLog(methodLevel: number): boolean {
    return methodLevel >= this.levelValue;
  }

  /**
   * Process data for logging, applying redaction if needed
   */
  private processData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!data) return undefined;
    if (this.redactContent && this.logLevel === "verbose") {
      return redactData(data);
    }
    return data;
  }

  /**
   * Format and output a log message
   */
  private log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const methodLevel = METHOD_LEVELS[level];
    if (!this.shouldLog(methodLevel)) {
      return;
    }

    const processedData = this.processData(data);
    const logFn = console[level];

    if (processedData) {
      logFn(this.prefix, message, processedData);
    } else {
      logFn(this.prefix, message);
    }
  }

  /**
   * Log a debug message (only visible in verbose mode)
   */
  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  /**
   * Log an info message (visible in standard and verbose modes)
   */
  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  /**
   * Log a warning message (always visible)
   */
  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  /**
   * Log an error message (always visible)
   */
  error(message: string, data?: Record<string, unknown>): void {
    this.log("error", message, data);
  }

  /**
   * Get the current log level
   */
  getLogLevel(): DiscordLogLevel {
    return this.logLevel;
  }

  /**
   * Check if redaction is enabled
   */
  isRedactionEnabled(): boolean {
    return this.redactContent;
  }
}

/**
 * Create a DiscordLogger from agent Discord configuration
 *
 * @param agentName - Name of the agent
 * @param discordConfig - Discord configuration from agent config
 * @returns Configured DiscordLogger instance
 */
export function createLoggerFromConfig(
  agentName: string,
  discordConfig: AgentChatDiscord,
): DiscordLogger {
  return new DiscordLogger({
    agentName,
    logLevel: discordConfig.log_level,
    redactContent: true,
  });
}

/**
 * Create a default logger for an agent (standard log level)
 *
 * @param agentName - Name of the agent
 * @returns DiscordLogger with default settings
 */
export function createDefaultDiscordLogger(agentName: string): DiscordLogger {
  return new DiscordLogger({
    agentName,
    logLevel: "standard",
    redactContent: true,
  });
}
