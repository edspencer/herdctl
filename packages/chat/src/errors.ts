/**
 * Shared error classes for chat connectors
 *
 * Provides typed errors for chat connection and operation failures.
 * Platform-specific connectors extend these with their own error codes.
 */

// =============================================================================
// Error Codes
// =============================================================================

/**
 * Common error codes for chat connector operations
 *
 * These are shared across all platforms. Platform-specific connectors
 * may have additional error codes.
 */
export enum ChatErrorCode {
  /** Connection to the chat platform failed */
  CONNECTION_FAILED = "CHAT_CONNECTION_FAILED",
  /** Attempting to connect while already connected */
  ALREADY_CONNECTED = "CHAT_ALREADY_CONNECTED",
  /** Bot token is invalid or rejected by the platform */
  INVALID_TOKEN = "CHAT_INVALID_TOKEN",
  /** Required bot token is not provided */
  MISSING_TOKEN = "CHAT_MISSING_TOKEN",
}

// =============================================================================
// Base Error Class
// =============================================================================

/**
 * Base error class for chat connector operations
 *
 * All chat-related errors extend this class. It includes:
 * - An error code for programmatic handling
 * - An optional agent name for context
 *
 * @example
 * ```typescript
 * try {
 *   await connector.connect();
 * } catch (error) {
 *   if (isChatConnectorError(error)) {
 *     console.log(`Error code: ${error.code}`);
 *     console.log(`Agent: ${error.agentName}`);
 *   }
 * }
 * ```
 */
export class ChatConnectorError extends Error {
  public readonly code: string;
  public readonly agentName: string;

  constructor(message: string, code: string, agentName: string, options?: { cause?: Error }) {
    super(message, options);
    this.name = "ChatConnectorError";
    this.code = code;
    this.agentName = agentName;
  }
}

// =============================================================================
// Specific Error Classes
// =============================================================================

/**
 * Error thrown when connection to the chat platform fails
 */
export class ChatConnectionError extends ChatConnectorError {
  constructor(agentName: string, message: string, options?: { cause?: Error }) {
    super(
      `Chat connection failed for agent '${agentName}': ${message}`,
      ChatErrorCode.CONNECTION_FAILED,
      agentName,
      options,
    );
    this.name = "ChatConnectionError";
  }
}

/**
 * Error thrown when attempting to connect while already connected
 */
export class AlreadyConnectedError extends ChatConnectorError {
  constructor(agentName: string) {
    super(
      `Chat connector for agent '${agentName}' is already connected`,
      ChatErrorCode.ALREADY_CONNECTED,
      agentName,
    );
    this.name = "AlreadyConnectedError";
  }
}

/**
 * Error thrown when bot token is invalid or rejected
 */
export class InvalidTokenError extends ChatConnectorError {
  constructor(agentName: string, reason: string) {
    super(
      `Invalid chat token for agent '${agentName}': ${reason}`,
      ChatErrorCode.INVALID_TOKEN,
      agentName,
    );
    this.name = "InvalidTokenError";
  }
}

/**
 * Error thrown when required bot token is not provided
 */
export class MissingTokenError extends ChatConnectorError {
  public readonly envVar: string;
  public readonly tokenType?: string;

  constructor(agentName: string, envVar: string, tokenType?: string) {
    const tokenDesc = tokenType ? `${tokenType} token` : "token";
    super(
      `Missing chat ${tokenDesc} for agent '${agentName}': environment variable '${envVar}' is not set`,
      ChatErrorCode.MISSING_TOKEN,
      agentName,
    );
    this.name = "MissingTokenError";
    this.envVar = envVar;
    this.tokenType = tokenType;
  }
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if an error is a ChatConnectorError
 *
 * @param error - Error to check
 * @returns true if the error is a ChatConnectorError
 *
 * @example
 * ```typescript
 * try {
 *   await connector.connect();
 * } catch (error) {
 *   if (isChatConnectorError(error)) {
 *     switch (error.code) {
 *       case ChatErrorCode.ALREADY_CONNECTED:
 *         // Already connected, ignore
 *         break;
 *       case ChatErrorCode.INVALID_TOKEN:
 *         // Handle invalid token
 *         break;
 *     }
 *   }
 * }
 * ```
 */
export function isChatConnectorError(error: unknown): error is ChatConnectorError {
  return error instanceof ChatConnectorError;
}

/**
 * Type guard to check if an error is a ChatConnectionError
 */
export function isChatConnectionError(error: unknown): error is ChatConnectionError {
  return error instanceof ChatConnectionError;
}

/**
 * Type guard to check if an error is an AlreadyConnectedError
 */
export function isAlreadyConnectedError(error: unknown): error is AlreadyConnectedError {
  return error instanceof AlreadyConnectedError;
}

/**
 * Type guard to check if an error is an InvalidTokenError
 */
export function isInvalidTokenError(error: unknown): error is InvalidTokenError {
  return error instanceof InvalidTokenError;
}

/**
 * Type guard to check if an error is a MissingTokenError
 */
export function isMissingTokenError(error: unknown): error is MissingTokenError {
  return error instanceof MissingTokenError;
}
