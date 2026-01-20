/**
 * Error Handling Examples
 *
 * This example demonstrates:
 * - Error type guards for type-safe error handling
 * - Handling specific error types with context
 * - Retry patterns for transient failures
 * - Graceful degradation strategies
 * - Circuit breaker pattern
 *
 * Run with: npx tsx examples/library-usage/error-handling.ts
 */

import {
  FleetManager,
  // Error classes
  FleetManagerError,
  ConfigurationError,
  AgentNotFoundError,
  JobNotFoundError,
  ScheduleNotFoundError,
  InvalidStateError,
  ConcurrencyLimitError,
  JobCancelError,
  JobForkError,
  FleetManagerShutdownError,
  // Runner errors
  RunnerError,
  SDKInitializationError,
  SDKStreamingError,
  MalformedResponseError,
  // Type guards
  isFleetManagerError,
  isConfigurationError,
  isAgentNotFoundError,
  isJobNotFoundError,
  isScheduleNotFoundError,
  isInvalidStateError,
  isConcurrencyLimitError,
  isJobCancelError,
  isJobForkError,
  // Error codes
  FleetManagerErrorCode,
  // Types
  type JobCompletedPayload,
  type TriggerResult,
} from "@herdctl/core";

// =============================================================================
// Utility Functions
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Pattern: Exhaustive Error Handling with Type Guards
// =============================================================================

/**
 * Demonstrates handling all FleetManager error types
 */
function handleFleetManagerError(error: unknown): void {
  // Most specific first
  if (isConfigurationError(error)) {
    console.error("Configuration Error");
    console.error(`  Message: ${error.message}`);
    if (error.configPath) {
      console.error(`  File: ${error.configPath}`);
    }
    if (error.hasValidationErrors()) {
      console.error("  Validation errors:");
      for (const ve of error.validationErrors) {
        console.error(`    - ${ve.path}: ${ve.message}`);
      }
    }
  } else if (isAgentNotFoundError(error)) {
    console.error(`Agent not found: "${error.agentName}"`);
    if (error.availableAgents?.length) {
      console.error(`  Available: ${error.availableAgents.join(", ")}`);
    }
  } else if (isJobNotFoundError(error)) {
    console.error(`Job not found: "${error.jobId}"`);
  } else if (isScheduleNotFoundError(error)) {
    console.error(
      `Schedule not found: "${error.scheduleName}" for agent "${error.agentName}"`
    );
    if (error.availableSchedules?.length) {
      console.error(`  Available: ${error.availableSchedules.join(", ")}`);
    }
  } else if (isInvalidStateError(error)) {
    console.error(`Invalid state for operation: ${error.operation}`);
    console.error(`  Current state: ${error.currentState}`);
    const expected = Array.isArray(error.expectedState)
      ? error.expectedState.join(" or ")
      : error.expectedState;
    console.error(`  Required state: ${expected}`);
  } else if (isConcurrencyLimitError(error)) {
    console.error(`Agent "${error.agentName}" at capacity`);
    console.error(`  Running: ${error.currentJobs}/${error.limit}`);
  } else if (isJobCancelError(error)) {
    console.error(`Failed to cancel job "${error.jobId}"`);
    console.error(`  Reason: ${error.reason}`);
  } else if (isJobForkError(error)) {
    console.error(`Failed to fork job "${error.originalJobId}"`);
    console.error(`  Reason: ${error.reason}`);
  } else if (isFleetManagerError(error)) {
    // Catch-all for other FleetManager errors
    console.error(`Fleet error [${error.code}]: ${error.message}`);
  } else if (error instanceof Error) {
    // Generic error
    console.error("Unexpected error:", error.message);
  } else {
    // Non-Error thrown
    console.error("Unknown error:", error);
  }
}

// =============================================================================
// Pattern: Error Code Switching
// =============================================================================

/**
 * Handle errors by error code for programmatic decisions
 */
