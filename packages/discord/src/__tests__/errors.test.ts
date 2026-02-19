import { describe, it, expect } from "vitest";
import {
  DiscordErrorCode,
  DiscordConnectorError,
  DiscordConnectionError,
  AlreadyConnectedError,
  InvalidTokenError,
  MissingTokenError,
  isDiscordConnectorError,
} from "../errors.js";

// =============================================================================
// DiscordConnectorError Tests
// =============================================================================

describe("DiscordConnectorError", () => {
  it("creates error with correct properties", () => {
    const error = new DiscordConnectorError(
      "Test error message",
      DiscordErrorCode.CONNECTION_FAILED,
      "test-agent",
    );

    expect(error.message).toBe("Test error message");
    expect(error.code).toBe(DiscordErrorCode.CONNECTION_FAILED);
    expect(error.agentName).toBe("test-agent");
    expect(error.name).toBe("DiscordConnectorError");
  });

  it("extends Error", () => {
    const error = new DiscordConnectorError(
      "Test error",
      DiscordErrorCode.CONNECTION_FAILED,
      "test-agent",
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DiscordConnectorError);
  });

  it("preserves cause when provided", () => {
    const cause = new Error("Original error");
    const error = new DiscordConnectorError(
      "Wrapped error",
      DiscordErrorCode.CONNECTION_FAILED,
      "test-agent",
      { cause },
    );

    expect(error.cause).toBe(cause);
  });
});

// =============================================================================
// DiscordConnectionError Tests
// =============================================================================

describe("DiscordConnectionError", () => {
  it("creates error with formatted message", () => {
    const error = new DiscordConnectionError("test-agent", "Network timeout");

    expect(error.message).toBe("Discord connection failed for agent 'test-agent': Network timeout");
    expect(error.code).toBe(DiscordErrorCode.CONNECTION_FAILED);
    expect(error.agentName).toBe("test-agent");
    expect(error.name).toBe("DiscordConnectionError");
  });

  it("extends DiscordConnectorError", () => {
    const error = new DiscordConnectionError("test-agent", "Test");

    expect(error).toBeInstanceOf(DiscordConnectorError);
    expect(error).toBeInstanceOf(Error);
  });

  it("preserves cause when provided", () => {
    const cause = new Error("Socket error");
    const error = new DiscordConnectionError("test-agent", "Connection lost", {
      cause,
    });

    expect(error.cause).toBe(cause);
  });
});

// =============================================================================
// AlreadyConnectedError Tests
// =============================================================================

describe("AlreadyConnectedError", () => {
  it("creates error with formatted message", () => {
    const error = new AlreadyConnectedError("test-agent");

    expect(error.message).toBe("Discord connector for agent 'test-agent' is already connected");
    expect(error.code).toBe(DiscordErrorCode.ALREADY_CONNECTED);
    expect(error.agentName).toBe("test-agent");
    expect(error.name).toBe("AlreadyConnectedError");
  });

  it("extends DiscordConnectorError", () => {
    const error = new AlreadyConnectedError("test-agent");

    expect(error).toBeInstanceOf(DiscordConnectorError);
    expect(error).toBeInstanceOf(Error);
  });
});

// =============================================================================
// InvalidTokenError Tests
// =============================================================================

describe("InvalidTokenError", () => {
  it("creates error with formatted message", () => {
    const error = new InvalidTokenError("test-agent", "Token expired");

    expect(error.message).toBe("Invalid Discord bot token for agent 'test-agent': Token expired");
    expect(error.code).toBe(DiscordErrorCode.INVALID_TOKEN);
    expect(error.agentName).toBe("test-agent");
    expect(error.name).toBe("InvalidTokenError");
  });

  it("extends DiscordConnectorError", () => {
    const error = new InvalidTokenError("test-agent", "Test");

    expect(error).toBeInstanceOf(DiscordConnectorError);
    expect(error).toBeInstanceOf(Error);
  });
});

// =============================================================================
// MissingTokenError Tests
// =============================================================================

describe("MissingTokenError", () => {
  it("creates error with formatted message", () => {
    const error = new MissingTokenError("test-agent", "MY_BOT_TOKEN");

    expect(error.message).toBe(
      "Missing Discord bot token for agent 'test-agent': environment variable 'MY_BOT_TOKEN' is not set",
    );
    expect(error.code).toBe(DiscordErrorCode.MISSING_TOKEN);
    expect(error.agentName).toBe("test-agent");
    expect(error.name).toBe("MissingTokenError");
  });

  it("extends DiscordConnectorError", () => {
    const error = new MissingTokenError("test-agent", "TOKEN_ENV");

    expect(error).toBeInstanceOf(DiscordConnectorError);
    expect(error).toBeInstanceOf(Error);
  });
});

// =============================================================================
// isDiscordConnectorError Tests
// =============================================================================

describe("isDiscordConnectorError", () => {
  it("returns true for DiscordConnectorError", () => {
    const error = new DiscordConnectorError(
      "Test",
      DiscordErrorCode.CONNECTION_FAILED,
      "test-agent",
    );

    expect(isDiscordConnectorError(error)).toBe(true);
  });

  it("returns true for DiscordConnectionError", () => {
    const error = new DiscordConnectionError("test-agent", "Test");

    expect(isDiscordConnectorError(error)).toBe(true);
  });

  it("returns true for AlreadyConnectedError", () => {
    const error = new AlreadyConnectedError("test-agent");

    expect(isDiscordConnectorError(error)).toBe(true);
  });

  it("returns true for InvalidTokenError", () => {
    const error = new InvalidTokenError("test-agent", "Test");

    expect(isDiscordConnectorError(error)).toBe(true);
  });

  it("returns true for MissingTokenError", () => {
    const error = new MissingTokenError("test-agent", "TOKEN");

    expect(isDiscordConnectorError(error)).toBe(true);
  });

  it("returns false for regular Error", () => {
    const error = new Error("Test");

    expect(isDiscordConnectorError(error)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isDiscordConnectorError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isDiscordConnectorError(undefined)).toBe(false);
  });

  it("returns false for string", () => {
    expect(isDiscordConnectorError("error message")).toBe(false);
  });
});

// =============================================================================
// DiscordErrorCode Tests
// =============================================================================

describe("DiscordErrorCode", () => {
  it("has all expected error codes", () => {
    expect(DiscordErrorCode.CONNECTION_FAILED).toBe("DISCORD_CONNECTION_FAILED");
    expect(DiscordErrorCode.ALREADY_CONNECTED).toBe("DISCORD_ALREADY_CONNECTED");
    expect(DiscordErrorCode.NOT_CONNECTED).toBe("DISCORD_NOT_CONNECTED");
    expect(DiscordErrorCode.INVALID_TOKEN).toBe("DISCORD_INVALID_TOKEN");
    expect(DiscordErrorCode.MISSING_TOKEN).toBe("DISCORD_MISSING_TOKEN");
    expect(DiscordErrorCode.GATEWAY_ERROR).toBe("DISCORD_GATEWAY_ERROR");
    expect(DiscordErrorCode.RATE_LIMITED).toBe("DISCORD_RATE_LIMITED");
  });
});
