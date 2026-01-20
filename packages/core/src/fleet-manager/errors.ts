/**
 * Error classes for fleet manager operations
 *
 * Provides typed errors with descriptive messages and error codes for fleet manager failures.
 * All errors extend FleetManagerError and include relevant context for debugging.
 */

// =============================================================================
// Error Codes
// =============================================================================

/**
 * Error codes for fleet manager errors
 * These codes provide a stable identifier for error types that can be used
 * for programmatic error handling.
 */
export const FleetManagerErrorCode = {
  // Base error
  FLEET_MANAGER_ERROR: "FLEET_MANAGER_ERROR",

  // Configuration errors
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
  CONFIG_LOAD_ERROR: "CONFIG_LOAD_ERROR",

  // Not found errors
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  JOB_NOT_FOUND: "JOB_NOT_FOUND",
  SCHEDULE_NOT_FOUND: "SCHEDULE_NOT_FOUND",

  // State errors
  INVALID_STATE: "INVALID_STATE",
  STATE_DIR_ERROR: "STATE_DIR_ERROR",

  // Operational errors
  CONCURRENCY_LIMIT: "CONCURRENCY_LIMIT",
  SHUTDOWN_ERROR: "SHUTDOWN_ERROR",

  // Job control errors (US-6)
  JOB_CANCEL_ERROR: "JOB_CANCEL_ERROR",
  JOB_FORK_ERROR: "JOB_FORK_ERROR",
} as const;

export type FleetManagerErrorCode =
  (typeof FleetManagerErrorCode)[keyof typeof FleetManagerErrorCode];

// =============================================================================
// Base Error Class
// =============================================================================

/**
 * Base error class for all fleet manager errors
 *
 * All fleet manager errors extend this class and include:
 * - A unique error code for programmatic handling
 * - Descriptive error messages
 * - Optional cause for error chaining
 */
export class FleetManagerError extends Error {
  /** Error code for programmatic handling */
  public readonly code: FleetManagerErrorCode;

  constructor(
    message: string,
    options?: { cause?: Error; code?: FleetManagerErrorCode }
  ) {
    super(message);
    this.name = "FleetManagerError";
    this.cause = options?.cause;
    this.code = options?.code ?? FleetManagerErrorCode.FLEET_MANAGER_ERROR;
  }
}

// =============================================================================
// Configuration Errors
// =============================================================================

/**
 * Validation error detail for configuration errors
 */
export interface ValidationError {
  /** Path to the invalid field (e.g., "agents[0].schedules[0].interval") */
  path: string;
  /** Description of the validation error */
  message: string;
  /** The invalid value, if available */
  value?: unknown;
}

/**
 * Error thrown when configuration is invalid or cannot be loaded
 *
 * This error is thrown when:
 * - The configuration file cannot be found or read
 * - The configuration YAML is malformed
 * - The configuration fails schema validation
 * - Agent definitions are invalid
 *
 * @example
 * ```typescript
 * try {
 *   await fleetManager.initialize();
 * } catch (error) {
 *   if (error instanceof ConfigurationError) {
 *     console.error(`Config error at ${error.configPath}:`);
 *     for (const ve of error.validationErrors) {
 *       console.error(`  - ${ve.path}: ${ve.message}`);
 *     }
 *   }
 * }
 * ```
 */
export class ConfigurationError extends FleetManagerError {
  /** The path to the configuration file that failed */
  public readonly configPath?: string;

  /** Detailed validation errors, if any */
  public readonly validationErrors: ValidationError[];

  constructor(
    message: string,
    options?: {
      configPath?: string;
      validationErrors?: ValidationError[];
      cause?: Error;
    }
  ) {
    const validationErrors = options?.validationErrors ?? [];
    const fullMessage = ConfigurationError.buildMessage(
      message,
      options?.configPath,
      validationErrors
    );

    super(fullMessage, {
      cause: options?.cause,
      code: FleetManagerErrorCode.CONFIGURATION_ERROR,
    });
    this.name = "ConfigurationError";
    this.configPath = options?.configPath;
    this.validationErrors = validationErrors;
  }

