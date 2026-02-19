/**
 * Error handler utilities for Discord connector
 *
 * Provides:
 * - User-friendly error messages for Discord users
 * - Detailed logging for debugging
 * - Retry logic for transient failures
 * - Error classification and handling
 */

import type { DiscordConnectorLogger } from "./types.js";
import { DiscordErrorCode, isDiscordConnectorError, type DiscordConnectorError } from "./errors.js";
import { isSessionManagerError, type SessionManagerError } from "@herdctl/chat";

// =============================================================================
// User-Friendly Error Messages
// =============================================================================

/**
 * Standard user-friendly error messages for Discord responses
 */
export const USER_ERROR_MESSAGES = {
  /** Generic processing error */
  PROCESSING_ERROR: "Sorry, I encountered an error processing your request. Please try again.",
  /** Connection/network error */
  CONNECTION_ERROR: "I'm having trouble connecting right now. Please try again in a moment.",
  /** Rate limit error */
  RATE_LIMITED: "I'm receiving too many requests right now. Please wait a moment and try again.",
  /** Command execution error */
  COMMAND_ERROR: "Sorry, I couldn't complete that command. Please try again.",
  /** Session error */
  SESSION_ERROR: "I'm having trouble with your conversation session. Please try again.",
  /** Timeout error */
  TIMEOUT_ERROR: "The request took too long to complete. Please try again.",
  /** Permission error */
  PERMISSION_ERROR: "I don't have permission to do that in this channel.",
} as const;

export type UserErrorMessageKey = keyof typeof USER_ERROR_MESSAGES;

// =============================================================================
// Error Classification
// =============================================================================

/**
 * Categories of errors for handling purposes
 */
export enum ErrorCategory {
  /** Transient errors that may succeed on retry */
  TRANSIENT = "transient",
  /** Permanent errors that won't succeed on retry */
  PERMANENT = "permanent",
  /** Rate limit errors that need backoff */
  RATE_LIMIT = "rate_limit",
  /** Configuration/setup errors */
  CONFIGURATION = "configuration",
  /** Unknown/unexpected errors */
  UNKNOWN = "unknown",
}

/**
 * Classified error with category and user-friendly message
 */
export interface ClassifiedError {
  /** Original error */
  error: Error;
  /** Error category for handling */
  category: ErrorCategory;
  /** User-friendly message to display */
  userMessage: string;
  /** Whether this error should be retried */
  shouldRetry: boolean;
  /** Suggested retry delay in milliseconds (if shouldRetry is true) */
  retryDelayMs?: number;
}

/**
 * Classify an error for appropriate handling
 *
 * @param error - The error to classify
 * @returns Classified error with category and handling info
 */
export function classifyError(error: unknown): ClassifiedError {
  // Ensure we have an Error object
  const err = error instanceof Error ? error : new Error(String(error));

  // Check for Discord connector errors
  if (isDiscordConnectorError(error)) {
    return classifyDiscordError(error);
  }

  // Check for session manager errors
  if (isSessionManagerError(error)) {
    return classifySessionError(error);
  }

  // Check for network/connection errors
  if (isNetworkError(err)) {
    return {
      error: err,
      category: ErrorCategory.TRANSIENT,
      userMessage: USER_ERROR_MESSAGES.CONNECTION_ERROR,
      shouldRetry: true,
      retryDelayMs: 1000,
    };
  }

  // Check for timeout errors
  if (isTimeoutError(err)) {
    return {
      error: err,
      category: ErrorCategory.TRANSIENT,
      userMessage: USER_ERROR_MESSAGES.TIMEOUT_ERROR,
      shouldRetry: true,
      retryDelayMs: 2000,
    };
  }

  // Default: unknown error
  return {
    error: err,
    category: ErrorCategory.UNKNOWN,
    userMessage: USER_ERROR_MESSAGES.PROCESSING_ERROR,
    shouldRetry: false,
  };
}

/**
 * Classify a Discord connector error
 */
