/**
 * Error handling utilities for the Slack connector
 *
 * Provides Slack-specific error classification that builds on
 * the shared error handling infrastructure from @herdctl/chat.
 */

import type { SlackConnectorLogger } from "./types.js";
import {
  ErrorCategory,
  type ClassifiedError,
  USER_ERROR_MESSAGES,
  safeExecute as baseSafeExecute,
  safeExecuteWithReply as baseSafeExecuteWithReply,
} from "@herdctl/chat";

// Re-export shared types and utilities
export { ErrorCategory, type ClassifiedError, USER_ERROR_MESSAGES } from "@herdctl/chat";

// =============================================================================
// Slack-specific Error Classification
// =============================================================================

/**
 * Classify a Slack-specific error for appropriate handling
 *
 * This function provides Slack-specific error classification patterns.
 */
export function classifyError(error: Error): ClassifiedError {
  const message = error.message.toLowerCase();

  if (
    message.includes("invalid_auth") ||
    message.includes("token_revoked") ||
    message.includes("token_expired") ||
    message.includes("not_authed")
  ) {
    return {
      error,
      category: ErrorCategory.AUTH,
      userMessage: USER_ERROR_MESSAGES.AUTH_ERROR,
      shouldRetry: false,
    };
  }

  if (message.includes("rate_limit") || message.includes("ratelimited")) {
    return {
      error,
      category: ErrorCategory.RATE_LIMIT,
      userMessage: USER_ERROR_MESSAGES.RATE_LIMITED,
      shouldRetry: true,
      retryDelayMs: 5000, // 5 second delay for rate limits
    };
  }

  if (
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("timeout")
  ) {
    return {
      error,
      category: ErrorCategory.NETWORK,
      userMessage: USER_ERROR_MESSAGES.CONNECTION_ERROR,
      shouldRetry: true,
    };
  }

  if (message.includes("slack") || message.includes("api")) {
    return {
      error,
      category: ErrorCategory.API,
      userMessage: USER_ERROR_MESSAGES.API_ERROR,
      shouldRetry: true,
    };
  }

  return {
    error,
    category: ErrorCategory.UNKNOWN,
    userMessage: USER_ERROR_MESSAGES.UNKNOWN_ERROR,
    shouldRetry: false,
  };
}

// =============================================================================
// Safe Execution Wrappers
// =============================================================================

/**
 * Execute a function safely, catching and logging errors
 *
 * Wrapper around @herdctl/chat's safeExecute that accepts SlackConnectorLogger.
 */
export async function safeExecute<T>(
  fn: () => Promise<T>,
  logger: SlackConnectorLogger,
  context: string,
): Promise<T | undefined> {
  return baseSafeExecute(fn, logger, context);
}

/**
 * Execute a function safely and reply with error message on failure
 *
 * Wrapper around @herdctl/chat's safeExecuteWithReply that accepts SlackConnectorLogger
 * and uses the Slack-specific classifyError function.
 */
export async function safeExecuteWithReply(
  fn: () => Promise<void>,
  reply: (content: string) => Promise<void>,
  logger: SlackConnectorLogger,
  context: string,
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
      logger.error(`Failed to send error reply: ${(replyError as Error).message}`);
    }
  }
}
