/**
 * Error classes for chat session management
 *
 * Provides typed errors for session persistence and retrieval failures.
 * These error classes are shared between Discord, Slack, and other chat platforms.
 */

/**
 * Error codes for session manager operations
 */
export enum SessionErrorCode {
  STATE_READ_FAILED = "SESSION_STATE_READ_FAILED",
  STATE_WRITE_FAILED = "SESSION_STATE_WRITE_FAILED",
  DIRECTORY_CREATE_FAILED = "SESSION_DIRECTORY_CREATE_FAILED",
  SESSION_NOT_FOUND = "SESSION_NOT_FOUND",
  SESSION_EXPIRED = "SESSION_EXPIRED",
  INVALID_STATE = "SESSION_INVALID_STATE",
}

/**
 * Base error class for session manager operations
 */
export class SessionManagerError extends Error {
  public readonly code: SessionErrorCode;
  public readonly agentName: string;

  constructor(
    message: string,
    code: SessionErrorCode,
    agentName: string,
    options?: { cause?: Error },
  ) {
    super(message, options);
    this.name = "SessionManagerError";
    this.code = code;
    this.agentName = agentName;
  }
}

/**
 * Error thrown when session state file cannot be read
 */
export class SessionStateReadError extends SessionManagerError {
  public readonly path: string;

  constructor(agentName: string, path: string, options?: { cause?: Error }) {
    super(
      `Failed to read session state for agent '${agentName}' from '${path}'`,
      SessionErrorCode.STATE_READ_FAILED,
      agentName,
      options,
    );
    this.name = "SessionStateReadError";
    this.path = path;
  }
}

/**
 * Error thrown when session state file cannot be written
 */
export class SessionStateWriteError extends SessionManagerError {
  public readonly path: string;

  constructor(agentName: string, path: string, options?: { cause?: Error }) {
    super(
      `Failed to write session state for agent '${agentName}' to '${path}'`,
      SessionErrorCode.STATE_WRITE_FAILED,
      agentName,
      options,
    );
    this.name = "SessionStateWriteError";
    this.path = path;
  }
}

/**
 * Error thrown when session directory cannot be created
 */
export class SessionDirectoryCreateError extends SessionManagerError {
  public readonly path: string;

  constructor(agentName: string, path: string, options?: { cause?: Error }) {
    super(
      `Failed to create session directory for agent '${agentName}' at '${path}'`,
      SessionErrorCode.DIRECTORY_CREATE_FAILED,
      agentName,
      options,
    );
    this.name = "SessionDirectoryCreateError";
    this.path = path;
  }
}

/**
 * Type guard to check if an error is a SessionManagerError
 */
export function isSessionManagerError(error: unknown): error is SessionManagerError {
  return error instanceof SessionManagerError;
}