function classifyDiscordError(error: DiscordConnectorError): ClassifiedError {
  switch (error.code) {
    case DiscordErrorCode.RATE_LIMITED:
      return {
        error,
        category: ErrorCategory.RATE_LIMIT,
        userMessage: USER_ERROR_MESSAGES.RATE_LIMITED,
        shouldRetry: true,
        retryDelayMs: 5000, // Default, actual delay comes from Discord
      };

    case DiscordErrorCode.CONNECTION_FAILED:
    case DiscordErrorCode.GATEWAY_ERROR:
      return {
        error,
        category: ErrorCategory.TRANSIENT,
        userMessage: USER_ERROR_MESSAGES.CONNECTION_ERROR,
        shouldRetry: true,
        retryDelayMs: 2000,
      };

    case DiscordErrorCode.INVALID_TOKEN:
    case DiscordErrorCode.MISSING_TOKEN:
      return {
        error,
        category: ErrorCategory.CONFIGURATION,
        userMessage: USER_ERROR_MESSAGES.PROCESSING_ERROR,
        shouldRetry: false,
      };

    case DiscordErrorCode.ALREADY_CONNECTED:
    case DiscordErrorCode.NOT_CONNECTED:
      return {
        error,
        category: ErrorCategory.PERMANENT,
        userMessage: USER_ERROR_MESSAGES.PROCESSING_ERROR,
        shouldRetry: false,
      };

    default:
      return {
        error,
        category: ErrorCategory.UNKNOWN,
        userMessage: USER_ERROR_MESSAGES.PROCESSING_ERROR,
        shouldRetry: false,
      };
  }
}

/**
 * Classify a session manager error
 */
function classifySessionError(error: SessionManagerError): ClassifiedError {
  // Session errors are generally transient (file system issues)
  return {
    error,
    category: ErrorCategory.TRANSIENT,
    userMessage: USER_ERROR_MESSAGES.SESSION_ERROR,
    shouldRetry: true,
    retryDelayMs: 1000,
  };
}

/**
 * Check if an error is a network-related error
 */
function isNetworkError(error: Error): boolean {
  const networkErrorPatterns = [
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "socket hang up",
    "network",
    "connect ECONNREFUSED",
    "getaddrinfo",
    "fetch failed",
  ];

  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();

  return networkErrorPatterns.some(
    (pattern) => message.includes(pattern.toLowerCase()) || name.includes(pattern.toLowerCase()),
  );
}

/**
 * Check if an error is a timeout error
 */
function isTimeoutError(error: Error): boolean {
  const timeoutPatterns = ["timeout", "timed out", "ETIMEDOUT", "AbortError"];

  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();

  return timeoutPatterns.some(
    (pattern) => message.includes(pattern.toLowerCase()) || name.includes(pattern.toLowerCase()),
  );
}

// =============================================================================
// Retry Logic
// =============================================================================

/**
 * Options for retry operations
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Base delay between retries in ms (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay between retries in ms (default: 30000) */
  maxDelayMs?: number;
  /** Exponential backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Logger for retry attempts */
  logger?: DiscordConnectorLogger;
  /** Operation name for logging */
  operationName?: string;
  /** Predicate to determine if error should be retried */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, "logger" | "shouldRetry">> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  operationName: "operation",
};

/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
  /** Whether the operation succeeded */
  success: boolean;
  /** The result value (if success is true) */
  value?: T;
  /** The last error encountered (if success is false) */
  error?: Error;
  /** Number of attempts made */
  attempts: number;
}

/**
 * Execute an async operation with retry logic
 *
 * Uses exponential backoff for transient failures.
 * Only retries errors that are classified as retryable.
 *
 * @param operation - Async function to execute
 * @param options - Retry configuration
 * @returns Result with success status, value, or error
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   async () => {
 *     const response = await fetch(url);
 *     if (!response.ok) throw new Error('Request failed');
 *     return response.json();
 *   },
 *   {
 *     maxAttempts: 3,
 *     operationName: 'fetchData',
 *     logger: myLogger,
 *   }
 * );
 *
 * if (result.success) {
 *   console.log('Data:', result.value);
 * } else {
 *   console.error('Failed after', result.attempts, 'attempts:', result.error);
 * }
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryResult<T>> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const { maxAttempts, baseDelayMs, maxDelayMs, backoffMultiplier, operationName, logger } = opts;

  let lastError: Error | undefined;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt++;

    try {
      const value = await operation();
      return { success: true, value, attempts: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Classify the error to determine if we should retry
      const classified = classifyError(error);

      // Check custom shouldRetry predicate if provided
      const shouldRetryError = options.shouldRetry
        ? options.shouldRetry(error, attempt)
        : classified.shouldRetry;

      if (!shouldRetryError || attempt >= maxAttempts) {
        // Don't retry: either permanent error or out of attempts
        logger?.debug(`${operationName} failed permanently after ${attempt} attempt(s)`, {
          error: lastError.message,
          category: classified.category,
        });
        break;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        classified.retryDelayMs ?? baseDelayMs * Math.pow(backoffMultiplier, attempt - 1),
        maxDelayMs,
      );

      logger?.info(`${operationName} failed, retrying in ${delay}ms...`, {
        attempt,
        maxAttempts,
        error: lastError.message,
        category: classified.category,
      });

      // Wait before retrying
      await sleep(delay);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: attempt,
  };
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Error Handler Class
// =============================================================================

/**
 * Options for the ErrorHandler
 */
