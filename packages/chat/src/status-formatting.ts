/**
 * Status formatting utilities for chat commands
 *
 * Provides common formatting functions used by status commands
 * across all chat platforms. These are identical between Discord
 * and Slack status commands.
 */

// =============================================================================
// Timestamp Formatting
// =============================================================================

/**
 * Format an ISO timestamp for display
 *
 * Converts an ISO 8601 timestamp to a locale-appropriate string.
 * Returns "N/A" if the timestamp is null or undefined.
 *
 * @param isoString - ISO 8601 timestamp string
 * @returns Formatted date/time string
 *
 * @example
 * ```typescript
 * formatTimestamp('2024-01-15T10:30:00Z');
 * // Returns: "1/15/2024, 10:30:00 AM" (locale-dependent)
 *
 * formatTimestamp(null);
 * // Returns: "N/A"
 * ```
 */
export function formatTimestamp(isoString: string | null): string {
  if (!isoString) {
    return "N/A";
  }
  const date = new Date(isoString);
  return date.toLocaleString();
}

// =============================================================================
// Duration Formatting
// =============================================================================

/**
 * Format the duration since a timestamp
 *
 * Calculates and formats the time elapsed since the given timestamp.
 * Returns a human-readable string like "2h 30m" or "5d 12h".
 *
 * @param isoString - ISO 8601 timestamp string (start time)
 * @returns Formatted duration string
 *
 * @example
 * ```typescript
 * // If current time is 2 hours after the timestamp:
 * formatDuration('2024-01-15T10:30:00Z');
 * // Returns: "2h 0m"
 *
 * formatDuration(null);
 * // Returns: "N/A"
 * ```
 */
export function formatDuration(isoString: string | null): string {
  if (!isoString) {
    return "N/A";
  }
  const startTime = new Date(isoString).getTime();
  const now = Date.now();
  const durationMs = now - startTime;

  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Format a duration in milliseconds to a human-readable string
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 *
 * @example
 * ```typescript
 * formatDurationMs(500);
 * // Returns: "500ms"
 *
 * formatDurationMs(65000);
 * // Returns: "1m 5s"
 * ```
 */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

// =============================================================================
// Status Emoji
// =============================================================================

/**
 * Status emoji mapping
 *
 * Maps connection status to appropriate emoji for display.
 * Uses Unicode code points to avoid rendering issues.
 */
const STATUS_EMOJIS: Record<string, string> = {
  connected: "\u{1F7E2}", // Green circle
  connecting: "\u{1F7E1}", // Yellow circle
  reconnecting: "\u{1F7E1}", // Yellow circle
  disconnected: "\u26AA", // White circle
  disconnecting: "\u26AA", // White circle
  error: "\u{1F534}", // Red circle
};

const DEFAULT_STATUS_EMOJI = "\u2753"; // Question mark

/**
 * Get the appropriate emoji for a connection status
 *
 * Returns a circle emoji colored based on the connection state:
 * - Green: connected
 * - Yellow: connecting/reconnecting
 * - White: disconnected/disconnecting
 * - Red: error
 * - Question mark: unknown status
 *
 * @param status - Connection status string
 * @returns Appropriate emoji for the status
 *
 * @example
 * ```typescript
 * getStatusEmoji('connected');
 * // Returns: green circle emoji
 *
 * getStatusEmoji('error');
 * // Returns: red circle emoji
 * ```
 */
export function getStatusEmoji(status: string): string {
  return STATUS_EMOJIS[status] ?? DEFAULT_STATUS_EMOJI;
}

// =============================================================================
// Number Formatting
// =============================================================================

/**
 * Format a number with thousand separators
 *
 * @param num - Number to format
 * @returns Formatted string with locale-appropriate separators
 *
 * @example
 * ```typescript
 * formatNumber(1234567);
 * // Returns: "1,234,567" (US locale)
 * ```
 */
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Format a large number in abbreviated form
 *
 * @param num - Number to format
 * @returns Abbreviated string (e.g., "1.2k", "3.5M")
 *
 * @example
 * ```typescript
 * formatCompactNumber(1500);
 * // Returns: "1.5k"
 *
 * formatCompactNumber(2500000);
 * // Returns: "2.5M"
 * ```
 */
export function formatCompactNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}k`;
  }
  return String(num);
}

/**
 * Format a character count for display
 *
 * Shows "X chars" for small counts, "X.Xk chars" for larger counts.
 *
 * @param count - Number of characters
 * @returns Formatted character count string
 *
 * @example
 * ```typescript
 * formatCharCount(500);
 * // Returns: "500 chars"
 *
 * formatCharCount(15000);
 * // Returns: "15.0k chars"
 * ```
 */
export function formatCharCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k chars`;
  }
  return `${count} chars`;
}

// =============================================================================
// Cost Formatting
// =============================================================================

/**
 * Format a USD cost amount
 *
 * @param usd - Cost in USD
 * @param precision - Decimal precision (default: 4)
 * @returns Formatted cost string with $ prefix
 *
 * @example
 * ```typescript
 * formatCost(0.0123);
 * // Returns: "$0.0123"
 * ```
 */
export function formatCost(usd: number, precision: number = 4): string {
  return `$${usd.toFixed(precision)}`;
}
