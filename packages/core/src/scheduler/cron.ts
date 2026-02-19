/**
 * Cron expression parsing utilities for the scheduler module
 *
 * Parses standard 5-field cron expressions and common shorthands like @daily, @hourly, etc.
 * Uses the cron-parser library for robust parsing and validation.
 */

import cronParser, { type CronExpression } from "cron-parser";
import { CRON_FIELDS, type CronFieldInfo, CronParseError } from "./errors.js";

/**
 * Mapping of common cron shorthands to their 5-field equivalents
 */
const CRON_SHORTHANDS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

/**
 * Options for parsing cron expressions
 */
export interface CronParseOptions {
  /** Timezone for cron calculations (default: UTC) */
  tz?: string;
  /** Base date for calculations (default: now) */
  currentDate?: Date;
}

/**
 * Result of parsing a cron expression
 */
export interface ParsedCronExpression {
  /** The original expression (or expanded shorthand) */
  expression: string;
  /** The cron-parser expression object for calculating next trigger times */
  cronExpression: CronExpression;
  /** Whether the input was a shorthand like @daily */
  isShorthand: boolean;
}

/**
 * Parse a cron expression string into a parsed cron expression object
 *
 * Supports standard 5-field cron expressions:
 * - `minute hour day-of-month month day-of-week`
 * - Each field supports standard cron syntax (numbers, ranges, lists, steps, *)
 *
 * Also supports common shorthands:
 * - `@yearly` / `@annually` - Run once a year at midnight on January 1st (0 0 1 1 *)
 * - `@monthly` - Run once a month at midnight on the 1st (0 0 1 * *)
 * - `@weekly` - Run once a week at midnight on Sunday (0 0 * * 0)
 * - `@daily` / `@midnight` - Run once a day at midnight (0 0 * * *)
 * - `@hourly` - Run once an hour at the start of the hour (0 * * * *)
 *
 * @param expression - The cron expression to parse
 * @returns Parsed cron expression with iterator methods
 * @throws {CronParseError} If the expression is invalid
 *
 * @example
 * // Standard 5-field cron
 * parseCronExpression("0 9 * * 1-5")  // 9 AM on weekdays
 * parseCronExpression("0 0 1 * *")    // First of every month
 *
 * // Shorthands
 * parseCronExpression("@daily")       // Midnight every day
 * parseCronExpression("@hourly")      // Start of every hour
 * parseCronExpression("@weekly")      // Midnight on Sunday
 */
export function parseCronExpression(
  expression: string,
  options?: CronParseOptions,
): ParsedCronExpression {
  // Handle empty string
  if (!expression || expression.trim() === "") {
    throw new CronParseError(
      'Cron expression cannot be empty. Expected a 5-field cron expression (e.g., "0 9 * * *") or a shorthand like "@daily"',
      expression,
    );
  }

  const trimmed = expression.trim();
  const isShorthand = trimmed.startsWith("@");

  // Expand shorthand if applicable
  let cronExpr = trimmed;
  if (isShorthand) {
    const lowerShorthand = trimmed.toLowerCase();
    const expanded = CRON_SHORTHANDS[lowerShorthand];
    if (!expanded) {
      const validShorthands = Object.keys(CRON_SHORTHANDS)
        .filter((s) => s !== "@annually" && s !== "@midnight") // Don't show aliases
        .join(", ");
      throw new CronParseError(
        `Unknown cron shorthand "${trimmed}". Valid shorthands are: ${validShorthands}`,
        expression,
      );
    }
    cronExpr = expanded;
  }

  // Validate field count before parsing
  const fieldCountError = validateFieldCount(cronExpr);
  if (fieldCountError) {
    throw new CronParseError(
      CronParseError.buildMessage(trimmed, fieldCountError.reason, fieldCountError.example),
      expression,
      { field: "fields", example: fieldCountError.example?.expression },
    );
  }

  // Check for field-specific validation errors before cron-parser
  const fieldError = validateCronFields(cronExpr);
  if (fieldError) {
    throw new CronParseError(
      CronParseError.buildMessage(trimmed, fieldError.reason, fieldError.example),
      expression,
      { cause: undefined, field: fieldError.field, example: fieldError.example?.expression },
    );
  }

  try {
    const parserOptions: { tz?: string; currentDate?: Date } = {
      tz: options?.tz ?? "UTC",
    };
    if (options?.currentDate) {
      parserOptions.currentDate = options.currentDate;
    }
    const cronExpression = cronParser.parseExpression(cronExpr, parserOptions);
    return {
      expression: cronExpr,
      cronExpression,
      isShorthand,
    };
  } catch (error) {
    // Try to extract field-specific error from cron-parser
    const errorMessage = error instanceof Error ? error.message : "Unknown parsing error";
    const parsedError = parseErrorMessage(errorMessage, cronExpr);

    throw new CronParseError(
      CronParseError.buildMessage(trimmed, parsedError.reason, parsedError.example),
      expression,
      {
        cause: error instanceof Error ? error : undefined,
        field: parsedError.field,
        example: parsedError.example?.expression,
      },
    );
  }
}

