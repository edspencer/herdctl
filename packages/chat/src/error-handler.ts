/**
 * Error handling utilities for chat connectors
 *
 * Provides:
 * - Error classification for handling decisions
 * - User-friendly error messages
 * - Retry logic for transient failures
 * - Safe execution wrappers
 *
 * Platform-specific error classification stays in platform packages,
 * but the common infrastructure is here.
 */

import type { ChatConnectorLogger } from "./types.js";

// =============================================================================
// Error Categories
// =============================================================================

/**
 * Categories of errors for handling purposes
 *
 * Used to determine appropriate responses and whether to retry.
 */
export enum ErrorCategory {
  /** Transient errors that may succeed on retry (network issues, timeouts) */
  TRANSIENT = "transient",
  /** Permanent errors that won't succeed on retry (invalid config) */
  PERMANENT = "permanent",
  /** Rate limit errors that need backoff before retry */
  RATE_LIMIT = "rate_limit",
  /** Configuration or setup errors */
  CONFIGURATION = "configuration",
  /** Authentication or authorization errors */
  AUTH = "auth",
  /** Network connectivity errors */
  NETWORK = "network",
  /** API-specific errors */
  API = "api",
  /** Internal/unexpected errors */
  INTERNAL = "internal",
  /** Unknown/unexpected errors */
  UNKNOWN = "unknown",
}

// =============================================================================
// Classified Error
// =============================================================================

/**
 * Classified error with category and handling information
 */
export interface ClassifiedError {
  /** Original error */
  error: Error;
  /** Error category for handling decisions */
  category: ErrorCategory;
  /** User-friendly message to display */
  userMessage: string;
  /** Whether this error should be retried */
  shouldRetry: boolean;
  /** Suggested retry delay in milliseconds (if shouldRetry is true) */
  retryDelayMs?: number;
}

// =============================================================================
// User Error Messages
// =============================================================================

/**
 * Standard user-friendly error messages
 *
 * These are safe to show to end users in chat platforms.
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
  /** Authentication error */
  AUTH_ERROR: "I'm having trouble authenticating. Please contact an administrator.",
  /** API error */
  API_ERROR: "Something went wrong with the chat API. Please try again.",
  /** Internal error */
  INTERNAL_ERROR: "An internal error occurred. Please try again or start a new session.",
  /** Unknown error */
  UNKNOWN_ERROR: "An unexpected error occurred. Please try again.",
} as const;

export type UserErrorMessageKey = keyof typeof USER_ERROR_MESSAGES;

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
  logger?: ChatConnectorLogger;
  /** Operation name for logging */
  operationName?: string;
  /** Predicate to determine if error should be retried */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

/**
 * Default retry options
 */
const DEFAULT_RETRY_OPTIONS = {
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
 * Only retries errors when the shouldRetry predicate returns true.
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
 *     shouldRetry: (error) => isTransientError(error),
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

  // Default shouldRetry: retry transient errors
  const shouldRetryFn = options.shouldRetry ?? ((error: unknown) => isTransientError(error));

  let lastError: Error | undefined;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt++;

    try {
      const value = await operation();
      return { success: true, value, attempts: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      const shouldRetryError = shouldRetryFn(error, attempt);

      if (!shouldRetryError || attempt >= maxAttempts) {
        // Don't retry: either permanent error or out of attempts
        logger?.debug(`${operationName} failed permanently after ${attempt} attempt(s)`, {
          error: lastError.message,
        });
        break;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(baseDelayMs * Math.pow(backoffMultiplier, attempt - 1), maxDelayMs);

      logger?.info(`${operationName} failed, retrying in ${delay}ms...`, {
        attempt,
        maxAttempts,
        error: lastError.message,
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

// =============================================================================
// Error Classification Helpers
// =============================================================================

/**
 * Check if an error is a transient error (may succeed on retry)
 *
 * @param error - Error to check
 * @returns true if the error appears to be transient
 */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();

  // Network errors
  const networkPatterns = [
    "econnreset",
    "econnrefused",
    "etimedout",
    "enotfound",
    "eai_again",
    "enetunreach",
    "ehostunreach",
    "socket hang up",
    "network",
    "connect econnrefused",
    "getaddrinfo",
    "fetch failed",
  ];

  if (
    networkPatterns.some(
      (pattern) => message.includes(pattern.toLowerCase()) || name.includes(pattern.toLowerCase()),
    )
  ) {
    return true;
  }

  // Timeout errors
  const timeoutPatterns = ["timeout", "timed out", "etimedout", "aborterror"];

  if (
    timeoutPatterns.some(
      (pattern) => message.includes(pattern.toLowerCase()) || name.includes(pattern.toLowerCase()),
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Check if an error is a rate limit error
 *
 * @param error - Error to check
 * @returns true if the error indicates rate limiting
 */
export function isRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("rate_limit") || message.includes("ratelimited");
}

/**
 * Check if an error is an authentication error
 *
 * @param error - Error to check
 * @returns true if the error indicates an auth problem
 */
export function isAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("invalid_auth") ||
    message.includes("token_revoked") ||
    message.includes("token_expired") ||
    message.includes("not_authed") ||
    message.includes("unauthorized") ||
    message.includes("forbidden")
  );
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
 * @param logger - Logger for error logging
 * @param context - Description of the operation for logging
 * @returns Result or undefined on error
 *
 * @example
 * ```typescript
 * const result = await safeExecute(
 *   () => fetchUserData(userId),
 *   logger,
 *   'fetching user data'
 * );
 * if (result) {
 *   // Use result
 * }
 * ```
 */
export async function safeExecute<T>(
  operation: () => Promise<T>,
  logger: ChatConnectorLogger,
  context: string,
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error in ${context}: ${errorMessage}`);
    return undefined;
  }
}

/**
 * Execute an async function and reply with error message on failure
 *
 * On error, sends a user-friendly error message to the reply function.
 *
 * @param operation - Async function to execute
 * @param reply - Function to send error reply
 * @param logger - Logger for error logging
 * @param context - Description of the operation for logging
 * @param userMessage - Custom error message for user (optional)
 *
 * @example
 * ```typescript
 * await safeExecuteWithReply(
 *   () => processMessage(message),
 *   (msg) => channel.send(msg),
 *   logger,
 *   'processing message'
 * );
 * ```
 */
export async function safeExecuteWithReply(
  operation: () => Promise<void>,
  reply: (content: string) => Promise<void>,
  logger: ChatConnectorLogger,
  context: string,
  userMessage?: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(`Error in ${context}: ${err.message}`);

    try {
      const message = userMessage ?? USER_ERROR_MESSAGES.PROCESSING_ERROR;
      await reply(message);
    } catch (replyError) {
      logger.error(`Failed to send error reply: ${(replyError as Error).message}`);
    }
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