  /**
   * Build a detailed error message including validation errors
   */
  private static buildMessage(
    message: string,
    configPath?: string,
    validationErrors?: ValidationError[]
  ): string {
    const parts = [message];

    if (configPath) {
      parts.push(`Config file: ${configPath}`);
    }

    if (validationErrors && validationErrors.length > 0) {
      parts.push("Validation errors:");
      for (const ve of validationErrors) {
        parts.push(`  - ${ve.path}: ${ve.message}`);
      }
    }

    return parts.join("\n");
  }

  /**
   * Check if this error has validation errors
   */
  hasValidationErrors(): boolean {
    return this.validationErrors.length > 0;
  }
}

// =============================================================================
// Not Found Errors
// =============================================================================

/**
 * Error thrown when a requested agent is not found
 *
 * This error is thrown when:
 * - Attempting to run an agent that doesn't exist in the configuration
 * - Attempting to get status for an unknown agent
 * - Referencing an agent name that hasn't been defined
 *
 * @example
 * ```typescript
 * try {
 *   await fleetManager.runAgent('nonexistent-agent');
 * } catch (error) {
 *   if (error instanceof AgentNotFoundError) {
 *     console.error(`Agent "${error.agentName}" not found`);
 *     console.log('Available agents:', fleetManager.getAgentNames());
 *   }
 * }
 * ```
 */
export class AgentNotFoundError extends FleetManagerError {
  /** The name of the agent that was not found */
  public readonly agentName: string;

  /** Optional list of available agent names for helpful error messages */
  public readonly availableAgents?: string[];

  constructor(
    agentName: string,
    options?: { availableAgents?: string[]; cause?: Error }
  ) {
    const message = AgentNotFoundError.buildMessage(
      agentName,
      options?.availableAgents
    );
    super(message, {
      cause: options?.cause,
      code: FleetManagerErrorCode.AGENT_NOT_FOUND,
    });
    this.name = "AgentNotFoundError";
    this.agentName = agentName;
    this.availableAgents = options?.availableAgents;
  }

  private static buildMessage(
    agentName: string,
    availableAgents?: string[]
  ): string {
    let message = `Agent "${agentName}" not found`;

    if (availableAgents && availableAgents.length > 0) {
      message += `. Available agents: ${availableAgents.join(", ")}`;
    } else if (availableAgents && availableAgents.length === 0) {
      message += ". No agents are configured.";
    }

    return message;
  }
}

/**
 * Error thrown when a requested job is not found
 *
 * This error is thrown when:
 * - Attempting to get status for a job that doesn't exist
 * - Attempting to cancel a job that has already completed or doesn't exist
 * - Referencing a job ID that is unknown
 *
 * @example
 * ```typescript
 * try {
 *   const status = await fleetManager.getJobStatus('unknown-job-id');
 * } catch (error) {
 *   if (error instanceof JobNotFoundError) {
 *     console.error(`Job "${error.jobId}" not found`);
 *   }
 * }
 * ```
 */
export class JobNotFoundError extends FleetManagerError {
  /** The ID of the job that was not found */
  public readonly jobId: string;

  constructor(jobId: string, options?: { cause?: Error }) {
    super(`Job "${jobId}" not found`, {
      cause: options?.cause,
      code: FleetManagerErrorCode.JOB_NOT_FOUND,
    });
    this.name = "JobNotFoundError";
    this.jobId = jobId;
  }
}

/**
 * Error thrown when a requested schedule is not found
 *
 * This error is thrown when:
 * - Attempting to trigger a schedule that doesn't exist
 * - Attempting to enable/disable a schedule that doesn't exist
 * - Referencing a schedule name that hasn't been defined for an agent
 *
 * @example
 * ```typescript
 * try {
 *   await fleetManager.triggerSchedule('my-agent', 'nonexistent-schedule');
 * } catch (error) {
 *   if (error instanceof ScheduleNotFoundError) {
 *     console.error(
 *       `Schedule "${error.scheduleName}" not found for agent "${error.agentName}"`
 *     );
 *   }
 * }
 * ```
 */
