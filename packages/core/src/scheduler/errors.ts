/**
 * Error classes for scheduler module
 *
 * Provides typed errors with descriptive messages for scheduler operations.
 */

import { FleetManagerError, FleetManagerErrorCode } from "../fleet-manager/errors.js";

// =============================================================================
// Error Codes
// =============================================================================

/**
 * Error codes for scheduler errors (extends FleetManagerErrorCode)
 */
export const SchedulerErrorCode = {
  ...FleetManagerErrorCode,
  // Scheduler-specific error codes
  CRON_PARSE_ERROR: "CRON_PARSE_ERROR",
  INTERVAL_PARSE_ERROR: "INTERVAL_PARSE_ERROR",
  SCHEDULE_TRIGGER_ERROR: "SCHEDULE_TRIGGER_ERROR",
  SCHEDULER_SHUTDOWN_ERROR: "SCHEDULER_SHUTDOWN_ERROR",
} as const;

export type SchedulerErrorCode = (typeof SchedulerErrorCode)[keyof typeof SchedulerErrorCode];

// =============================================================================
// Base Error Class
// =============================================================================

/**
 * Base error class for all scheduler errors
 *
 * Extends FleetManagerError to integrate with the broader error hierarchy.
 */
export class SchedulerError extends FleetManagerError {
  constructor(message: string, options?: { cause?: Error; code?: SchedulerErrorCode }) {
    super(message, {
      cause: options?.cause,
      // Use type assertion since SchedulerErrorCode is a superset of FleetManagerErrorCode
      code: (options?.code ?? FleetManagerErrorCode.FLEET_MANAGER_ERROR) as FleetManagerErrorCode,
    });
    this.name = "SchedulerError";
  }
}

// =============================================================================
// Interval Parse Errors
// =============================================================================

/**
 * Error thrown when an interval string cannot be parsed
 *
 * This error provides detailed information about what went wrong during parsing,
 * including the invalid input and suggestions for valid formats.
 */
export class IntervalParseError extends SchedulerError {
  /** The original input string that failed to parse */
  public readonly input: string;

  constructor(message: string, input: string, options?: { cause?: Error }) {
    super(message, { cause: options?.cause, code: SchedulerErrorCode.INTERVAL_PARSE_ERROR });
    this.name = "IntervalParseError";
    this.input = input;
  }
}

// =============================================================================
// Cron Parse Errors
// =============================================================================

/**
 * Cron field definitions for validation and error messages
 */
export interface CronFieldInfo {
  name: string;
  index: number;
  min: number;
  max: number;
  example: string;
}

/**
 * Cron field definitions
 */
export const CRON_FIELDS: CronFieldInfo[] = [
  { name: "minute", index: 0, min: 0, max: 59, example: "0" },
  { name: "hour", index: 1, min: 0, max: 23, example: "9" },
  { name: "day-of-month", index: 2, min: 1, max: 31, example: "1" },
  { name: "month", index: 3, min: 1, max: 12, example: "*" },
  { name: "day-of-week", index: 4, min: 0, max: 7, example: "*" },
];

/**
 * Error thrown when a cron expression cannot be parsed
 *
 * This error provides detailed information about what went wrong during parsing,
 * including the invalid expression, which field is invalid, and examples of valid
 * expressions.
 *
 * @example
 * ```typescript
 * try {
 *   parseCronExpression("0 25 * * *");
 * } catch (error) {
 *   if (error instanceof CronParseError) {
 *     console.error(error.message);
 *     // CronParseError: Invalid cron expression "0 25 * * *" - hour must be 0-23
 *     //   Example valid expression: "0 9 * * *" (daily at 9:00 AM)
 *   }
 * }
 * ```
 */
export class CronParseError extends SchedulerError {
  /** The original cron expression that failed to parse */
  public readonly expression: string;

  /** The field that caused the error, if identifiable */
  public readonly field?: string;

  /** A suggested valid example */
  public readonly example?: string;

  constructor(
    message: string,
    expression: string,
    options?: { cause?: Error; field?: string; example?: string },
  ) {
    super(message, { cause: options?.cause, code: SchedulerErrorCode.CRON_PARSE_ERROR });
    this.name = "CronParseError";
    this.expression = expression;
    this.field = options?.field;
    this.example = options?.example;
  }

  /**
   * Build a detailed error message with examples
   */
  static buildMessage(
    expression: string,
    reason: string,
    example?: { expression: string; description: string },
  ): string {
    let message = `Invalid cron expression "${expression}" - ${reason}`;
    if (example) {
      message += `\n  Example valid expression: "${example.expression}" (${example.description})`;
    }
    return message;
  }
}

// =============================================================================
// Schedule Trigger Errors
// =============================================================================

/**
 * Error thrown when a schedule trigger fails during execution
 *
 * This error wraps the underlying cause and provides context about which
 * agent and schedule encountered the error. It is used internally by the
 * Scheduler to capture and report trigger failures while allowing the
 * scheduler to continue processing other schedules.
 */
export class ScheduleTriggerError extends SchedulerError {
  /** The name of the agent that owns the schedule */
  public readonly agentName: string;

  /** The name of the schedule that failed */
  public readonly scheduleName: string;

  constructor(
    message: string,
    agentName: string,
    scheduleName: string,
    options?: { cause?: Error },
  ) {
    super(message, { cause: options?.cause, code: SchedulerErrorCode.SCHEDULE_TRIGGER_ERROR });
    this.name = "ScheduleTriggerError";
    this.agentName = agentName;
    this.scheduleName = scheduleName;
  }
}

// =============================================================================
// Scheduler Shutdown Errors
// =============================================================================

/**
 * Error thrown when scheduler shutdown encounters issues
 *
 * This error is thrown when the scheduler cannot shut down cleanly,
 * typically due to running jobs not completing within the configured timeout.
 */
export class SchedulerShutdownError extends SchedulerError {
  /** Whether the shutdown timed out waiting for jobs to complete */
  public readonly timedOut: boolean;

  /** Number of jobs that were still running when shutdown completed/timed out */
  public readonly runningJobCount: number;

  constructor(
    message: string,
    options: { timedOut: boolean; runningJobCount: number; cause?: Error },
  ) {
    super(message, { cause: options.cause, code: SchedulerErrorCode.SCHEDULER_SHUTDOWN_ERROR });
    this.name = "SchedulerShutdownError";
    this.timedOut = options.timedOut;
    this.runningJobCount = options.runningJobCount;
  }
}
