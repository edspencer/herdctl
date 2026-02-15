/**
 * Error handling utilities for the Slack connector
 *
 * Provides error classification, user-friendly messages,
 * and retry logic for Slack API operations.
 */

import type { SlackConnectorLogger } from "./types.js";

// =============================================================================
// Error Classification
// =============================================================================

/**
 * Error categories for classification
 */
export enum ErrorCategory {
  /** Authentication/authorization errors */
  AUTH = "auth",
  /** Rate limiting errors */
  RATE_LIMIT = "rate_limit",
  /** Network errors */
  NETWORK = "network",
  /** Slack API errors */
  API = "api",
  /** Internal errors */
  INTERNAL = "internal",
  /** Unknown errors */
  UNKNOWN = "unknown",
}

/**
 * Classified error with category and user-facing message
 */
export interface ClassifiedError {
  category: ErrorCategory;
  userMessage: string;
  isRetryable: boolean;
  originalError: Error;
}

/**
 * User-friendly error messages
 */
export const USER_ERROR_MESSAGES: Record<string, string> = {
  auth: "I'm having trouble authenticating with Slack. Please check the bot configuration.",
  rate_limit: "I'm being rate limited by Slack. Please try again in a moment.",
  network: "I'm having trouble connecting to Slack. Please try again later.",
  api: "Something went wrong with the Slack API. Please try again.",
  internal: "An internal error occurred. Please try again or use `!reset` to start a new session.",
  unknown: "An unexpected error occurred. Please try again.",
};

/**
 * Classify an error for appropriate handling
 */
export function classifyError(error: Error): ClassifiedError {
  const message = error.message.toLowerCase();

  if (message.includes("invalid_auth") || message.includes("token")) {
    return {
      category: ErrorCategory.AUTH,
      userMessage: USER_ERROR_MESSAGES.auth,
      isRetryable: false,
      originalError: error,
    };
  }

  if (message.includes("rate_limit") || message.includes("ratelimited")) {
    return {
      category: ErrorCategory.RATE_LIMIT,
      userMessage: USER_ERROR_MESSAGES.rate_limit,
      isRetryable: true,
      originalError: error,
    };
  }

  if (
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("timeout")
  ) {
    return {
      category: ErrorCategory.NETWORK,
      userMessage: USER_ERROR_MESSAGES.network,
      isRetryable: true,
      originalError: error,
    };
  }

  if (message.includes("slack") || message.includes("api")) {
    return {
      category: ErrorCategory.API,
      userMessage: USER_ERROR_MESSAGES.api,
      isRetryable: true,
      originalError: error,
    };
  }

  return {
    category: ErrorCategory.UNKNOWN,
    userMessage: USER_ERROR_MESSAGES.unknown,
    isRetryable: false,
    originalError: error,
  };
}

// =============================================================================
// Safe Execution
// =============================================================================

/**
 * Execute a function safely, catching and logging errors
 */
export async function safeExecute<T>(
  fn: () => Promise<T>,
  logger: SlackConnectorLogger,
  context: string
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    logger.error(`Error in ${context}: ${errorMessage}`);
    return undefined;
  }
}

/**
 * Execute a function safely and reply with error message on failure
 */
export async function safeExecuteWithReply(
  fn: () => Promise<void>,
  reply: (content: string) => Promise<void>,
  logger: SlackConnectorLogger,
  context: string
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const classified = classifyError(err);
    logger.error(`Error in ${context}: ${err.message}`);

    try {
      await reply(classified.userMessage);
    } catch (replyError) {
      logger.error(
        `Failed to send error reply: ${(replyError as Error).message}`
      );
    }
  }
}
