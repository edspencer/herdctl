import { SessionStateReadError } from "@herdctl/chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyError,
  ErrorCategory,
  ErrorHandler,
  safeExecute,
  safeExecuteWithReply,
  USER_ERROR_MESSAGES,
  withRetry,
} from "../error-handler.js";
import {
  AlreadyConnectedError,
  DiscordConnectionError,
  DiscordConnectorError,
  DiscordErrorCode,
  InvalidTokenError,
} from "../errors.js";

// =============================================================================
// USER_ERROR_MESSAGES Tests
// =============================================================================

describe("USER_ERROR_MESSAGES", () => {
  it("has all required error messages", () => {
    expect(USER_ERROR_MESSAGES.PROCESSING_ERROR).toBe(
      "Sorry, I encountered an error processing your request. Please try again.",
    );
    expect(USER_ERROR_MESSAGES.CONNECTION_ERROR).toBe(
      "I'm having trouble connecting right now. Please try again in a moment.",
    );
    expect(USER_ERROR_MESSAGES.RATE_LIMITED).toBe(
      "I'm receiving too many requests right now. Please wait a moment and try again.",
    );
    expect(USER_ERROR_MESSAGES.COMMAND_ERROR).toBe(
      "Sorry, I couldn't complete that command. Please try again.",
    );
    expect(USER_ERROR_MESSAGES.SESSION_ERROR).toBe(
      "I'm having trouble with your conversation session. Please try again.",
    );
    expect(USER_ERROR_MESSAGES.TIMEOUT_ERROR).toBe(
      "The request took too long to complete. Please try again.",
    );
    expect(USER_ERROR_MESSAGES.PERMISSION_ERROR).toBe(
      "I don't have permission to do that in this channel.",
    );
  });

  it("error messages are user-friendly (no stack traces)", () => {
    const messages = Object.values(USER_ERROR_MESSAGES);
    for (const message of messages) {
      // Messages should not contain programming artifacts
      expect(message).not.toMatch(/^Error:/);
      expect(message).not.toContain("at line");
      expect(message).not.toContain(".ts:");
      expect(message).not.toContain(".js:");
      expect(message).not.toMatch(/\bundefined\b/);
    }
  });
});

// =============================================================================
// classifyError Tests
// =============================================================================

