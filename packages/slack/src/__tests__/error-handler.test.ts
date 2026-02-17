import { describe, it, expect, vi } from "vitest";
import {
  ErrorCategory,
  USER_ERROR_MESSAGES,
  classifyError,
  safeExecute,
  safeExecuteWithReply,
} from "../error-handler.js";

const createMockLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe("ErrorCategory", () => {
  it("has all expected categories", () => {
    expect(ErrorCategory.AUTH).toBe("auth");
    expect(ErrorCategory.RATE_LIMIT).toBe("rate_limit");
    expect(ErrorCategory.NETWORK).toBe("network");
    expect(ErrorCategory.API).toBe("api");
    expect(ErrorCategory.INTERNAL).toBe("internal");
    expect(ErrorCategory.UNKNOWN).toBe("unknown");
  });
});

describe("USER_ERROR_MESSAGES", () => {
  it("has messages for common error cases", () => {
    expect(USER_ERROR_MESSAGES.AUTH_ERROR).toBeDefined();
    expect(USER_ERROR_MESSAGES.RATE_LIMITED).toBeDefined();
    expect(USER_ERROR_MESSAGES.CONNECTION_ERROR).toBeDefined();
    expect(USER_ERROR_MESSAGES.API_ERROR).toBeDefined();
    expect(USER_ERROR_MESSAGES.INTERNAL_ERROR).toBeDefined();
    expect(USER_ERROR_MESSAGES.UNKNOWN_ERROR).toBeDefined();
  });

  it("error messages are user-friendly", () => {
    const messages = Object.values(USER_ERROR_MESSAGES);
    for (const message of messages) {
      expect(message).not.toMatch(/^Error:/);
      expect(message).not.toContain(".ts:");
      expect(message).not.toContain(".js:");
    }
  });
});

describe("classifyError", () => {
  it("classifies auth errors", () => {
    const result = classifyError(new Error("invalid_auth"));

    expect(result.category).toBe(ErrorCategory.AUTH);
    expect(result.shouldRetry).toBe(false);
    expect(result.userMessage).toBe(USER_ERROR_MESSAGES.AUTH_ERROR);
  });

  it("classifies token_expired as auth", () => {
    const result = classifyError(new Error("token_expired"));

    expect(result.category).toBe(ErrorCategory.AUTH);
    expect(result.shouldRetry).toBe(false);
  });

  it("classifies token_revoked as auth", () => {
    const result = classifyError(new Error("token_revoked"));

    expect(result.category).toBe(ErrorCategory.AUTH);
    expect(result.shouldRetry).toBe(false);
  });

  it("classifies not_authed as auth", () => {
    const result = classifyError(new Error("not_authed"));

    expect(result.category).toBe(ErrorCategory.AUTH);
    expect(result.shouldRetry).toBe(false);
  });

  it("does not classify unrelated 'token' substring as auth", () => {
    const result = classifyError(
      new Error("invalid JSON token at position 42")
    );

    expect(result.category).not.toBe(ErrorCategory.AUTH);
  });

  it("classifies rate limit errors", () => {
    const result = classifyError(new Error("rate_limited"));

    expect(result.category).toBe(ErrorCategory.RATE_LIMIT);
    expect(result.shouldRetry).toBe(true);
    expect(result.userMessage).toBe(USER_ERROR_MESSAGES.RATE_LIMITED);
  });

  it("classifies ratelimited errors", () => {
    const result = classifyError(new Error("ratelimited"));

    expect(result.category).toBe(ErrorCategory.RATE_LIMIT);
    expect(result.shouldRetry).toBe(true);
  });

  it("classifies network errors (ECONNREFUSED)", () => {
    const result = classifyError(new Error("connect ECONNREFUSED"));

    expect(result.category).toBe(ErrorCategory.NETWORK);
    expect(result.shouldRetry).toBe(true);
    expect(result.userMessage).toBe(USER_ERROR_MESSAGES.CONNECTION_ERROR);
  });

  it("classifies network errors (ENOTFOUND)", () => {
    const result = classifyError(new Error("getaddrinfo ENOTFOUND"));

    expect(result.category).toBe(ErrorCategory.NETWORK);
    expect(result.shouldRetry).toBe(true);
  });

  it("classifies timeout errors", () => {
    const result = classifyError(new Error("Request timeout"));

    expect(result.category).toBe(ErrorCategory.NETWORK);
    expect(result.shouldRetry).toBe(true);
  });

  it("classifies Slack API errors", () => {
    const result = classifyError(new Error("Slack API returned error"));

    expect(result.category).toBe(ErrorCategory.API);
    expect(result.shouldRetry).toBe(true);
    expect(result.userMessage).toBe(USER_ERROR_MESSAGES.API_ERROR);
  });

  it("classifies unknown errors", () => {
    const result = classifyError(new Error("Something unexpected"));

    expect(result.category).toBe(ErrorCategory.UNKNOWN);
    expect(result.shouldRetry).toBe(false);
    expect(result.userMessage).toBe(USER_ERROR_MESSAGES.UNKNOWN_ERROR);
  });

  it("preserves original error", () => {
    const error = new Error("test error");
    const result = classifyError(error);

    expect(result.error).toBe(error);
  });
});

describe("safeExecute", () => {
  it("returns result on success", async () => {
    const logger = createMockLogger();
    const result = await safeExecute(
      async () => "success",
      logger,
      "test operation"
    );

    expect(result).toBe("success");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("returns undefined and logs error on failure", async () => {
    const logger = createMockLogger();
    const result = await safeExecute(
      async () => {
        throw new Error("Operation failed");
      },
      logger,
      "test operation"
    );

    expect(result).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "Error in test operation: Operation failed"
    );
  });

  it("handles non-Error throws", async () => {
    const logger = createMockLogger();
    const result = await safeExecute(
      async () => {
        throw "string error";
      },
      logger,
      "test"
    );

    expect(result).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "Error in test: string error"
    );
  });
});

describe("safeExecuteWithReply", () => {
  it("executes function on success", async () => {
    const logger = createMockLogger();
    const reply = vi.fn();
    const fn = vi.fn().mockResolvedValue(undefined);

    await safeExecuteWithReply(fn, reply, logger, "test");

    expect(fn).toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it("sends error reply on failure", async () => {
    const logger = createMockLogger();
    const reply = vi.fn();

    await safeExecuteWithReply(
      async () => {
        throw new Error("connect ECONNREFUSED");
      },
      reply,
      logger,
      "test"
    );

    expect(reply).toHaveBeenCalledWith(USER_ERROR_MESSAGES.CONNECTION_ERROR);
    expect(logger.error).toHaveBeenCalled();
  });

  it("handles reply failure gracefully", async () => {
    const logger = createMockLogger();
    const reply = vi.fn().mockRejectedValue(new Error("Reply failed"));

    await safeExecuteWithReply(
      async () => {
        throw new Error("Original error");
      },
      reply,
      logger,
      "test"
    );

    // Should log both errors
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it("handles non-Error throws", async () => {
    const logger = createMockLogger();
    const reply = vi.fn();

    await safeExecuteWithReply(
      async () => {
        throw "string error";
      },
      reply,
      logger,
      "test"
    );

    expect(reply).toHaveBeenCalled();
  });
});
