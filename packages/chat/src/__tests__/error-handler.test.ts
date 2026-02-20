/**
 * Tests for error handler utilities
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ErrorCategory,
  isAuthError,
  isRateLimitError,
  isTransientError,
  safeExecute,
  safeExecuteWithReply,
  USER_ERROR_MESSAGES,
  withRetry,
} from "../error-handler.js";
import type { ChatConnectorLogger } from "../types.js";

describe("error-handler", () => {
  let mockLogger: ChatConnectorLogger;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  describe("ErrorCategory", () => {
    it("has expected categories", () => {
      expect(ErrorCategory.TRANSIENT).toBe("transient");
      expect(ErrorCategory.PERMANENT).toBe("permanent");
      expect(ErrorCategory.RATE_LIMIT).toBe("rate_limit");
      expect(ErrorCategory.CONFIGURATION).toBe("configuration");
      expect(ErrorCategory.AUTH).toBe("auth");
      expect(ErrorCategory.NETWORK).toBe("network");
      expect(ErrorCategory.API).toBe("api");
      expect(ErrorCategory.INTERNAL).toBe("internal");
      expect(ErrorCategory.UNKNOWN).toBe("unknown");
    });
  });

  describe("USER_ERROR_MESSAGES", () => {
    it("has all expected message keys", () => {
      expect(USER_ERROR_MESSAGES.PROCESSING_ERROR).toBeDefined();
      expect(USER_ERROR_MESSAGES.CONNECTION_ERROR).toBeDefined();
      expect(USER_ERROR_MESSAGES.RATE_LIMITED).toBeDefined();
      expect(USER_ERROR_MESSAGES.COMMAND_ERROR).toBeDefined();
      expect(USER_ERROR_MESSAGES.SESSION_ERROR).toBeDefined();
      expect(USER_ERROR_MESSAGES.TIMEOUT_ERROR).toBeDefined();
      expect(USER_ERROR_MESSAGES.PERMISSION_ERROR).toBeDefined();
      expect(USER_ERROR_MESSAGES.AUTH_ERROR).toBeDefined();
      expect(USER_ERROR_MESSAGES.API_ERROR).toBeDefined();
      expect(USER_ERROR_MESSAGES.INTERNAL_ERROR).toBeDefined();
      expect(USER_ERROR_MESSAGES.UNKNOWN_ERROR).toBeDefined();
    });

    it("messages are user-friendly (no technical jargon)", () => {
      for (const message of Object.values(USER_ERROR_MESSAGES)) {
        expect(message).not.toContain("exception");
        expect(message).not.toContain("null");
        expect(message).not.toContain("undefined");
      }
    });
  });

  describe("isTransientError", () => {
    it("returns true for network errors", () => {
      expect(isTransientError(new Error("ECONNRESET"))).toBe(true);
      expect(isTransientError(new Error("ECONNREFUSED"))).toBe(true);
      expect(isTransientError(new Error("ETIMEDOUT"))).toBe(true);
      expect(isTransientError(new Error("ENOTFOUND"))).toBe(true);
      expect(isTransientError(new Error("socket hang up"))).toBe(true);
      expect(isTransientError(new Error("fetch failed"))).toBe(true);
    });

    it("returns true for timeout errors", () => {
      expect(isTransientError(new Error("Request timeout"))).toBe(true);
      expect(isTransientError(new Error("Operation timed out"))).toBe(true);
    });

    it("returns false for non-transient errors", () => {
      expect(isTransientError(new Error("Invalid token"))).toBe(false);
      expect(isTransientError(new Error("Permission denied"))).toBe(false);
    });

    it("returns false for non-Error values", () => {
      expect(isTransientError("string error")).toBe(false);
      expect(isTransientError(null)).toBe(false);
      expect(isTransientError(undefined)).toBe(false);
    });
  });

  describe("isRateLimitError", () => {
    it("returns true for rate limit errors", () => {
      expect(isRateLimitError(new Error("rate_limit exceeded"))).toBe(true);
      expect(isRateLimitError(new Error("You are ratelimited"))).toBe(true);
    });

    it("returns false for non-rate-limit errors", () => {
      expect(isRateLimitError(new Error("Connection failed"))).toBe(false);
    });

    it("returns false for non-Error values", () => {
      expect(isRateLimitError("rate_limit")).toBe(false);
    });
  });

  describe("isAuthError", () => {
    it("returns true for auth errors", () => {
      expect(isAuthError(new Error("invalid_auth"))).toBe(true);
      expect(isAuthError(new Error("token_revoked"))).toBe(true);
      expect(isAuthError(new Error("token_expired"))).toBe(true);
      expect(isAuthError(new Error("not_authed"))).toBe(true);
      expect(isAuthError(new Error("Unauthorized access"))).toBe(true);
      expect(isAuthError(new Error("Forbidden"))).toBe(true);
    });

    it("returns false for non-auth errors", () => {
      expect(isAuthError(new Error("Connection failed"))).toBe(false);
    });
  });

  describe("withRetry", () => {
    it("returns success on first attempt", async () => {
      const operation = vi.fn().mockResolvedValue("result");

      const result = await withRetry(operation);

      expect(result.success).toBe(true);
      expect(result.value).toBe("result");
      expect(result.attempts).toBe(1);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("retries on transient error", async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValue("result");

      const result = await withRetry(operation, {
        maxAttempts: 3,
        baseDelayMs: 1,
      });

      expect(result.success).toBe(true);
      expect(result.value).toBe("result");
      expect(result.attempts).toBe(2);
    });

    it("stops after maxAttempts", async () => {
      const operation = vi.fn().mockRejectedValue(new Error("ECONNRESET"));

      const result = await withRetry(operation, {
        maxAttempts: 3,
        baseDelayMs: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe("ECONNRESET");
      expect(result.attempts).toBe(3);
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it("does not retry non-transient errors", async () => {
      const operation = vi.fn().mockRejectedValue(new Error("Invalid token"));

      const result = await withRetry(operation, {
        maxAttempts: 3,
        baseDelayMs: 1,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("uses custom shouldRetry predicate", async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error("Custom error"))
        .mockResolvedValue("result");

      const result = await withRetry(operation, {
        maxAttempts: 3,
        baseDelayMs: 1,
        shouldRetry: (error) => (error as Error).message === "Custom error",
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it("logs retry attempts when logger provided", async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValue("result");

      await withRetry(operation, {
        maxAttempts: 3,
        baseDelayMs: 1,
        logger: mockLogger,
        operationName: "testOp",
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("testOp failed, retrying"),
        expect.any(Object),
      );
    });

    it("respects exponential backoff", async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValue("result");

      const startTime = Date.now();
      await withRetry(operation, {
        maxAttempts: 3,
        baseDelayMs: 10,
        backoffMultiplier: 2,
      });
      const elapsed = Date.now() - startTime;

      // First retry: 10ms, second retry: 20ms, total: 30ms minimum
      expect(elapsed).toBeGreaterThanOrEqual(25);
    });
  });

  describe("safeExecute", () => {
    it("returns result on success", async () => {
      const result = await safeExecute(
        () => Promise.resolve("success"),
        mockLogger,
        "test operation",
      );

      expect(result).toBe("success");
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it("returns undefined on error", async () => {
      const result = await safeExecute(
        () => Promise.reject(new Error("Failed")),
        mockLogger,
        "test operation",
      );

      expect(result).toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("test operation"));
    });

    it("logs error message", async () => {
      await safeExecute(
        () => Promise.reject(new Error("Specific error")),
        mockLogger,
        "my operation",
      );

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("Specific error"));
    });
  });

  describe("safeExecuteWithReply", () => {
    let mockReply: ReturnType<typeof vi.fn<(content: string) => Promise<void>>>;

    beforeEach(() => {
      mockReply = vi.fn<(content: string) => Promise<void>>().mockResolvedValue(undefined);
    });

    it("executes operation successfully", async () => {
      const operation = vi.fn().mockResolvedValue(undefined);

      await safeExecuteWithReply(operation, mockReply, mockLogger, "test");

      expect(operation).toHaveBeenCalled();
      expect(mockReply).not.toHaveBeenCalled();
    });

    it("sends error reply on failure", async () => {
      const operation = vi.fn().mockRejectedValue(new Error("Failed"));

      await safeExecuteWithReply(operation, mockReply, mockLogger, "test");

      expect(mockReply).toHaveBeenCalledWith(USER_ERROR_MESSAGES.PROCESSING_ERROR);
    });

    it("uses custom error message", async () => {
      const operation = vi.fn().mockRejectedValue(new Error("Failed"));

      await safeExecuteWithReply(operation, mockReply, mockLogger, "test", "Custom error message");

      expect(mockReply).toHaveBeenCalledWith("Custom error message");
    });

    it("logs error on failure", async () => {
      const operation = vi.fn().mockRejectedValue(new Error("Specific error"));

      await safeExecuteWithReply(operation, mockReply, mockLogger, "test op");

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("test op"));
    });

    it("logs when reply fails", async () => {
      const operation = vi.fn().mockRejectedValue(new Error("Failed"));
      mockReply.mockRejectedValue(new Error("Reply failed"));

      await safeExecuteWithReply(operation, mockReply, mockLogger, "test");

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("Reply failed"));
    });
  });
});