/**
 * Field validation error info
 */
interface FieldValidationError {
  reason: string;
  field?: string;
  example?: { expression: string; description: string };
}

/**
 * Validate field count in cron expression
 */
function validateFieldCount(expression: string): FieldValidationError | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length < 5) {
    return {
      reason: `expected 5 fields, got ${fields.length}`,
      field: "fields",
      example: { expression: "* * * * *", description: "every minute" },
    };
  }
  if (fields.length > 5) {
    return {
      reason: `expected 5 fields, got ${fields.length}`,
      field: "fields",
      example: { expression: "0 9 * * *", description: "daily at 9:00 AM" },
    };
  }
  return null;
}

/**
 * Validate individual cron fields for common errors
 */
function validateCronFields(expression: string): FieldValidationError | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    return null; // Field count validation handles this
  }

  for (const fieldInfo of CRON_FIELDS) {
    const fieldValue = fields[fieldInfo.index];
    const error = validateField(fieldValue, fieldInfo);
    if (error) {
      return error;
    }
  }
  return null;
}

/**
 * Validate a single cron field
 */
function validateField(value: string, fieldInfo: CronFieldInfo): FieldValidationError | null {
  // Skip wildcards and complex patterns for basic validation
  if (value === "*") {
    return null;
  }

  // Handle step syntax (e.g., */15)
  if (value.startsWith("*/")) {
    const step = parseInt(value.slice(2), 10);
    if (Number.isNaN(step) || step <= 0) {
      return {
        reason: `invalid step value "${value}" for ${fieldInfo.name}`,
        field: fieldInfo.name,
        example: getExampleForField(fieldInfo),
      };
    }
    return null;
  }

  // Handle ranges (e.g., 1-5)
  if (value.includes("-") && !value.startsWith("-")) {
    const parts = value.split("-");
    if (parts.length === 2) {
      const start = parseInt(parts[0], 10);
      const end = parseInt(parts[1], 10);
      if (!Number.isNaN(start) && !Number.isNaN(end)) {
        if (start < fieldInfo.min || start > fieldInfo.max) {
          return {
            reason: `${fieldInfo.name} must be ${fieldInfo.min}-${fieldInfo.max}`,
            field: fieldInfo.name,
            example: getExampleForField(fieldInfo),
          };
        }
        if (end < fieldInfo.min || end > fieldInfo.max) {
          return {
            reason: `${fieldInfo.name} must be ${fieldInfo.min}-${fieldInfo.max}`,
            field: fieldInfo.name,
            example: getExampleForField(fieldInfo),
          };
        }
      }
    }
    return null;
  }

  // Handle lists (e.g., 1,3,5)
  if (value.includes(",")) {
    const parts = value.split(",");
    for (const part of parts) {
      const num = parseInt(part, 10);
      if (!Number.isNaN(num) && (num < fieldInfo.min || num > fieldInfo.max)) {
        return {
          reason: `${fieldInfo.name} must be ${fieldInfo.min}-${fieldInfo.max}`,
          field: fieldInfo.name,
          example: getExampleForField(fieldInfo),
        };
      }
    }
    return null;
  }

  // Handle simple numeric values
  const num = parseInt(value, 10);
  if (!Number.isNaN(num)) {
    if (num < fieldInfo.min || num > fieldInfo.max) {
      return {
        reason: `${fieldInfo.name} must be ${fieldInfo.min}-${fieldInfo.max}`,
        field: fieldInfo.name,
        example: getExampleForField(fieldInfo),
      };
    }
  }

  return null;
}

/**
 * Get a helpful example for a specific field
 */
function getExampleForField(fieldInfo: CronFieldInfo): { expression: string; description: string } {
  switch (fieldInfo.name) {
    case "minute":
      return { expression: "30 * * * *", description: "every hour at :30" };
    case "hour":
      return { expression: "0 9 * * *", description: "daily at 9:00 AM" };
    case "day-of-month":
      return { expression: "0 0 1 * *", description: "first of every month" };
    case "month":
      return { expression: "0 0 1 6 *", description: "June 1st at midnight" };
    case "day-of-week":
      return { expression: "0 9 * * 1-5", description: "weekdays at 9:00 AM" };
    default:
      return { expression: "0 9 * * *", description: "daily at 9:00 AM" };
  }
}

/**
 * Parse error message from cron-parser and extract field info
 */
