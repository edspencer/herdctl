import { describe, it, expect } from "vitest";
import {
  SessionErrorCode,
  SessionManagerError,
  SessionStateReadError,
  SessionStateWriteError,
  SessionDirectoryCreateError,
  isSessionManagerError,
} from "../errors.js";

// =============================================================================
// SessionManagerError Tests
// =============================================================================

describe("SessionManagerError", () => {
  it("creates error with correct properties", () => {
    const error = new SessionManagerError(
      "Test error message",
      SessionErrorCode.STATE_READ_FAILED,
      "test-agent"
    );

    expect(error.message).toBe("Test error message");
    expect(error.code).toBe(SessionErrorCode.STATE_READ_FAILED);
    expect(error.agentName).toBe("test-agent");
    expect(error.name).toBe("SessionManagerError");
  });

  it("accepts cause option", () => {
    const cause = new Error("Original error");
    const error = new SessionManagerError(
      "Wrapper error",
      SessionErrorCode.STATE_WRITE_FAILED,
      "test-agent",
      { cause }
    );

    expect(error.cause).toBe(cause);
  });
});

// =============================================================================
// SessionStateReadError Tests
// =============================================================================

describe("SessionStateReadError", () => {
  it("creates error with correct message and properties", () => {
    const error = new SessionStateReadError(
      "my-agent",
      "/path/to/state.yaml"
    );

    expect(error.message).toBe(
      "Failed to read session state for agent 'my-agent' from '/path/to/state.yaml'"
    );
    expect(error.code).toBe(SessionErrorCode.STATE_READ_FAILED);
    expect(error.agentName).toBe("my-agent");
    expect(error.path).toBe("/path/to/state.yaml");
    expect(error.name).toBe("SessionStateReadError");
  });

  it("accepts cause option", () => {
    const cause = new Error("ENOENT");
    const error = new SessionStateReadError(
      "my-agent",
      "/path/to/state.yaml",
      { cause }
    );

    expect(error.cause).toBe(cause);
  });
});

// =============================================================================
// SessionStateWriteError Tests
// =============================================================================

describe("SessionStateWriteError", () => {
  it("creates error with correct message and properties", () => {
    const error = new SessionStateWriteError(
      "my-agent",
      "/path/to/state.yaml"
    );

    expect(error.message).toBe(
      "Failed to write session state for agent 'my-agent' to '/path/to/state.yaml'"
    );
    expect(error.code).toBe(SessionErrorCode.STATE_WRITE_FAILED);
    expect(error.agentName).toBe("my-agent");
    expect(error.path).toBe("/path/to/state.yaml");
    expect(error.name).toBe("SessionStateWriteError");
  });

  it("accepts cause option", () => {
    const cause = new Error("EACCES");
    const error = new SessionStateWriteError(
      "my-agent",
      "/path/to/state.yaml",
      { cause }
    );

    expect(error.cause).toBe(cause);
  });
});

// =============================================================================
// SessionDirectoryCreateError Tests
// =============================================================================

describe("SessionDirectoryCreateError", () => {
  it("creates error with correct message and properties", () => {
    const error = new SessionDirectoryCreateError(
      "my-agent",
      "/path/to/sessions"
    );

    expect(error.message).toBe(
      "Failed to create session directory for agent 'my-agent' at '/path/to/sessions'"
    );
    expect(error.code).toBe(SessionErrorCode.DIRECTORY_CREATE_FAILED);
    expect(error.agentName).toBe("my-agent");
    expect(error.path).toBe("/path/to/sessions");
    expect(error.name).toBe("SessionDirectoryCreateError");
  });

  it("accepts cause option", () => {
    const cause = new Error("EPERM");
    const error = new SessionDirectoryCreateError(
      "my-agent",
      "/path/to/sessions",
      { cause }
    );

    expect(error.cause).toBe(cause);
  });
});

// =============================================================================
// isSessionManagerError Tests
// =============================================================================

describe("isSessionManagerError", () => {
  it("returns true for SessionManagerError", () => {
    const error = new SessionManagerError(
      "Test",
      SessionErrorCode.STATE_READ_FAILED,
      "agent"
    );

    expect(isSessionManagerError(error)).toBe(true);
  });

  it("returns true for SessionStateReadError", () => {
    const error = new SessionStateReadError("agent", "/path");

    expect(isSessionManagerError(error)).toBe(true);
  });

  it("returns true for SessionStateWriteError", () => {
    const error = new SessionStateWriteError("agent", "/path");

    expect(isSessionManagerError(error)).toBe(true);
  });

  it("returns true for SessionDirectoryCreateError", () => {
    const error = new SessionDirectoryCreateError("agent", "/path");

    expect(isSessionManagerError(error)).toBe(true);
  });

  it("returns false for regular Error", () => {
    const error = new Error("Not a session error");

    expect(isSessionManagerError(error)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isSessionManagerError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isSessionManagerError(undefined)).toBe(false);
  });

  it("returns false for string", () => {
    expect(isSessionManagerError("error")).toBe(false);
  });

  it("returns false for object", () => {
    expect(isSessionManagerError({ message: "error" })).toBe(false);
  });
});

// =============================================================================
// Error Code Tests
// =============================================================================

describe("SessionErrorCode", () => {
  it("has all expected error codes", () => {
    expect(SessionErrorCode.STATE_READ_FAILED).toBe("SESSION_STATE_READ_FAILED");
    expect(SessionErrorCode.STATE_WRITE_FAILED).toBe("SESSION_STATE_WRITE_FAILED");
    expect(SessionErrorCode.DIRECTORY_CREATE_FAILED).toBe(
      "SESSION_DIRECTORY_CREATE_FAILED"
    );
    expect(SessionErrorCode.SESSION_NOT_FOUND).toBe("SESSION_NOT_FOUND");
    expect(SessionErrorCode.SESSION_EXPIRED).toBe("SESSION_EXPIRED");
    expect(SessionErrorCode.INVALID_STATE).toBe("SESSION_INVALID_STATE");
  });
});
