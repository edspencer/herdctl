import { describe, expect, it } from "vitest";
import {
  buildErrorMessage,
  classifyError,
  MalformedResponseError,
  RunnerError,
  SDKInitializationError,
  SDKStreamingError,
  wrapError,
} from "../errors.js";

// =============================================================================
// RunnerError tests
// =============================================================================

describe("RunnerError", () => {
  it("creates error with message only", () => {
    const error = new RunnerError("Something went wrong");

    expect(error.message).toBe("Something went wrong");
    expect(error.name).toBe("RunnerError");
    expect(error.jobId).toBeUndefined();
    expect(error.agentName).toBeUndefined();
  });

  it("creates error with job ID and agent name", () => {
    const error = new RunnerError("Something went wrong", {
      jobId: "job-2024-01-15-abc123",
      agentName: "test-agent",
    });

    expect(error.jobId).toBe("job-2024-01-15-abc123");
    expect(error.agentName).toBe("test-agent");
  });

  it("preserves cause error", () => {
    const cause = new Error("Original error");
    const error = new RunnerError("Wrapped error", { cause });

    expect(error.cause).toBe(cause);
  });
});

// =============================================================================
// SDKInitializationError tests
// =============================================================================

describe("SDKInitializationError", () => {
  it("creates initialization error with context", () => {
    const error = new SDKInitializationError("API key not found", {
      jobId: "job-123",
      agentName: "my-agent",
    });

    expect(error.name).toBe("SDKInitializationError");
    expect(error.message).toBe("API key not found");
    expect(error.jobId).toBe("job-123");
    expect(error.agentName).toBe("my-agent");
  });

  it("extracts code from cause error", () => {
    const cause = new Error("Connection failed") as NodeJS.ErrnoException;
    cause.code = "ECONNREFUSED";

    const error = new SDKInitializationError("Failed to initialize", { cause });

    expect(error.code).toBe("ECONNREFUSED");
  });

  it("uses provided code over cause code", () => {
    const cause = new Error("Error") as NodeJS.ErrnoException;
    cause.code = "ORIGINAL_CODE";

    const error = new SDKInitializationError("Failed", {
      cause,
      code: "CUSTOM_CODE",
    });

    expect(error.code).toBe("CUSTOM_CODE");
  });

  describe("isMissingApiKey", () => {
    it("returns true for API key errors", () => {
      expect(new SDKInitializationError("Missing API key").isMissingApiKey()).toBe(true);
      expect(new SDKInitializationError("ANTHROPIC_API_KEY not set").isMissingApiKey()).toBe(true);
      expect(new SDKInitializationError("Authentication failed").isMissingApiKey()).toBe(true);
      expect(new SDKInitializationError("Unauthorized request").isMissingApiKey()).toBe(true);
    });

    it("returns true for ENOKEY code", () => {
      const error = new SDKInitializationError("Error", { code: "ENOKEY" });
      expect(error.isMissingApiKey()).toBe(true);
    });

    it("returns false for other errors", () => {
      expect(new SDKInitializationError("Network timeout").isMissingApiKey()).toBe(false);
    });
  });

  describe("isNetworkError", () => {
    it("returns true for network error codes", () => {
      expect(new SDKInitializationError("Failed", { code: "ECONNREFUSED" }).isNetworkError()).toBe(
        true,
      );
      expect(new SDKInitializationError("Failed", { code: "ENOTFOUND" }).isNetworkError()).toBe(
        true,
      );
      expect(new SDKInitializationError("Failed", { code: "ETIMEDOUT" }).isNetworkError()).toBe(
        true,
      );
      expect(new SDKInitializationError("Failed", { code: "ECONNRESET" }).isNetworkError()).toBe(
        true,
      );
    });

    it("returns false for other codes", () => {
      expect(new SDKInitializationError("Failed", { code: "ENOENT" }).isNetworkError()).toBe(false);
    });
  });
});

// =============================================================================
// SDKStreamingError tests
// =============================================================================

describe("SDKStreamingError", () => {
  it("creates streaming error with context", () => {
    const error = new SDKStreamingError("Stream interrupted", {
      jobId: "job-456",
      agentName: "streaming-agent",
      messagesReceived: 42,
    });

    expect(error.name).toBe("SDKStreamingError");
    expect(error.messagesReceived).toBe(42);
  });

  describe("isRateLimited", () => {
    it("returns true for rate limit errors", () => {
      expect(new SDKStreamingError("Rate limit exceeded").isRateLimited()).toBe(true);
      expect(new SDKStreamingError("Too many requests").isRateLimited()).toBe(true);
      expect(new SDKStreamingError("Error", { code: "ERATELIMIT" }).isRateLimited()).toBe(true);
      expect(new SDKStreamingError("Error", { code: "429" }).isRateLimited()).toBe(true);
    });

    it("returns false for other errors", () => {
      expect(new SDKStreamingError("Connection failed").isRateLimited()).toBe(false);
    });
  });

  describe("isConnectionError", () => {
    it("returns true for connection error codes", () => {
      expect(new SDKStreamingError("Error", { code: "ECONNREFUSED" }).isConnectionError()).toBe(
        true,
      );
      expect(new SDKStreamingError("Error", { code: "ECONNRESET" }).isConnectionError()).toBe(true);
      expect(new SDKStreamingError("Error", { code: "EPIPE" }).isConnectionError()).toBe(true);
      expect(new SDKStreamingError("Error", { code: "ETIMEDOUT" }).isConnectionError()).toBe(true);
    });
  });

  describe("isRecoverable", () => {
    it("returns true for recoverable errors", () => {
      expect(new SDKStreamingError("Rate limited", { code: "429" }).isRecoverable()).toBe(true);
      expect(
        new SDKStreamingError("Connection reset", { code: "ECONNRESET" }).isRecoverable(),
      ).toBe(true);
    });

    it("returns false for non-recoverable errors", () => {
      expect(new SDKStreamingError("Invalid request").isRecoverable()).toBe(false);
    });
  });
});