function handleByErrorCode(error: unknown): void {
  if (!isFleetManagerError(error)) {
    throw error; // Re-throw non-FleetManager errors
  }

  switch (error.code) {
    case FleetManagerErrorCode.CONFIGURATION_ERROR:
    case FleetManagerErrorCode.CONFIG_LOAD_ERROR:
      console.error("Fix your configuration file.");
      break;

    case FleetManagerErrorCode.AGENT_NOT_FOUND:
    case FleetManagerErrorCode.JOB_NOT_FOUND:
    case FleetManagerErrorCode.SCHEDULE_NOT_FOUND:
      console.error("Resource not found:", error.message);
      break;

    case FleetManagerErrorCode.INVALID_STATE:
      console.error("Invalid operation for current state.");
      break;

    case FleetManagerErrorCode.CONCURRENCY_LIMIT:
      console.error("At capacity - wait or bypass limit.");
      break;

    case FleetManagerErrorCode.SHUTDOWN_ERROR:
      console.error("Shutdown failed - may need force stop.");
      break;

    case FleetManagerErrorCode.JOB_CANCEL_ERROR:
      console.error("Job cancellation failed.");
      break;

    case FleetManagerErrorCode.JOB_FORK_ERROR:
      console.error("Job forking failed.");
      break;

    default:
      console.error("Fleet error:", error.message);
  }
}

// =============================================================================
// Pattern: Retry with Exponential Backoff
// =============================================================================

interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
  shouldRetry: (error: unknown, attempt: number) => boolean;
}

function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  const jitter = cappedDelay * config.jitterFactor * Math.random();
  return Math.floor(cappedDelay + jitter);
}

