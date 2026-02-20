import { describe, expect, it } from "vitest";
import {
  AlreadyConnectedError,
  InvalidTokenError,
  isSlackConnectorError,
  MissingTokenError,
  SlackConnectionError,
  SlackConnectorError,
  SlackErrorCode,
} from "../errors.js";

describe("SlackConnectorError", () => {
  it("creates error with correct properties", () => {
    const error = new SlackConnectorError("Test error message", SlackErrorCode.CONNECTION_FAILED);

    expect(error.message).toBe("Test error message");
    expect(error.code).toBe(SlackErrorCode.CONNECTION_FAILED);
    expect(error.name).toBe("SlackConnectorError");
  });

  it("extends Error", () => {
    const error = new SlackConnectorError("Test", SlackErrorCode.CONNECTION_FAILED);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SlackConnectorError);
  });

  it("preserves cause when provided", () => {
    const cause = new Error("Original error");
    const error = new SlackConnectorError("Wrapped error", SlackErrorCode.CONNECTION_FAILED, {
      cause,
    });

    expect(error.cause).toBe(cause);
  });
});

describe("SlackConnectionError", () => {
  it("creates error with correct properties", () => {
    const error = new SlackConnectionError("Connection timed out");

    expect(error.message).toBe("Connection timed out");
    expect(error.code).toBe(SlackErrorCode.CONNECTION_FAILED);
    expect(error.name).toBe("SlackConnectionError");
  });

  it("extends SlackConnectorError", () => {
    const error = new SlackConnectionError("Test");

    expect(error).toBeInstanceOf(SlackConnectorError);
    expect(error).toBeInstanceOf(Error);
  });

  it("preserves cause when provided", () => {
    const cause = new Error("Socket error");
    const error = new SlackConnectionError("Connection lost", { cause });

    expect(error.cause).toBe(cause);
  });
});

describe("AlreadyConnectedError", () => {
  it("creates error with correct message", () => {
    const error = new AlreadyConnectedError();

    expect(error.message).toBe("Slack connector is already connected");
    expect(error.code).toBe(SlackErrorCode.ALREADY_CONNECTED);
    expect(error.name).toBe("AlreadyConnectedError");
  });

  it("extends SlackConnectorError", () => {
    const error = new AlreadyConnectedError();

    expect(error).toBeInstanceOf(SlackConnectorError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe("MissingTokenError", () => {
  it("creates error for bot token", () => {
    const error = new MissingTokenError("bot", "SLACK_BOT_TOKEN");

    expect(error.message).toBe(
      "Slack bot token not found in environment variable 'SLACK_BOT_TOKEN'",
    );
    expect(error.code).toBe(SlackErrorCode.MISSING_TOKEN);
    expect(error.tokenType).toBe("bot");
    expect(error.name).toBe("MissingTokenError");
  });

  it("creates error for app token", () => {
    const error = new MissingTokenError("app", "SLACK_APP_TOKEN");

    expect(error.message).toBe(
      "Slack app token not found in environment variable 'SLACK_APP_TOKEN'",
    );
    expect(error.tokenType).toBe("app");
  });

  it("extends SlackConnectorError", () => {
    const error = new MissingTokenError("bot", "TOKEN");

    expect(error).toBeInstanceOf(SlackConnectorError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe("InvalidTokenError", () => {
  it("creates error with message", () => {
    const error = new InvalidTokenError("Token format is wrong");

    expect(error.message).toBe("Token format is wrong");
    expect(error.code).toBe(SlackErrorCode.INVALID_TOKEN);
    expect(error.name).toBe("InvalidTokenError");
  });

  it("extends SlackConnectorError", () => {
    const error = new InvalidTokenError("Test");

    expect(error).toBeInstanceOf(SlackConnectorError);
    expect(error).toBeInstanceOf(Error);
  });

  it("preserves cause when provided", () => {
    const cause = new Error("Auth error");
    const error = new InvalidTokenError("Bad token", { cause });

    expect(error.cause).toBe(cause);
  });
});

describe("isSlackConnectorError", () => {
  it("returns true for SlackConnectorError", () => {
    const error = new SlackConnectorError("Test", SlackErrorCode.CONNECTION_FAILED);
    expect(isSlackConnectorError(error)).toBe(true);
  });

  it("returns true for SlackConnectionError", () => {
    const error = new SlackConnectionError("Test");
    expect(isSlackConnectorError(error)).toBe(true);
  });

  it("returns true for AlreadyConnectedError", () => {
    const error = new AlreadyConnectedError();
    expect(isSlackConnectorError(error)).toBe(true);
  });

  it("returns true for MissingTokenError", () => {
    const error = new MissingTokenError("bot", "TOKEN");
    expect(isSlackConnectorError(error)).toBe(true);
  });

  it("returns true for InvalidTokenError", () => {
    const error = new InvalidTokenError("Test");
    expect(isSlackConnectorError(error)).toBe(true);
  });

  it("returns false for regular Error", () => {
    expect(isSlackConnectorError(new Error("Test"))).toBe(false);
  });

  it("returns false for null", () => {
    expect(isSlackConnectorError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isSlackConnectorError(undefined)).toBe(false);
  });

  it("returns false for string", () => {
    expect(isSlackConnectorError("error message")).toBe(false);
  });
});

describe("SlackErrorCode", () => {
  it("has all expected error codes", () => {
    expect(SlackErrorCode.CONNECTION_FAILED).toBe("SLACK_CONNECTION_FAILED");
    expect(SlackErrorCode.ALREADY_CONNECTED).toBe("SLACK_ALREADY_CONNECTED");
    expect(SlackErrorCode.MISSING_TOKEN).toBe("SLACK_MISSING_TOKEN");
    expect(SlackErrorCode.INVALID_TOKEN).toBe("SLACK_INVALID_TOKEN");
    expect(SlackErrorCode.MESSAGE_SEND_FAILED).toBe("SLACK_MESSAGE_SEND_FAILED");
    expect(SlackErrorCode.SOCKET_MODE_ERROR).toBe("SLACK_SOCKET_MODE_ERROR");
  });
});