export class ScheduleNotFoundError extends FleetManagerError {
  /** The name of the agent the schedule was expected to belong to */
  public readonly agentName: string;

  /** The name of the schedule that was not found */
  public readonly scheduleName: string;

  /** Optional list of available schedule names for helpful error messages */
  public readonly availableSchedules?: string[];

  constructor(
    agentName: string,
    scheduleName: string,
    options?: { availableSchedules?: string[]; cause?: Error }
  ) {
    const message = ScheduleNotFoundError.buildMessage(
      agentName,
      scheduleName,
      options?.availableSchedules
    );
    super(message, {
      cause: options?.cause,
      code: FleetManagerErrorCode.SCHEDULE_NOT_FOUND,
    });
    this.name = "ScheduleNotFoundError";
    this.agentName = agentName;
    this.scheduleName = scheduleName;
    this.availableSchedules = options?.availableSchedules;
  }

  private static buildMessage(
    agentName: string,
    scheduleName: string,
    availableSchedules?: string[]
  ): string {
    let message = `Schedule "${scheduleName}" not found for agent "${agentName}"`;

    if (availableSchedules && availableSchedules.length > 0) {
      message += `. Available schedules: ${availableSchedules.join(", ")}`;
    } else if (availableSchedules && availableSchedules.length === 0) {
      message += `. Agent "${agentName}" has no schedules configured.`;
    }

    return message;
  }
}

// =============================================================================
// State Errors
// =============================================================================

/**
 * Error thrown when an operation is attempted in an invalid state
 *
 * This error is thrown when:
 * - start() is called before initialize()
 * - initialize() is called when already initialized
 * - Operations are attempted while in an incompatible state
 * - State transitions are invalid
 *
 * @example
 * ```typescript
 * try {
 *   await fleetManager.start(); // without calling initialize() first
 * } catch (error) {
 *   if (error instanceof InvalidStateError) {
 *     console.error(
 *       `Cannot ${error.operation}: current state is "${error.currentState}", ` +
 *       `expected "${error.expectedState}"`
 *     );
 *   }
 * }
 * ```
 */
export class InvalidStateError extends FleetManagerError {
  /** The current state of the fleet manager */
  public readonly currentState: string;

  /** The state(s) expected/required for the operation */
  public readonly expectedState: string | string[];

  /** The operation that was attempted */
  public readonly operation: string;

  constructor(
    operation: string,
    currentState: string,
    expectedState: string | string[],
    options?: { cause?: Error }
  ) {
    const expected = Array.isArray(expectedState)
      ? expectedState.join(" or ")
      : expectedState;

    super(
      `Cannot ${operation}: fleet manager is in "${currentState}" state, must be "${expected}"`,
      {
        cause: options?.cause,
        code: FleetManagerErrorCode.INVALID_STATE,
      }
    );
    this.name = "InvalidStateError";
    this.operation = operation;
    this.currentState = currentState;
    this.expectedState = expectedState;
  }
}

/**
 * Error thrown when the fleet manager is not in the correct state for an operation
 *
 * @deprecated Use InvalidStateError instead. This class is kept for backwards compatibility.
 */
export class FleetManagerStateError extends InvalidStateError {
  constructor(
    operation: string,
    currentState: string,
    requiredState: string | string[]
  ) {
    super(operation, currentState, requiredState);
    this.name = "FleetManagerStateError";
  }

  /**
   * Alias for expectedState for backwards compatibility
   */
  get requiredState(): string | string[] {
    return this.expectedState;
  }
}

// =============================================================================
// Operational Errors
// =============================================================================

/**
 * Error thrown when an operation would exceed concurrency limits
 *
 * This error is thrown when:
 * - Attempting to start a new job when the agent has reached its concurrent job limit
 * - Attempting to run more jobs than the system allows
 *
 * @example
 * ```typescript
 * try {
 *   await fleetManager.runAgent('my-agent');
 * } catch (error) {
 *   if (error instanceof ConcurrencyLimitError) {
 *     console.error(
 *       `Agent "${error.agentName}" has ${error.currentJobs}/${error.limit} jobs running. ` +
 *       `Please wait for a job to complete.`
 *     );
 *   }
 * }
 * ```
 */
