/**
 * Error classes for the Discord connector
 *
 * Provides typed errors for Discord connection and operation failures.
 */

/**
 * Error codes for Discord connector operations
 */
export enum DiscordErrorCode {
  CONNECTION_FAILED = "DISCORD_CONNECTION_FAILED",
  ALREADY_CONNECTED = "DISCORD_ALREADY_CONNECTED",
  NOT_CONNECTED = "DISCORD_NOT_CONNECTED",
  INVALID_TOKEN = "DISCORD_INVALID_TOKEN",
  MISSING_TOKEN = "DISCORD_MISSING_TOKEN",
  GATEWAY_ERROR = "DISCORD_GATEWAY_ERROR",
  RATE_LIMITED = "DISCORD_RATE_LIMITED",
}

/**
 * Base error class for Discord connector operations
 *
 * Note: This extends Error directly rather than FleetManagerError
 * because Discord connector errors have their own error code type.
 */
export class DiscordConnectorError extends Error {
  public readonly code: DiscordErrorCode;
  public readonly agentName: string;

  constructor(
    message: string,
    code: DiscordErrorCode,
    agentName: string,
    options?: { cause?: Error },
  ) {
    super(message, options);
    this.name = "DiscordConnectorError";
    this.code = code;
    this.agentName = agentName;
  }
}

/**
 * Error thrown when connection to Discord fails
 */
export class DiscordConnectionError extends DiscordConnectorError {
  constructor(agentName: string, message: string, options?: { cause?: Error }) {
    super(
      `Discord connection failed for agent '${agentName}': ${message}`,
      DiscordErrorCode.CONNECTION_FAILED,
      agentName,
      options,
    );
    this.name = "DiscordConnectionError";
  }
}

/**
 * Error thrown when attempting to connect while already connected
 */
export class AlreadyConnectedError extends DiscordConnectorError {
  constructor(agentName: string) {
    super(
      `Discord connector for agent '${agentName}' is already connected`,
      DiscordErrorCode.ALREADY_CONNECTED,
      agentName,
    );
    this.name = "AlreadyConnectedError";
  }
}

/**
 * Error thrown when bot token is missing or invalid
 */
export class InvalidTokenError extends DiscordConnectorError {
  constructor(agentName: string, reason: string) {
    super(
      `Invalid Discord bot token for agent '${agentName}': ${reason}`,
      DiscordErrorCode.INVALID_TOKEN,
      agentName,
    );
    this.name = "InvalidTokenError";
  }
}

/**
 * Error thrown when bot token is not provided
 */
export class MissingTokenError extends DiscordConnectorError {
  constructor(agentName: string, envVar: string) {
    super(
      `Missing Discord bot token for agent '${agentName}': environment variable '${envVar}' is not set`,
      DiscordErrorCode.MISSING_TOKEN,
      agentName,
    );
    this.name = "MissingTokenError";
  }
}

/**
 * Type guard to check if an error is a DiscordConnectorError
 */
export function isDiscordConnectorError(error: unknown): error is DiscordConnectorError {
  return error instanceof DiscordConnectorError;
}
