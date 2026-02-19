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
 * Brand colors for connector platforms (true-color ANSI)
 *
 * These use 24-bit RGB escape sequences for accurate brand colors.
 * Terminals that don't support true color will typically fall back
 * to the nearest 256-color or 16-color equivalent automatically.
 */
const brandColors = {
  discord: "\x1b[38;2;88;101;242m",  // Discord Blurple #5865F2
  slack: "\x1b[38;2;54;197;240m",    // Slack Blue #36C5F0
  web: "\x1b[38;2;74;222;128m",      // Web Green #4ADE80
} as const;

/**
 * Get a brand color escape sequence for a connector log message.
 *
 * Checks two sources for connector identification:
 * 1. The logger prefix (e.g. "web", "web:chat") — used by createLogger instances
 * 2. The message content (e.g. "[discord:homelab] Connected...") — used by
 *    createAgentLogger adapters which prepend the connector tag to the message
 *
 * Returns the ANSI escape to open the color (caller must append reset).
 * Returns empty string if no brand color applies or colors are disabled.
 */
export function getMessageColor(message: string, prefix?: string): string {
  if (!shouldUseColor()) return "";
  // Check logger prefix (e.g. "web", "web:chat", "discord:homelab")
  if (prefix) {
    if (prefix === "web" || prefix.startsWith("web:")) return brandColors.web;
    if (prefix.startsWith("discord:")) return brandColors.discord;
    if (prefix.startsWith("slack:")) return brandColors.slack;
  }
  // Check message content (from createAgentLogger adapters)
  if (message.startsWith("[discord:")) return brandColors.discord;
  if (message.startsWith("[slack:")) return brandColors.slack;
  if (message.startsWith("[web:")) return brandColors.web;
  return "";
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
    case "job-queue":
    case "job-executor":
      return "blue";
    case "scheduler":
    case "schedule-runner":
    case "schedule-state":
      return "magenta";
    case "fleet":
    case "fleet-manager":
    case "fleet-state":
    case "config":
      return "green";
    case "CLIRuntime":
    case "CLISessionWatcher":
    case "container-manager":
    case "container-runner":
      return "cyan";
    default:
      // Prefix-based matching for connector loggers (e.g. "slack:session-manager", "discord:homelab")
      if (source.startsWith("slack:") || source.startsWith("discord:")) {
        return "cyan";
      }
      return "reset";
  }
}