export class ConcurrencyLimitError extends FleetManagerError {
  /** The name of the agent that hit the concurrency limit */
  public readonly agentName: string;

  /** The current number of running jobs for this agent */
  public readonly currentJobs: number;

  /** The maximum allowed concurrent jobs for this agent */
  public readonly limit: number;

  constructor(
    agentName: string,
    currentJobs: number,
    limit: number,
    options?: { cause?: Error }
  ) {
    super(
      `Agent "${agentName}" has reached its concurrency limit: ${currentJobs}/${limit} jobs running`,
      {
        cause: options?.cause,
        code: FleetManagerErrorCode.CONCURRENCY_LIMIT,
      }
    );
    this.name = "ConcurrencyLimitError";
    this.agentName = agentName;
    this.currentJobs = currentJobs;
    this.limit = limit;
  }

  /**
   * Check if the limit is completely maxed out (no room for more jobs)
   */
  isAtLimit(): boolean {
    return this.currentJobs >= this.limit;
  }
}

// =============================================================================
// Configuration Loading Errors (kept for backwards compatibility)
// =============================================================================

/**
 * Error thrown when configuration loading fails
 *
 * @deprecated Use ConfigurationError instead for new code.
 * This class is kept for backwards compatibility.
 */
export class FleetManagerConfigError extends FleetManagerError {
  /** The path that was being loaded */
  public readonly configPath?: string;

  constructor(
    message: string,
    configPath?: string,
    options?: { cause?: Error }
  ) {
    super(message, {
      cause: options?.cause,
      code: FleetManagerErrorCode.CONFIG_LOAD_ERROR,
    });
    this.name = "FleetManagerConfigError";
    this.configPath = configPath;
  }
}

// =============================================================================
// State Directory Errors
// =============================================================================

/**
 * Error thrown when state directory initialization fails
 *
 * This wraps state directory errors with fleet manager context.
 */
export class FleetManagerStateDirError extends FleetManagerError {
  /** The state directory path */
  public readonly stateDir: string;

  constructor(message: string, stateDir: string, options?: { cause?: Error }) {
    super(message, {
      cause: options?.cause,
      code: FleetManagerErrorCode.STATE_DIR_ERROR,
    });
    this.name = "FleetManagerStateDirError";
    this.stateDir = stateDir;
  }
}

// =============================================================================
// Shutdown Errors
// =============================================================================

/**
 * Error thrown when fleet manager shutdown fails
 *
 * This is thrown when the fleet manager cannot shut down cleanly.
 */
export class FleetManagerShutdownError extends FleetManagerError {
  /** Whether the shutdown timed out */
  public readonly timedOut: boolean;

  constructor(
    message: string,
    options: { timedOut: boolean; cause?: Error }
  ) {
    super(message, {
      cause: options.cause,
      code: FleetManagerErrorCode.SHUTDOWN_ERROR,
    });
    this.name = "FleetManagerShutdownError";
    this.timedOut = options.timedOut;
  }

  /**
   * Check if the shutdown failed due to timeout
   */
  isTimeout(): boolean {
    return this.timedOut;
  }
}

// =============================================================================
// Job Control Errors (US-6)
// =============================================================================

/**
 * Error thrown when job cancellation fails
 *
 * This error is thrown when:
 * - The job process cannot be terminated
 * - The job is in an invalid state for cancellation
 * - An error occurs during the cancellation process
 *
 * @example
 * ```typescript
 * try {
 *   await manager.cancelJob('job-2024-01-15-abc123');
 * } catch (error) {
 *   if (error instanceof JobCancelError) {
 *     console.error(`Failed to cancel job: ${error.message}`);
 *     console.error(`Job ID: ${error.jobId}`);
 *   }
 * }
 * ```
 */
export class JobCancelError extends FleetManagerError {
  /** The ID of the job that failed to cancel */
  public readonly jobId: string;

  /** The reason the cancellation failed */
  public readonly reason: 'not_running' | 'process_error' | 'timeout' | 'unknown';