describe("classifyError", () => {
  describe("Discord connector errors", () => {
    it("classifies rate limit errors as RATE_LIMIT", () => {
      const error = new DiscordConnectorError(
        "Rate limited",
        DiscordErrorCode.RATE_LIMITED,
        "test-agent",
      );

      const classified = classifyError(error);

      expect(classified.category).toBe(ErrorCategory.RATE_LIMIT);
      expect(classified.shouldRetry).toBe(true);
      expect(classified.userMessage).toBe(USER_ERROR_MESSAGES.RATE_LIMITED);
      expect(classified.retryDelayMs).toBeGreaterThan(0);
    });

    it("classifies connection errors as TRANSIENT", () => {
      const error = new DiscordConnectionError("test-agent", "Network failed");

      const classified = classifyError(error);

      expect(classified.category).toBe(ErrorCategory.TRANSIENT);
      expect(classified.shouldRetry).toBe(true);
      expect(classified.userMessage).toBe(USER_ERROR_MESSAGES.CONNECTION_ERROR);
    });

    it("classifies gateway errors as TRANSIENT", () => {
      const error = new DiscordConnectorError(
        "Gateway error",
        DiscordErrorCode.GATEWAY_ERROR,
        "test-agent",
      );

      const classified = classifyError(error);

      expect(classified.category).toBe(ErrorCategory.TRANSIENT);
      expect(classified.shouldRetry).toBe(true);
    });

    it("classifies invalid token errors as CONFIGURATION", () => {
      const error = new InvalidTokenError("test-agent", "Token expired");

      const classified = classifyError(error);

      expect(classified.category).toBe(ErrorCategory.CONFIGURATION);
      expect(classified.shouldRetry).toBe(false);
    });

    it("classifies already connected errors as PERMANENT", () => {
      const error = new AlreadyConnectedError("test-agent");

      const classified = classifyError(error);

      expect(classified.category).toBe(ErrorCategory.PERMANENT);
      expect(classified.shouldRetry).toBe(false);
    });
  });

  describe("Session manager errors", () => {
    it("classifies session errors as TRANSIENT", () => {
      const error = new SessionStateReadError("test-agent", "/path/to/state.json");

      const classified = classifyError(error);

      expect(classified.category).toBe(ErrorCategory.TRANSIENT);
      expect(classified.shouldRetry).toBe(true);
      expect(classified.userMessage).toBe(USER_ERROR_MESSAGES.SESSION_ERROR);
    });
  });

  describe("Network errors", () => {
    it("classifies ECONNRESET as TRANSIENT", () => {
      const error = new Error("read ECONNRESET");

      const classified = classifyError(error);

      expect(classified.category).toBe(ErrorCategory.TRANSIENT);
      expect(classified.shouldRetry).toBe(true);
      expect(classified.userMessage).toBe(USER_ERROR_MESSAGES.CONNECTION_ERROR);
    });

    it("classifies ECONNREFUSED as TRANSIENT", () => {
      const error = new Error("connect ECONNREFUSED");

      const classified = classifyError(error);

      expect(classified.category).toBe(ErrorCategory.TRANSIENT);
      expect(classified.shouldRetry).toBe(true);
    });

    it("classifies ETIMEDOUT as TRANSIENT", () => {
      const error = new Error("ETIMEDOUT");

      const classified = classifyError(error);

      expect(classified.category).toBe(ErrorCategory.TRANSIENT);
      expect(classified.shouldRetry).toBe(true);
    });

    it("classifies fetch failed as TRANSIENT", () => {
      const error = new Error("fetch failed");

      const classified = classifyError(error);

      expect(classified.category).toBe(ErrorCategory.TRANSIENT);
      expect(classified.shouldRetry).toBe(true);
    });

    it("classifies socket hang up as TRANSIENT", () => {
      const error = new Error("socket hang up");

      const classified = classifyError(error);

      expect(classified.category).toBe(ErrorCategory.TRANSIENT);
      expect(classified.shouldRetry).toBe(true);
    });
  });

  describe("Timeout errors", () => {
    it("classifies timeout errors as TRANSIENT", () => {
      const error = new Error("Request timed out");

      const classified = classifyError(error);

      expect(classified.category).toBe(ErrorCategory.TRANSIENT);
      expect(classified.shouldRetry).toBe(true);
      expect(classified.userMessage).toBe(USER_ERROR_MESSAGES.TIMEOUT_ERROR);
    });

    it("classifies AbortError as TRANSIENT", () => {
      const error = new Error("AbortError: signal timed out");
      error.name = "AbortError";

      const classified = classifyError(error);

      expect(classified.category).toBe(ErrorCategory.TRANSIENT);
      expect(classified.shouldRetry).toBe(true);
    });
  });

  describe("Unknown errors", () => {
    it("classifies unknown errors as UNKNOWN", () => {
      const error = new Error("Something unexpected happened");

      const classified = classifyError(error);

      expect(classified.category).toBe(ErrorCategory.UNKNOWN);
      expect(classified.shouldRetry).toBe(false);
      expect(classified.userMessage).toBe(USER_ERROR_MESSAGES.PROCESSING_ERROR);
    });

    it("handles non-Error values", () => {
      const classified = classifyError("string error");

      expect(classified.error).toBeInstanceOf(Error);
      expect(classified.error.message).toBe("string error");
      expect(classified.category).toBe(ErrorCategory.UNKNOWN);
    });

    it("handles null", () => {
      const classified = classifyError(null);

      expect(classified.error).toBeInstanceOf(Error);
      expect(classified.category).toBe(ErrorCategory.UNKNOWN);
    });

    it("handles undefined", () => {
      const classified = classifyError(undefined);

      expect(classified.error).toBeInstanceOf(Error);
      expect(classified.category).toBe(ErrorCategory.UNKNOWN);
    });
  });
});

