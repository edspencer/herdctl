/**
 * Error classes for state management operations
 *
 * Provides typed errors with descriptive messages for state-related failures
 */

/**
 * Base error class for state management errors
 */
export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateError";
  }
}

/**
 * Error thrown when the state directory cannot be created
 */
export class StateDirectoryCreateError extends StateError {
  /** Path that could not be created */
  public readonly path: string;
  /** System error code if available (e.g., EACCES, ENOENT) */
  public readonly code?: string;

  constructor(message: string, path: string, cause?: Error) {
    super(message);
    this.name = "StateDirectoryCreateError";
    this.path = path;
    this.cause = cause;
    this.code = (cause as NodeJS.ErrnoException | undefined)?.code;
  }
}

/**
 * Error thrown when the state directory validation fails
 */
export class StateDirectoryValidationError extends StateError {
  /** Paths that failed validation */
  public readonly missingPaths: string[];

  constructor(message: string, missingPaths: string[]) {
    super(message);
    this.name = "StateDirectoryValidationError";
    this.missingPaths = missingPaths;
  }
}

/**
 * Error thrown when the state file cannot be read or written
 */
export class StateFileError extends StateError {
  /** Path to the state file */
  public readonly path: string;
  /** The operation that failed */
  public readonly operation: "read" | "write";

  constructor(message: string, path: string, operation: "read" | "write", cause?: Error) {
    super(message);
    this.name = "StateFileError";
    this.path = path;
    this.operation = operation;
    this.cause = cause;
  }
}

/**
 * Error thrown when an adoption claim is refused because it could not take
 * effect (herdctl#437).
 *
 * Attribution resolves job records and platform bindings *ahead* of adoption
 * records, so claiming a session that another agent already owns writes a record
 * that is inert by construction: the caller is told the adoption succeeded, the
 * session never appears under the adopting agent, and the burnt record excludes
 * it from every later attempt. Refusing loudly is what keeps that recoverable.
 */
export class SessionAdoptionRefusedError extends StateError {
  /** The session that could not be adopted */
  public readonly sessionId: string;
  /** The agent that already owns it, and would keep owning it */
  public readonly ownedBy: string;

  constructor(sessionId: string, ownedBy: string, detail: string) {
    super(
      `Cannot adopt session ${sessionId}: it is already attributed to agent "${ownedBy}" (${detail}). ` +
        `Job and platform records outrank adoption, so the record would have no effect.`,
    );
    this.name = "SessionAdoptionRefusedError";
    this.sessionId = sessionId;
    this.ownedBy = ownedBy;
  }
}

/**
 * Get a descriptive error message for common permission errors
 */
export function getPermissionErrorMessage(code: string | undefined, path: string): string {
  switch (code) {
    case "EACCES":
      return `Permission denied: Cannot access '${path}'. Check file permissions.`;
    case "EPERM":
      return `Operation not permitted: Cannot modify '${path}'. This may require elevated privileges.`;
    case "EROFS":
      return `Read-only filesystem: Cannot write to '${path}'.`;
    case "ENOSPC":
      return `No space left on device: Cannot create '${path}'.`;
    case "ENOENT":
      return `Path does not exist: '${path}' or one of its parent directories is missing.`;
    case "ENOTDIR":
      return `Not a directory: A component of '${path}' is not a directory.`;
    case "EEXIST":
      return `Path already exists: '${path}' already exists as a file but should be a directory.`;
    default:
      return `Failed to access '${path}'${code ? ` (${code})` : ""}.`;
  }
}
