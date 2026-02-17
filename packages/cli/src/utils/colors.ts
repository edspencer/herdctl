/**
 * Shared color utilities for CLI output
 *
 * Supports:
 * - NO_COLOR environment variable (https://no-color.org/)
 * - FORCE_COLOR environment variable for override
 * - TTY detection
 */

import type { LogLevel } from "@herdctl/core";

/**
 * Check if colors should be used based on environment and TTY
 */
export function shouldUseColor(): boolean {
  // NO_COLOR takes precedence (https://no-color.org/)
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") {
    return false;
  }
  // Also check FORCE_COLOR for override
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") {
    return true;
  }
  // Check if stdout is a TTY
  return process.stdout.isTTY === true;
}

/**
 * ANSI color codes
 */
export const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
} as const;

/**
 * Color name type
 */
export type ColorName = keyof typeof colors;

/**
 * Get a colored string, respecting NO_COLOR
 */
export function colorize(text: string, color: ColorName): string {
  if (!shouldUseColor()) {
    return text;
  }
  return `${colors[color]}${text}${colors.reset}`;
}

/**
 * Get color for log level
 */
export function getLevelColor(level: LogLevel): ColorName {
  switch (level) {
    case "error":
      return "red";
    case "warn":
      return "yellow";
    case "info":
      return "green";
    case "debug":
      return "gray";
    default:
      return "reset";
  }
}

/**
 * Get color for log source (output type)
 */
export function getSourceColor(source: string, data?: Record<string, unknown>): ColorName {
  // Check if there's an outputType in the data (from job output)
  const outputType = data?.outputType as string | undefined;
  if (outputType) {
    switch (outputType) {
      case "assistant":
        return "cyan";
      case "tool":
        return "magenta";
      case "result":
        return "blue";
      case "error":
        return "red";
      case "system":
        return "gray";
      default:
        return "reset";
    }
  }

  // Fallback to source-based coloring
  switch (source) {
    case "agent":
      return "cyan";
    case "job":
      return "blue";
    case "scheduler":
      return "magenta";
    case "fleet":
      return "green";
    default:
      return "reset";
  }
}