export interface ErrorHandlerOptions {
  /** Logger for error logging */
  logger: DiscordConnectorLogger;
  /** Agent name for context in logs */
  agentName: string;
}

/**
 * Error handler that provides user-friendly messages and detailed logging
 *
 * Handles:
 * - Converting errors to user-friendly messages
 * - Logging detailed error information for debugging
 * - Tracking error statistics
 *
 * @example
 * ```typescript
 * const errorHandler = new ErrorHandler({
 *   logger: myLogger,
 *   agentName: 'my-agent',
 * });
 *
 * try {
 *   await someOperation();
 * } catch (error) {
 *   const userMessage = errorHandler.handleError(error, 'processing message');
 *   await message.reply(userMessage);
 * }
 * ```
 */
export class ErrorHandler {
  private readonly logger: DiscordConnectorLogger;
  private readonly agentName: string;
  private errorCounts: Map<ErrorCategory, number> = new Map();

  constructor(options: ErrorHandlerOptions) {
    this.logger = options.logger;
    this.agentName = options.agentName;
  }

  /**
   * Handle an error and return a user-friendly message
   *
   * Logs detailed error information and returns a safe message for users.
   *
   * @param error - The error to handle
   * @param context - Description of what operation was being performed
   * @returns User-friendly error message
   */
  handleError(error: unknown, context: string): string {
    const classified = classifyError(error);

    // Increment error count for this category
    const currentCount = this.errorCounts.get(classified.category) ?? 0;
    this.errorCounts.set(classified.category, currentCount + 1);

    // Log detailed error for debugging
    this.logger.error(`Error during ${context}`, {
      agentName: this.agentName,
      context,
      category: classified.category,
      shouldRetry: classified.shouldRetry,
      errorMessage: classified.error.message,
      errorName: classified.error.name,
      stack: classified.error.stack,
    });

    return classified.userMessage;
  }

  /**
   * Handle an error with custom user message
   *
   * @param error - The error to handle
   * @param context - Description of what operation was being performed
   * @param userMessage - Custom message to return to user
   * @returns The provided user message
   */
  handleErrorWithMessage(error: unknown, context: string, userMessage: string): string {
    const classified = classifyError(error);

    // Log detailed error for debugging
    this.logger.error(`Error during ${context}`, {
      agentName: this.agentName,
      context,
      category: classified.category,
      errorMessage: classified.error.message,
      errorName: classified.error.name,
      stack: classified.error.stack,
    });

    return userMessage;
  }

  /**
   * Get error statistics
   *
   * @returns Map of error categories to counts
   */
  getErrorStats(): ReadonlyMap<ErrorCategory, number> {
    return this.errorCounts;
  }

  /**
   * Reset error statistics
   */
  resetStats(): void {
    this.errorCounts.clear();
  }

  /**
   * Check if an error is retryable
   *
   * @param error - The error to check
   * @returns true if the error should be retried
   */
  isRetryable(error: unknown): boolean {
    return classifyError(error).shouldRetry;
  }

  /**
   * Get the appropriate user message for an error
   *
   * @param error - The error to get message for
   * @returns User-friendly error message
   */
  getUserMessage(error: unknown): string {
    return classifyError(error).userMessage;
  }
}

// =============================================================================
// Safe Execution Helpers
// =============================================================================

/**
 * Execute an async function and handle errors safely
 *
 * Returns the result or undefined if an error occurs.
 * Always logs errors for debugging.
 *
 * @param operation - Async function to execute
 * @param errorHandler - Error handler for logging
 * @param context - Description of the operation
 * @returns Result or undefined on error
 */
export async function safeExecute<T>(
  operation: () => Promise<T>,
  errorHandler: ErrorHandler,
  context: string,
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    errorHandler.handleError(error, context);
    return undefined;
  }
}

/**
 * Execute an async function that returns a reply to the user
 *
 * On error, returns a user-friendly error message instead.
 *
 * @param operation - Async function to execute that returns a message
 * @param errorHandler - Error handler for logging
 * @param context - Description of the operation
 * @returns Result message or error message
 */
export async function safeExecuteWithReply(
  operation: () => Promise<string>,
  errorHandler: ErrorHandler,
  context: string,
): Promise<string> {
  try {
    return await operation();
  } catch (error) {
    return errorHandler.handleError(error, context);
  }
}
