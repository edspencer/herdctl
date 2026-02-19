/**
 * Error classes for work-sources module
 *
 * Provides typed errors with descriptive messages for work source operations.
 */

// =============================================================================
// Base Error Class
// =============================================================================

/**
 * Base error class for all work source errors
 */
export class WorkSourceError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(message);
    this.name = "WorkSourceError";
    this.cause = options?.cause;
  }
}

// =============================================================================
// Registry Errors
// =============================================================================

/**
 * Error thrown when attempting to get a work source adapter for an unregistered type
 *
 * This error indicates that no factory has been registered for the requested
 * work source type. Use `registerWorkSource()` to register a factory before
 * attempting to get an adapter.
 */
export class UnknownWorkSourceError extends WorkSourceError {
  /** The work source type that was requested */
  public readonly sourceType: string;
  /** List of currently registered work source types */
  public readonly availableTypes: string[];

  constructor(sourceType: string, availableTypes: string[], options?: { cause?: Error }) {
    const availableList = availableTypes.length > 0 ? availableTypes.join(", ") : "none";
    super(`Unknown work source type: "${sourceType}". Available types: ${availableList}`, options);
    this.name = "UnknownWorkSourceError";
    this.sourceType = sourceType;
    this.availableTypes = availableTypes;
  }
}

/**
 * Error thrown when attempting to register a work source type that is already registered
 */
export class DuplicateWorkSourceError extends WorkSourceError {
  /** The work source type that was already registered */
  public readonly sourceType: string;

  constructor(sourceType: string, options?: { cause?: Error }) {
    super(
      `Work source type "${sourceType}" is already registered. Use a different type name or unregister the existing one first.`,
      options,
    );
    this.name = "DuplicateWorkSourceError";
    this.sourceType = sourceType;
  }
}