async function withRetry<T>(fn: () => Promise<T>, config: RetryConfig): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!config.shouldRetry(error, attempt)) {
        throw error;
      }

      if (attempt < config.maxAttempts - 1) {
        const delay = calculateDelay(attempt, config);
        console.log(`Retry ${attempt + 1}/${config.maxAttempts} in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Check if an error is transient and safe to retry
 */
function isTransientError(error: unknown): boolean {
  // SDK streaming errors that are recoverable
  if (error instanceof SDKStreamingError) {
    return error.isRecoverable();
  }

  // SDK initialization network errors
  if (error instanceof SDKInitializationError) {
    return error.isNetworkError();
  }

  // Network error codes
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"].includes(code ?? "");
  }

  return false;
}

// =============================================================================
// Pattern: Circuit Breaker
// =============================================================================

class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: "closed" | "open" | "half-open" = "closed";

  constructor(
    private readonly threshold: number = 5,
    private readonly resetTimeMs: number = 60000
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should reset
    if (this.state === "open" && Date.now() - this.lastFailure > this.resetTimeMs) {
      this.state = "half-open";
    }

    // Fail fast if circuit is open
    if (this.state === "open") {
      throw new Error("Circuit breaker is open");
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();

    if (this.failures >= this.threshold) {
      this.state = "open";
      console.warn(`Circuit breaker opened after ${this.failures} failures`);
    }
  }

  getState(): string {
    return this.state;
  }
}

// =============================================================================
// Pattern: Safe Wrapper with Fallback
// =============================================================================

/**
 * Safely get agent info, returning null if not found
 */
async function getAgentInfoSafe(
  manager: FleetManager,
  agentName: string
): Promise<Awaited<ReturnType<FleetManager["getAgentInfoByName"]>> | null> {
  try {
    return await manager.getAgentInfoByName(agentName);
  } catch (error) {
    if (isAgentNotFoundError(error)) {
      return null; // Graceful fallback
    }
    throw error; // Re-throw unexpected errors
  }
}

// =============================================================================
// Pattern: Trigger with Wait for Capacity
// =============================================================================

/**
 * Trigger an agent, waiting for capacity if at limit
 */
async function triggerWithWait(
  manager: FleetManager,
  agentName: string,
  maxWaitMs = 60000
): Promise<TriggerResult> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      return await manager.trigger(agentName);
    } catch (error) {
      if (isConcurrencyLimitError(error)) {
        console.log(
          `Agent at capacity (${error.currentJobs}/${error.limit}), waiting...`
        );

        // Wait for a job to complete
        await new Promise<void>((resolve) => {
          const handler = (payload: JobCompletedPayload) => {
            if (payload.agentName === agentName) {
              manager.off("job:completed", handler);
              resolve();
            }
          };
          manager.on("job:completed", handler);

          // Timeout fallback
          setTimeout(() => {
            manager.off("job:completed", handler);
            resolve();
          }, 5000);
        });

        continue; // Retry trigger
      }
      throw error;
    }
  }

  throw new Error(`Timed out waiting for agent "${agentName}" capacity`);
}

// =============================================================================
// Pattern: Graceful Shutdown
// =============================================================================

async function gracefulShutdown(manager: FleetManager): Promise<void> {
  console.log("Initiating graceful shutdown...");

  try {
    // Try graceful first
    await manager.stop({ timeout: 30000 });
    console.log("Shutdown complete");
  } catch (error) {
    if (error instanceof FleetManagerShutdownError && error.isTimeout()) {
      console.warn("Graceful shutdown timed out, forcing...");

      try {
        await manager.stop({
          timeout: 10000,
          cancelOnTimeout: true,
          cancelTimeout: 5000,
        });
        console.log("Forced shutdown complete");
      } catch (forceError) {
        console.error("Forced shutdown failed:", forceError);
        process.exit(1);
      }
    } else {
      throw error;
    }
  }
}

// =============================================================================
// Pattern: Error-Resilient Event Handler Wrapper
// =============================================================================

/**
 * Wrap an event handler to prevent errors from propagating
 */
function safeHandler<T extends (...args: unknown[]) => unknown>(
  handler: T,
  name: string
): T {
  return ((...args: Parameters<T>) => {
    try {
      const result = handler(...args);
      if (result instanceof Promise) {
        return result.catch((error) => {
          console.error(`Handler "${name}" failed:`, error);
        });
      }
      return result;
    } catch (error) {
      console.error(`Handler "${name}" failed:`, error);
    }
  }) as T;
}

// =============================================================================
// Main Example
// =============================================================================

async function main() {
  // Create FleetManager
  const manager = new FleetManager({
    configPath: "./herdctl.yaml",
    stateDir: "./.herdctl",
  });

  // Wrap event handlers to prevent one failure from breaking others
  manager.on(
    "job:completed",
    safeHandler((payload) => {
      console.log(`Job ${payload.job.id} completed in ${payload.durationSeconds}s`);
    }, "completion-logger")
  );

  manager.on(
    "job:failed",
    safeHandler((payload) => {
      // Handle specific error types
      if (payload.error instanceof SDKInitializationError) {
        if (payload.error.isMissingApiKey()) {
          console.error("ERROR: Missing ANTHROPIC_API_KEY environment variable");
          console.error("  Set it with: export ANTHROPIC_API_KEY=sk-ant-...");
        } else if (payload.error.isNetworkError()) {
          console.error("ERROR: Network connection failed");
          console.error(`  Code: ${payload.error.code}`);
        }
      } else if (payload.error instanceof SDKStreamingError) {
        if (payload.error.isRateLimited()) {
          console.error("ERROR: API rate limited");
          console.error("  Wait before retrying.");
        } else if (payload.error.isRecoverable()) {
          console.log("Error is recoverable - consider auto-retry");
        }
      } else if (payload.error instanceof MalformedResponseError) {
        console.error("ERROR: SDK returned unexpected response format");
        if (payload.error.expected) {
          console.error(`  Expected: ${payload.error.expected}`);
        }
      } else {
        console.error(`Job ${payload.job.id} failed: ${payload.error.message}`);
      }
    }, "failure-handler")
  );

  // Circuit breaker for external notifications
  const notificationBreaker = new CircuitBreaker(3, 30000);

  manager.on(
    "job:completed",
    safeHandler(async (payload) => {
      try {
        await notificationBreaker.execute(async () => {
          // Simulate external notification
          console.log(`Would notify external service about job ${payload.job.id}`);
        });
      } catch {
        console.log(
          `Notification skipped (circuit: ${notificationBreaker.getState()})`
        );
      }
    }, "external-notifier")
  );

  try {
    // Initialize with error handling
    await manager.initialize();
    console.log(`Loaded ${manager.state.agentCount} agents`);

    // Start the fleet
    await manager.start();
    console.log("Fleet started");

    // Example: Safe agent lookup
    const agent = await getAgentInfoSafe(manager, "my-agent");
    if (agent) {
      console.log(`Found agent: ${agent.name} (${agent.status})`);
    } else {
      console.log("Agent 'my-agent' not configured");
    }

    // Example: Trigger with retry for transient errors
    // (commented out to not actually run)
    /*
    try {
      const result = await withRetry(
        () => manager.trigger('my-agent'),
        {
          maxAttempts: 3,
          baseDelayMs: 1000,
          maxDelayMs: 30000,
          jitterFactor: 0.1,
          shouldRetry: isTransientError,
        }
      );
      console.log(`Triggered job: ${result.jobId}`);
    } catch (error) {
      handleFleetManagerError(error);
    }
    */

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      console.log("\nReceived SIGINT");
      await gracefulShutdown(manager);
      process.exit(0);
    });

    console.log("\nFleet running. Press Ctrl+C to stop.");
    console.log("Error handling patterns demonstrated in code.");
  } catch (error) {
    // Handle startup errors
    handleFleetManagerError(error);
    process.exit(1);
  }
}

main();