// =============================================================================
// withRetry Tests
// =============================================================================

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns success on first attempt if operation succeeds", async () => {
    const operation = vi.fn().mockResolvedValue("success");

    const resultPromise = withRetry(operation);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.value).toBe("success");
    expect(result.attempts).toBe(1);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries transient errors", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValue("success");

    const resultPromise = withRetry(operation, { baseDelayMs: 100 });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.value).toBe("success");
    expect(result.attempts).toBe(2);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent errors", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("Invalid input"));

    const resultPromise = withRetry(operation, { maxAttempts: 3 });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe("Invalid input");
    expect(result.attempts).toBe(1);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("respects maxAttempts", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("ECONNRESET"));

    const resultPromise = withRetry(operation, {
      maxAttempts: 3,
      baseDelayMs: 100,
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("uses exponential backoff", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValue("success");

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const resultPromise = withRetry(operation, {
      baseDelayMs: 1000,
      backoffMultiplier: 2,
      logger,
    });

    // First retry after 1000ms
    await vi.advanceTimersByTimeAsync(1000);
    // Second retry after 2000ms (1000 * 2)
    await vi.advanceTimersByTimeAsync(2000);
    await vi.runAllTimersAsync();

    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
    expect(logger.info).toHaveBeenCalledTimes(2); // Two retry logs
  });

  it("respects maxDelayMs", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValue("success");

    const resultPromise = withRetry(operation, {
      baseDelayMs: 10000,
      maxDelayMs: 1000,
      backoffMultiplier: 10,
    });

    // Should use maxDelayMs (1000) not baseDelayMs (10000)
    await vi.advanceTimersByTimeAsync(1000);
    await vi.runAllTimersAsync();

    const result = await resultPromise;

    expect(result.success).toBe(true);
  });

  it("supports custom shouldRetry predicate", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("Custom retryable"))
      .mockResolvedValue("success");

    const resultPromise = withRetry(operation, {
      baseDelayMs: 100,
      shouldRetry: (error) => {
        return error instanceof Error && error.message.includes("retryable");
      },
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it("logs retry attempts when logger is provided", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValue("success");

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const resultPromise = withRetry(operation, {
      logger,
      operationName: "testOperation",
      baseDelayMs: 100,
    });
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("testOperation failed, retrying"),
      expect.any(Object),
    );
  });
});

// =============================================================================
// ErrorHandler Tests
// =============================================================================

describe("ErrorHandler", () => {
  const createMockLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });

  describe("handleError", () => {
    it("returns user-friendly message for Discord errors", () => {
      const logger = createMockLogger();
      const handler = new ErrorHandler({
        logger,
        agentName: "test-agent",
      });

      const error = new DiscordConnectionError("test-agent", "Network failed");
      const userMessage = handler.handleError(error, "connecting to Discord");

      expect(userMessage).toBe(USER_ERROR_MESSAGES.CONNECTION_ERROR);
    });

    it("returns user-friendly message for unknown errors", () => {
      const logger = createMockLogger();
      const handler = new ErrorHandler({
        logger,
        agentName: "test-agent",
      });

      const error = new Error("Something unexpected");
      const userMessage = handler.handleError(error, "processing request");

      expect(userMessage).toBe(USER_ERROR_MESSAGES.PROCESSING_ERROR);
    });

    it("logs detailed error information", () => {
      const logger = createMockLogger();
      const handler = new ErrorHandler({
        logger,
        agentName: "test-agent",
      });

      const error = new Error("Detailed error info");
      error.stack = "Error: Detailed error info\n    at test.ts:123";

      handler.handleError(error, "test operation");

      expect(logger.error).toHaveBeenCalledWith(
        "Error during test operation",
        expect.objectContaining({
          agentName: "test-agent",
          context: "test operation",
          errorMessage: "Detailed error info",
          errorName: "Error",
          stack: expect.stringContaining("Error: Detailed error info"),
        }),
      );
    });

    it("tracks error statistics", () => {
      const logger = createMockLogger();
      const handler = new ErrorHandler({
        logger,
        agentName: "test-agent",
      });

      handler.handleError(new Error("ECONNRESET"), "op1");
      handler.handleError(new Error("ECONNRESET"), "op2");
      handler.handleError(new InvalidTokenError("test-agent", "bad"), "op3");

      const stats = handler.getErrorStats();

      expect(stats.get(ErrorCategory.TRANSIENT)).toBe(2);
      expect(stats.get(ErrorCategory.CONFIGURATION)).toBe(1);
    });
  });

  describe("handleErrorWithMessage", () => {
    it("returns custom message", () => {
      const logger = createMockLogger();
      const handler = new ErrorHandler({
        logger,
        agentName: "test-agent",
      });

      const error = new Error("Internal error");
      const customMessage = "Custom user message";
      const userMessage = handler.handleErrorWithMessage(error, "test operation", customMessage);

      expect(userMessage).toBe(customMessage);
    });

    it("still logs detailed error info", () => {
      const logger = createMockLogger();
      const handler = new ErrorHandler({
        logger,
        agentName: "test-agent",
      });

      const error = new Error("Internal error");
      handler.handleErrorWithMessage(error, "test operation", "Custom message");

      expect(logger.error).toHaveBeenCalledWith(
        "Error during test operation",
        expect.objectContaining({
          errorMessage: "Internal error",
        }),
      );
    });
  });

  describe("isRetryable", () => {
    it("returns true for transient errors", () => {
      const logger = createMockLogger();
      const handler = new ErrorHandler({
        logger,
        agentName: "test-agent",
      });

      expect(handler.isRetryable(new Error("ECONNRESET"))).toBe(true);
      expect(handler.isRetryable(new Error("timeout"))).toBe(true);
    });

    it("returns false for permanent errors", () => {
      const logger = createMockLogger();
      const handler = new ErrorHandler({
        logger,
        agentName: "test-agent",
      });

      expect(handler.isRetryable(new Error("Unknown error"))).toBe(false);
      expect(handler.isRetryable(new InvalidTokenError("test", "bad"))).toBe(false);
    });
  });

  describe("getUserMessage", () => {
    it("returns appropriate message for error type", () => {
      const logger = createMockLogger();
      const handler = new ErrorHandler({
        logger,
        agentName: "test-agent",
      });

      expect(handler.getUserMessage(new DiscordConnectionError("test", "failed"))).toBe(
        USER_ERROR_MESSAGES.CONNECTION_ERROR,
      );
      expect(handler.getUserMessage(new Error("ECONNRESET"))).toBe(
        USER_ERROR_MESSAGES.CONNECTION_ERROR,
      );
      expect(handler.getUserMessage(new Error("timeout"))).toBe(USER_ERROR_MESSAGES.TIMEOUT_ERROR);
    });
  });

  describe("resetStats", () => {
    it("clears error statistics", () => {
      const logger = createMockLogger();
      const handler = new ErrorHandler({
        logger,
        agentName: "test-agent",
      });

      handler.handleError(new Error("ECONNRESET"), "op1");
      handler.handleError(new Error("ECONNRESET"), "op2");

      handler.resetStats();
      const stats = handler.getErrorStats();

      expect(stats.size).toBe(0);
    });
  });
});