  constructor(
    jobId: string,
    reason: 'not_running' | 'process_error' | 'timeout' | 'unknown',
    options?: { message?: string; cause?: Error }
  ) {
    const defaultMessages: Record<typeof reason, string> = {
      not_running: `Job "${jobId}" is not running and cannot be cancelled`,
      process_error: `Failed to terminate process for job "${jobId}"`,
      timeout: `Timeout waiting for job "${jobId}" to terminate`,
      unknown: `Unknown error cancelling job "${jobId}"`,
    };

    super(options?.message ?? defaultMessages[reason], {
      cause: options?.cause,
      code: FleetManagerErrorCode.JOB_CANCEL_ERROR,
    });
    this.name = "JobCancelError";
    this.jobId = jobId;
    this.reason = reason;
  }
}

/**
 * Error thrown when job forking fails
 *
 * This error is thrown when:
 * - The original job cannot be found
 * - The original job has no session to fork
 * - An error occurs during the fork process
 *
 * @example
 * ```typescript
 * try {
 *   await manager.forkJob('job-2024-01-15-abc123');
 * } catch (error) {
 *   if (error instanceof JobForkError) {
 *     console.error(`Failed to fork job: ${error.message}`);
 *     console.error(`Original Job ID: ${error.originalJobId}`);
 *   }
 * }
 * ```
 */
export class JobForkError extends FleetManagerError {
  /** The ID of the original job that failed to fork */
  public readonly originalJobId: string;

  /** The reason the fork failed */
  public readonly reason: 'no_session' | 'job_not_found' | 'agent_not_found' | 'unknown';

  constructor(
    originalJobId: string,
    reason: 'no_session' | 'job_not_found' | 'agent_not_found' | 'unknown',
    options?: { message?: string; cause?: Error }
  ) {
    const defaultMessages: Record<typeof reason, string> = {
      no_session: `Job "${originalJobId}" has no session ID and cannot be forked`,
      job_not_found: `Job "${originalJobId}" not found`,
      agent_not_found: `Agent for job "${originalJobId}" not found`,
      unknown: `Unknown error forking job "${originalJobId}"`,
    };

    super(options?.message ?? defaultMessages[reason], {
      cause: options?.cause,
      code: FleetManagerErrorCode.JOB_FORK_ERROR,
    });
    this.name = "JobForkError";
    this.originalJobId = originalJobId;
    this.reason = reason;
  }
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if an error is a FleetManagerError
 */
export function isFleetManagerError(error: unknown): error is FleetManagerError {
  return error instanceof FleetManagerError;
}

/**
 * Type guard to check if an error is a ConfigurationError
 */
export function isConfigurationError(
  error: unknown
): error is ConfigurationError {
  return error instanceof ConfigurationError;
}

/**
 * Type guard to check if an error is an AgentNotFoundError
 */
export function isAgentNotFoundError(
  error: unknown
): error is AgentNotFoundError {
  return error instanceof AgentNotFoundError;
}

/**
 * Type guard to check if an error is a JobNotFoundError
 */
export function isJobNotFoundError(error: unknown): error is JobNotFoundError {
  return error instanceof JobNotFoundError;
}

/**
 * Type guard to check if an error is a ScheduleNotFoundError
 */
export function isScheduleNotFoundError(
  error: unknown
): error is ScheduleNotFoundError {
  return error instanceof ScheduleNotFoundError;
}

/**
 * Type guard to check if an error is an InvalidStateError
 */
export function isInvalidStateError(
  error: unknown
): error is InvalidStateError {
  return error instanceof InvalidStateError;
}

/**
 * Type guard to check if an error is a ConcurrencyLimitError
 */
export function isConcurrencyLimitError(
  error: unknown
): error is ConcurrencyLimitError {
  return error instanceof ConcurrencyLimitError;
}

/**
 * Type guard to check if an error is a JobCancelError
 */
export function isJobCancelError(error: unknown): error is JobCancelError {
  return error instanceof JobCancelError;
}

/**
 * Type guard to check if an error is a JobForkError
 */
export function isJobForkError(error: unknown): error is JobForkError {
  return error instanceof JobForkError;
}
