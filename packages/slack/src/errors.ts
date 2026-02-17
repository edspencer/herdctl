/**
 * Error classes for the Slack connector
 *
 * Provides typed errors for Slack connection and message handling failures.
 */

/**
 * Error codes for Slack connector operations
 */
export enum SlackErrorCode {
  CONNECTION_FAILED = "SLACK_CONNECTION_FAILED",
  ALREADY_CONNECTED = "SLACK_ALREADY_CONNECTED",
  MISSING_TOKEN = "SLACK_MISSING_TOKEN",
  INVALID_TOKEN = "SLACK_INVALID_TOKEN",
  MESSAGE_SEND_FAILED = "SLACK_MESSAGE_SEND_FAILED",
  SOCKET_MODE_ERROR = "SLACK_SOCKET_MODE_ERROR",
}

/**
 * Base error class for Slack connector operations
 */
export class SlackConnectorError extends Error {
  public readonly code: SlackErrorCode;

  constructor(
    message: string,
    code: SlackErrorCode,
    options?: { cause?: Error }
  ) {
    super(message, options);
    this.name = "SlackConnectorError";
    this.code = code;
  }
}

/**
 * Error thrown when connection to Slack fails
 */
export class SlackConnectionError extends SlackConnectorError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, SlackErrorCode.CONNECTION_FAILED, options);
    this.name = "SlackConnectionError";
  }
}

/**
 * Error thrown when attempting to connect while already connected
 */
export class AlreadyConnectedError extends SlackConnectorError {
  constructor() {
    super(
      "Slack connector is already connected",
      SlackErrorCode.ALREADY_CONNECTED
    );
    this.name = "AlreadyConnectedError";
  }
}

/**
 * Error thrown when bot or app token is missing
 */
export class MissingTokenError extends SlackConnectorError {
  public readonly tokenType: "bot" | "app";

  constructor(tokenType: "bot" | "app", envVar: string) {
    super(
      `Slack ${tokenType} token not found in environment variable '${envVar}'`,
      SlackErrorCode.MISSING_TOKEN
    );
    this.name = "MissingTokenError";
    this.tokenType = tokenType;
  }
}

/**
 * Error thrown when a token is invalid
 */
export class InvalidTokenError extends SlackConnectorError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, SlackErrorCode.INVALID_TOKEN, options);
    this.name = "InvalidTokenError";
  }
}

/**
 * Type guard to check if an error is a SlackConnectorError
 */
export function isSlackConnectorError(
  error: unknown
): error is SlackConnectorError {
  return error instanceof SlackConnectorError;
}
