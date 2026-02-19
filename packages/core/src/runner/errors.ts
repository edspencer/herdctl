/**
 * Error classes for runner module
 *
 * Provides typed errors with descriptive messages for SDK and execution failures.
 * All errors include context such as job ID and agent name for debugging.
 */

// =============================================================================
// Base Error Class
// =============================================================================

/**
 * Base error class for all runner errors
 */
export class RunnerError extends Error {
  /** The job ID associated with this error, if available */
  public readonly jobId?: string;
  /** The agent name associated with this error, if available */
  public readonly agentName?: string;

  constructor(message: string, options?: { jobId?: string; agentName?: string; cause?: Error }) {
    super(message);
    this.name = "RunnerError";
    this.jobId = options?.jobId;
    this.agentName = options?.agentName;
    this.cause = options?.cause;
  }
}

// =============================================================================
// SDK Initialization Errors
// =============================================================================

/**
 * Error thrown when SDK initialization fails
 *
 * Common causes:
 * - Missing API key (ANTHROPIC_API_KEY not set)
 * - Invalid API key
 * - Network connectivity issues
 * - SDK configuration errors
 */
export class SDKInitializationError extends RunnerError {
  /** The underlying error code if available */
  public readonly code?: string;

  constructor(
    message: string,
    options?: { jobId?: string; agentName?: string; cause?: Error; code?: string },
  ) {
    super(message, options);
    this.name = "SDKInitializationError";
    this.code = options?.code ?? (options?.cause as NodeJS.ErrnoException)?.code;
  }

  /**
   * Check if this error is due to a missing API key
   */
  isMissingApiKey(): boolean {
    const msg = this.message.toLowerCase();
    return (
      msg.includes("api key") ||
      msg.includes("api_key") ||
      msg.includes("authentication") ||
      msg.includes("unauthorized") ||
      this.code === "ENOKEY"
    );
  }

  /**
   * Check if this error is due to network connectivity
   */
  isNetworkError(): boolean {
    return (
      this.code === "ECONNREFUSED" ||
      this.code === "ENOTFOUND" ||
      this.code === "ETIMEDOUT" ||
      this.code === "ECONNRESET"
    );
  }
}

// =============================================================================
// SDK Streaming Errors
// =============================================================================

/**
 * Error thrown during SDK streaming execution
 *
 * Represents errors that occur while receiving messages from the SDK,
 * such as connection drops, rate limits, or API errors.
 */
export class SDKStreamingError extends RunnerError {
  /** The underlying error code if available */
  public readonly code?: string;
  /** Number of messages received before the error */
  public readonly messagesReceived?: number;

  constructor(
    message: string,
    options?: {
      jobId?: string;
      agentName?: string;
      cause?: Error;
      code?: string;
      messagesReceived?: number;
    },
  ) {
    super(message, options);
    this.name = "SDKStreamingError";
    this.code = options?.code ?? (options?.cause as NodeJS.ErrnoException)?.code;
    this.messagesReceived = options?.messagesReceived;
  }

  /**
   * Check if this error is due to rate limiting
   */
  isRateLimited(): boolean {
    const msg = this.message.toLowerCase();
    return (
      msg.includes("rate limit") ||
      msg.includes("too many requests") ||
      this.code === "ERATELIMIT" ||
      this.code === "429"
    );
  }

  /**
   * Check if this error is a connection error
   */
  isConnectionError(): boolean {
    return (
      this.code === "ECONNREFUSED" ||
      this.code === "ECONNRESET" ||
      this.code === "EPIPE" ||
      this.code === "ETIMEDOUT"
    );
  }

  /**
   * Check if this error is recoverable (could retry)
   */
  isRecoverable(): boolean {
    return this.isRateLimited() || this.isConnectionError();
  }
}

// =============================================================================
// Malformed Response Error
// =============================================================================

/**
 * Error thrown when the SDK returns a malformed or unexpected response
 *
 * This error helps identify issues with SDK responses that don't match
 * expected formats, allowing graceful handling instead of crashes.
 */
export class MalformedResponseError extends RunnerError {
  /** The raw response that caused the error */
  public readonly rawResponse?: unknown;
  /** Description of what was expected */
  public readonly expected?: string;

  constructor(
    message: string,
    options?: {
      jobId?: string;
      agentName?: string;
      cause?: Error;
      rawResponse?: unknown;
      expected?: string;
    },
  ) {
    super(message, options);
    this.name = "MalformedResponseError";
    this.rawResponse = options?.rawResponse;
    this.expected = options?.expected;
  }
}

// =============================================================================
// Error Context Builder
// =============================================================================

/**
 * Build a descriptive error message with context
 */
export function buildErrorMessage(
  baseMessage: string,
  context?: { jobId?: string; agentName?: string },
): string {
  const parts: string[] = [baseMessage];

  if (context?.agentName) {
    parts.push(`Agent: ${context.agentName}`);
  }

  if (context?.jobId) {
    parts.push(`Job: ${context.jobId}`);
  }

  return parts.join(" | ");
}

// =============================================================================
// Error Classification Helpers
// =============================================================================

/**
 * Determine the exit reason based on error type
 */
export type ErrorExitReason = "error" | "timeout" | "cancelled" | "max_turns";

/**
 * Classify an error to determine the appropriate exit reason
 */
export function classifyError(error: Error): ErrorExitReason {
  const msg = error.message.toLowerCase();

  // Check for timeout
  if (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    (error as NodeJS.ErrnoException).code === "ETIMEDOUT"
  ) {
    return "timeout";
  }

  // Check for cancellation
  if (msg.includes("abort") || msg.includes("cancel") || error.name === "AbortError") {
    return "cancelled";
  }

  // Check for max turns
  if (
    msg.includes("max turns") ||
    msg.includes("max_turns") ||
    msg.includes("turn limit") ||
    msg.includes("maximum turns")
  ) {
    return "max_turns";
  }

  // Default to generic error
  return "error";
}

/**
 * Wrap an unknown error in an appropriate RunnerError type
 */
export function wrapError(
  error: unknown,
  context: { jobId?: string; agentName?: string; phase?: "init" | "streaming" },
): RunnerError {
  // Already a RunnerError
  if (error instanceof RunnerError) {
    return error;
  }

  // Convert to Error if needed
  const baseError = error instanceof Error ? error : new Error(String(error));

  // Determine error type based on phase and characteristics
  const message = baseError.message.toLowerCase();
  const phase = context.phase ?? "streaming";

  if (phase === "init") {
    return new SDKInitializationError(buildErrorMessage(baseError.message, context), {
      jobId: context.jobId,
      agentName: context.agentName,
      cause: baseError,
    });
  }

  // Check for malformed response indicators
  if (
    message.includes("unexpected") ||
    message.includes("invalid json") ||
    message.includes("parse error") ||
    message.includes("malformed")
  ) {
    return new MalformedResponseError(buildErrorMessage(baseError.message, context), {
      jobId: context.jobId,
      agentName: context.agentName,
      cause: baseError,
    });
  }

  // Default to streaming error for runtime errors
  return new SDKStreamingError(buildErrorMessage(baseError.message, context), {
    jobId: context.jobId,
    agentName: context.agentName,
    cause: baseError,
  });
}
