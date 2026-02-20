/**
 * Interval parsing utilities for the scheduler module
 *
 * Parses human-readable interval strings like "5m", "1h", "30s" into milliseconds.
 */

import { IntervalParseError } from "./errors.js";

/**
 * Multipliers to convert time units to milliseconds
 */
const UNIT_MULTIPLIERS: Record<string, number> = {
  s: 1000, // seconds
  m: 60 * 1000, // minutes
  h: 60 * 60 * 1000, // hours
  d: 24 * 60 * 60 * 1000, // days
};

/**
 * Valid time units
 */
const VALID_UNITS = Object.keys(UNIT_MULTIPLIERS);

/**
 * Parse an interval string into milliseconds
 *
 * Supports the format `{number}{unit}` where:
 * - `number` is a positive integer
 * - `unit` is one of: s (seconds), m (minutes), h (hours), d (days)
 *
 * @param interval - The interval string to parse (e.g., "5m", "1h", "30s", "1d")
 * @returns The interval in milliseconds
 * @throws {IntervalParseError} If the interval string is invalid
 *
 * @example
 * parseInterval("5s")  // returns 5000
 * parseInterval("5m")  // returns 300000
 * parseInterval("1h")  // returns 3600000
 * parseInterval("1d")  // returns 86400000
 */
export function parseInterval(interval: string): number {
  // Handle empty string
  if (!interval || interval.trim() === "") {
    throw new IntervalParseError(
      'Interval cannot be empty. Expected format: "{number}{unit}" where unit is s/m/h/d (e.g., "5m", "1h")',
      interval,
    );
  }

  const trimmed = interval.trim();

  // Match the pattern: optional whitespace, digits, optional whitespace, unit letter
  const match = trimmed.match(/^(-?\d+)\s*([a-zA-Z]+)$/);

  if (!match) {
    // Check for common error patterns to provide better error messages
    if (/^\d+$/.test(trimmed)) {
      throw new IntervalParseError(
        `Missing time unit in interval "${interval}". Expected format: "{number}{unit}" where unit is s/m/h/d (e.g., "5m", "1h")`,
        interval,
      );
    }

    if (/^[a-zA-Z]+$/.test(trimmed)) {
      throw new IntervalParseError(
        `Missing numeric value in interval "${interval}". Expected format: "{number}{unit}" where unit is s/m/h/d (e.g., "5m", "1h")`,
        interval,
      );
    }

    if (/\d+\.\d+/.test(trimmed)) {
      throw new IntervalParseError(
        `Decimal values are not supported in interval "${interval}". Use integers only (e.g., "5m" instead of "5.5m")`,
        interval,
      );
    }

    throw new IntervalParseError(
      `Invalid interval format "${interval}". Expected format: "{number}{unit}" where unit is s/m/h/d (e.g., "5m", "1h")`,
      interval,
    );
  }

  const [, valueStr, unit] = match;
  const value = parseInt(valueStr, 10);
  const normalizedUnit = unit.toLowerCase();

  // Check for negative numbers
  if (value < 0) {
    throw new IntervalParseError(
      `Negative intervals are not allowed: "${interval}". Use a positive integer value`,
      interval,
    );
  }

  // Check for zero
  if (value === 0) {
    throw new IntervalParseError(
      `Zero interval is not allowed: "${interval}". Use a positive integer value`,
      interval,
    );
  }

  // Check for valid unit
  if (!VALID_UNITS.includes(normalizedUnit)) {
    throw new IntervalParseError(
      `Invalid time unit "${unit}" in interval "${interval}". Valid units are: s (seconds), m (minutes), h (hours), d (days)`,
      interval,
    );
  }

  return value * UNIT_MULTIPLIERS[normalizedUnit];
}

/**
 * Calculate the next trigger time for a schedule
 *
 * @param lastCompletedAt - When the schedule last completed, or null for first run
 * @param interval - The interval string (e.g., "5m", "1h")
 * @param jitterPercent - Optional jitter percentage (0-10) to add randomness and prevent thundering herd
 * @returns The next trigger time as a Date
 *
 * @example
 * // First run - triggers immediately
 * calculateNextTrigger(null, "5m") // returns now
 *
 * // Subsequent run - triggers after interval
 * calculateNextTrigger(new Date("2024-01-01T00:00:00Z"), "5m")
 * // returns 2024-01-01T00:05:00Z (plus optional jitter)
 *
 * // With jitter to prevent thundering herd
 * calculateNextTrigger(lastRun, "1h", 5) // adds 0-5% jitter to interval
 */
export function calculateNextTrigger(
  lastCompletedAt: Date | null,
  interval: string,
  jitterPercent?: number,
): Date {
  const now = new Date();

  // If no previous run, trigger immediately
  if (lastCompletedAt === null) {
    return now;
  }

  const intervalMs = parseInterval(interval);

  // Calculate jitter if specified
  let jitterMs = 0;
  if (jitterPercent !== undefined && jitterPercent > 0) {
    // Clamp jitter to 0-10%
    const clampedJitter = Math.min(Math.max(jitterPercent, 0), 10);
    // Random jitter between 0 and clampedJitter% of interval
    jitterMs = Math.floor((Math.random() * (intervalMs * clampedJitter)) / 100);
  }

  const nextTrigger = new Date(lastCompletedAt.getTime() + intervalMs + jitterMs);

  // Handle clock skew: if next trigger is in the past, trigger now
  if (nextTrigger.getTime() < now.getTime()) {
    return now;
  }

  return nextTrigger;
}

/**
 * Check if a schedule is due to run
 *
 * @param nextRunAt - The scheduled next run time
 * @param now - Optional current time (defaults to new Date())
 * @returns true if the schedule is due (nextRunAt <= now)
 *
 * @example
 * const nextRun = new Date("2024-01-01T00:05:00Z");
 *
 * // Before scheduled time
 * isScheduleDue(nextRun, new Date("2024-01-01T00:04:00Z")) // false
 *
 * // At scheduled time
 * isScheduleDue(nextRun, new Date("2024-01-01T00:05:00Z")) // true
 *
 * // After scheduled time
 * isScheduleDue(nextRun, new Date("2024-01-01T00:06:00Z")) // true
 */
export function isScheduleDue(nextRunAt: Date, now?: Date): boolean {
  const currentTime = now ?? new Date();
  return nextRunAt.getTime() <= currentTime.getTime();
}