// =============================================================================
// MalformedResponseError tests
// =============================================================================

describe("MalformedResponseError", () => {
  it("creates error with raw response", () => {
    const rawResponse = { invalid: "structure" };
    const error = new MalformedResponseError("Invalid message format", {
      rawResponse,
      expected: "SDKMessage with type field",
    });

    expect(error.name).toBe("MalformedResponseError");
    expect(error.rawResponse).toEqual(rawResponse);
    expect(error.expected).toBe("SDKMessage with type field");
  });
});

// =============================================================================
// buildErrorMessage tests
// =============================================================================

describe("buildErrorMessage", () => {
  it("returns base message when no context", () => {
    expect(buildErrorMessage("Error occurred")).toBe("Error occurred");
  });

  it("includes agent name in message", () => {
    expect(buildErrorMessage("Error occurred", { agentName: "my-agent" })).toBe(
      "Error occurred | Agent: my-agent",
    );
  });

  it("includes job ID in message", () => {
    expect(buildErrorMessage("Error occurred", { jobId: "job-123" })).toBe(
      "Error occurred | Job: job-123",
    );
  });

  it("includes both agent name and job ID", () => {
    expect(
      buildErrorMessage("Error occurred", {
        agentName: "my-agent",
        jobId: "job-123",
      }),
    ).toBe("Error occurred | Agent: my-agent | Job: job-123");
  });
});

// =============================================================================
// classifyError tests
// =============================================================================

describe("classifyError", () => {
  it("classifies timeout errors", () => {
    expect(classifyError(new Error("Request timeout"))).toBe("timeout");
    expect(classifyError(new Error("Operation timed out"))).toBe("timeout");

    const timeoutError = new Error("Error") as NodeJS.ErrnoException;
    timeoutError.code = "ETIMEDOUT";
    expect(classifyError(timeoutError)).toBe("timeout");
  });

  it("classifies cancelled errors", () => {
    expect(classifyError(new Error("Request aborted"))).toBe("cancelled");
    expect(classifyError(new Error("Operation cancelled"))).toBe("cancelled");

    const abortError = new Error("Aborted");
    abortError.name = "AbortError";
    expect(classifyError(abortError)).toBe("cancelled");
  });

  it("classifies max turns errors", () => {
    expect(classifyError(new Error("Max turns reached"))).toBe("max_turns");
    expect(classifyError(new Error("Exceeded max_turns limit"))).toBe("max_turns");
    expect(classifyError(new Error("Turn limit exceeded"))).toBe("max_turns");
  });

  it("classifies other errors as generic error", () => {
    expect(classifyError(new Error("Something went wrong"))).toBe("error");
    expect(classifyError(new Error("Unknown failure"))).toBe("error");
  });
});

// =============================================================================
// wrapError tests
// =============================================================================

describe("wrapError", () => {
  it("returns RunnerError as-is", () => {
    const runnerError = new RunnerError("Already wrapped");
    const result = wrapError(runnerError, {
      jobId: "job-123",
      agentName: "agent",
    });

    expect(result).toBe(runnerError);
  });

  it("wraps regular Error as SDKStreamingError by default", () => {
    const error = new Error("Something failed");
    const result = wrapError(error, {
      jobId: "job-123",
      agentName: "agent",
      phase: "streaming",
    });

    expect(result).toBeInstanceOf(SDKStreamingError);
    expect(result.jobId).toBe("job-123");
    expect(result.agentName).toBe("agent");
  });

  it("wraps init phase errors as SDKInitializationError", () => {
    const error = new Error("Initialization failed");
    const result = wrapError(error, {
      jobId: "job-123",
      agentName: "agent",
      phase: "init",
    });

    expect(result).toBeInstanceOf(SDKInitializationError);
  });

  it("wraps malformed response errors as MalformedResponseError", () => {
    const error = new Error("Unexpected response format");
    const result = wrapError(error, {
      jobId: "job-123",
      agentName: "agent",
    });

    expect(result).toBeInstanceOf(MalformedResponseError);
  });

  it("wraps invalid JSON errors as MalformedResponseError", () => {
    const error = new Error("Invalid JSON in response");
    const result = wrapError(error, {
      jobId: "job-123",
      agentName: "agent",
    });

    expect(result).toBeInstanceOf(MalformedResponseError);
  });

  it("wraps parse errors as MalformedResponseError", () => {
    const error = new Error("Parse error: unexpected token");
    const result = wrapError(error, {
      jobId: "job-123",
      agentName: "agent",
    });

    expect(result).toBeInstanceOf(MalformedResponseError);
  });

  it("converts non-Error values to SDKStreamingError", () => {
    const result = wrapError("string error", {
      jobId: "job-123",
      agentName: "agent",
    });

    expect(result).toBeInstanceOf(SDKStreamingError);
    expect(result.message).toContain("string error");
  });

  it("includes context in wrapped error message", () => {
    const error = new Error("Original message");
    const result = wrapError(error, {
      jobId: "job-123",
      agentName: "my-agent",
    });

    expect(result.message).toContain("Original message");
    expect(result.message).toContain("my-agent");
    expect(result.message).toContain("job-123");
  });
});