function parseErrorMessage(errorMessage: string, _expression: string): FieldValidationError {
  // Try to identify which field failed
  const lowerMsg = errorMessage.toLowerCase();

  // Check for "Constraint error" messages from cron-parser
  if (lowerMsg.includes("constraint error")) {
    // cron-parser often says things like "Constraint error, got value X expected range Y-Z"
    const valueMatch = errorMessage.match(/got value (\d+)/i);
    const rangeMatch = errorMessage.match(/expected range (\d+)-(\d+)/i);

    if (valueMatch && rangeMatch) {
      const _value = parseInt(valueMatch[1], 10);
      const min = parseInt(rangeMatch[1], 10);
      const max = parseInt(rangeMatch[2], 10);

      // Determine which field based on the range
      const field = identifyFieldByRange(min, max);
      if (field) {
        return {
          reason: `${field.name} must be ${field.min}-${field.max}`,
          field: field.name,
          example: getExampleForField(field),
        };
      }
    }
  }

  // Check for field-specific keywords
  for (const field of CRON_FIELDS) {
    if (lowerMsg.includes(field.name)) {
      return {
        reason: `${field.name} must be ${field.min}-${field.max}`,
        field: field.name,
        example: getExampleForField(field),
      };
    }
  }

  // Generic fallback
  return {
    reason: errorMessage,
    example: { expression: "0 9 * * *", description: "daily at 9:00 AM" },
  };
}

/**
 * Identify cron field by its valid range
 */
function identifyFieldByRange(min: number, max: number): CronFieldInfo | null {
  for (const field of CRON_FIELDS) {
    if (field.min === min && field.max === max) {
      return field;
    }
  }
  // Handle day-of-week which can be 0-6 or 0-7
  if (min === 0 && (max === 6 || max === 7)) {
    return CRON_FIELDS[4]; // day-of-week
  }
  return null;
}

/**
 * Get the next trigger time for a cron expression
 *
 * @param expression - The cron expression (5-field or shorthand)
 * @param fromDate - Optional date to calculate from (defaults to now)
 * @returns The next trigger time as a Date
 * @throws {CronParseError} If the expression is invalid
 *
 * @example
 * // Get next trigger from now
 * getNextCronTrigger("0 9 * * 1-5") // Next 9 AM on a weekday
 *
 * // Get next trigger from a specific date
 * getNextCronTrigger("@daily", new Date("2024-01-15T12:00:00Z"))
 * // Returns 2024-01-16T00:00:00Z
 */
export function getNextCronTrigger(expression: string, fromDate?: Date, tz?: string): Date {
  const parsed = parseCronExpression(expression, {
    currentDate: fromDate,
    tz: tz ?? "UTC",
  });

  return parsed.cronExpression.next().toDate();
}

/**
 * Check if a cron expression is valid
 *
 * @param expression - The cron expression to validate
 * @returns true if the expression is valid, false otherwise
 *
 * @example
 * isValidCronExpression("0 9 * * *")  // true
 * isValidCronExpression("@daily")     // true
 * isValidCronExpression("invalid")    // false
 * isValidCronExpression("60 * * * *") // false (minute > 59)
 */
export function isValidCronExpression(expression: string): boolean {
  try {
    parseCronExpression(expression);
    return true;
  } catch {
    return false;
  }
}

/**
 * Calculate the next trigger time for a cron expression using system timezone
 *
 * This function uses the system's local timezone for calculations, which is
 * consistent with interval-based scheduling behavior.
 *
 * @param expression - The cron expression (5-field or shorthand)
 * @param after - Optional date to calculate from (defaults to now)
 * @returns The next trigger time as a Date
 * @throws {CronParseError} If the expression is invalid
 *
 * @example
 * // Daily at 9:00 AM
 * const expr = "0 9 * * *";
 * const morning = new Date("2024-01-15T08:00:00");
 * calculateNextCronTrigger(expr, morning)  // Returns 2024-01-15T09:00:00 (local)
 *
 * @example
 * // Every 15 minutes (use step syntax)
 * const midHour = new Date("2024-01-15T10:07:00");
 * calculateNextCronTrigger("0,15,30,45 * * * *", midHour)  // Returns 2024-01-15T10:15:00 (local)
 */
export function calculateNextCronTrigger(expression: string, after?: Date): Date {
  // Get the system timezone
  const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const parsed = parseCronExpression(expression, {
    currentDate: after,
    tz: systemTimezone,
  });

  return parsed.cronExpression.next().toDate();
}

/**
 * Calculate the previous trigger time for a cron expression
 *
 * Returns the most recent occurrence of the cron schedule before the given time
 * (or before now if no time is specified).
 *
 * @param expression - The cron expression (5-field or shorthand)
 * @param before - Optional date to calculate from (defaults to now)
 * @returns The previous trigger time as a Date
 * @throws {CronParseError} If the expression is invalid
 *
 * @example
 * // If current time is 11:30 and cron is @hourly (at :00)
 * calculatePreviousCronTrigger("@hourly")  // Returns 11:00
 */
export function calculatePreviousCronTrigger(expression: string, before?: Date): Date {
  // Get the system timezone
  const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const parsed = parseCronExpression(expression, {
    currentDate: before,
    tz: systemTimezone,
  });

  return parsed.cronExpression.prev().toDate();
}