// =============================================================================
// safeExecute Tests
// =============================================================================

describe("safeExecute", () => {
  it("returns result on success", async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const handler = new ErrorHandler({ logger, agentName: "test" });

    const result = await safeExecute(async () => "success", handler, "test operation");

    expect(result).toBe("success");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("returns undefined and logs error on failure", async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const handler = new ErrorHandler({ logger, agentName: "test" });

    const result = await safeExecute(
      async () => {
        throw new Error("Operation failed");
      },
      handler,
      "test operation",
    );

    expect(result).toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});

// =============================================================================
// safeExecuteWithReply Tests
// =============================================================================

describe("safeExecuteWithReply", () => {
  it("returns result on success", async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const handler = new ErrorHandler({ logger, agentName: "test" });

    const result = await safeExecuteWithReply(async () => "Hello, world!", handler, "greeting");

    expect(result).toBe("Hello, world!");
  });

  it("returns user-friendly error message on failure", async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const handler = new ErrorHandler({ logger, agentName: "test" });

    const result = await safeExecuteWithReply(
      async () => {
        throw new Error("ECONNRESET");
      },
      handler,
      "network operation",
    );

    expect(result).toBe(USER_ERROR_MESSAGES.CONNECTION_ERROR);
  });

  it("logs detailed error on failure", async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const handler = new ErrorHandler({ logger, agentName: "test" });

    await safeExecuteWithReply(
      async () => {
        throw new Error("Detailed error");
      },
      handler,
      "failed operation",
    );

    expect(logger.error).toHaveBeenCalledWith(
      "Error during failed operation",
      expect.objectContaining({
        errorMessage: "Detailed error",
      }),
    );
  });
});

// =============================================================================
// ErrorCategory Tests
// =============================================================================

describe("ErrorCategory", () => {
  it("has all expected categories", () => {
    expect(ErrorCategory.TRANSIENT).toBe("transient");
    expect(ErrorCategory.PERMANENT).toBe("permanent");
    expect(ErrorCategory.RATE_LIMIT).toBe("rate_limit");
    expect(ErrorCategory.CONFIGURATION).toBe("configuration");
    expect(ErrorCategory.UNKNOWN).toBe("unknown");
  });
});
