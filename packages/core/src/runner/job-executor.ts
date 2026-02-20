/**
 * Job executor for running agents with streaming output to job logs
 *
 * Manages the lifecycle of agent execution including:
 * - Creating job records before execution
 * - Streaming all SDK messages to job output in real-time
 * - Updating job status and metadata on completion
 */

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveWorkingDirectory } from "../fleet-manager/working-directory-helper.js";
import {
  appendJobOutput,
  clearSession,
  createJob,
  getJobOutputPath,
  getSessionInfo,
  isSessionExpiredError,
  isTokenExpiredError,
  type JobMetadata,
  type TriggerType,
  updateJob,
  updateSessionInfo,
  validateRuntimeContext,
  validateWorkingDirectory,
} from "../state/index.js";
import { createLogger } from "../utils/logger.js";
import {
  buildErrorMessage,
  classifyError,
  MalformedResponseError,
  type RunnerError,
  SDKInitializationError,
  SDKStreamingError,
  wrapError,
} from "./errors.js";
import { extractSummary, isTerminalMessage, processSDKMessage } from "./message-processor.js";
import type { RuntimeInterface } from "./runtime/index.js";
import type {
  ProcessedMessage,
  RunnerErrorDetails,
  RunnerOptionsWithCallbacks,
  RunnerResult,
  SDKMessage,
} from "./types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Logger interface for job executor
 */
export interface JobExecutorLogger {
  warn: (message: string) => void;
  error: (message: string) => void;
  info?: (message: string) => void;
  debug?: (message: string) => void;
}

/**
 * Options for job executor
 */
export interface JobExecutorOptions {
  /** Logger for warnings and errors */
  logger?: JobExecutorLogger;
}

/**
 * SDK query function type (for dependency injection)
 * @deprecated Use RuntimeInterface instead. This type is kept for test compatibility.
 */
export type SDKQueryFunction = (params: {
  prompt: string;
  options?: Record<string, unknown>;
  abortController?: AbortController;
}) => AsyncIterable<SDKMessage>;

// =============================================================================
// Default Logger
// =============================================================================

const defaultLogger: JobExecutorLogger = createLogger("JobExecutor");

// =============================================================================
// Job Executor Class
// =============================================================================

/**
 * Executes agents with streaming output to job logs
 *
 * This class manages the complete lifecycle of agent execution:
 * 1. Creates a job record before starting
 * 2. Updates job status to 'running'
 * 3. Streams all SDK messages to job output in real-time
 * 4. Updates job with final status on completion
 *
 * @example
 * ```typescript
 * const runtime = RuntimeFactory.create(agent);
 * const executor = new JobExecutor(runtime);
 *
 * const result = await executor.execute({
 *   agent: resolvedAgent,
 *   prompt: "Fix the bug in auth.ts",
 *   stateDir: "/path/to/.herdctl",
 *   triggerType: "manual",
 * });
 *
 * console.log(`Job ${result.jobId} completed: ${result.success}`);
 * ```
 */
export class JobExecutor {
  private runtime: RuntimeInterface;
  private logger: JobExecutorLogger;

  /**
   * Create a new job executor
   *
   * @param runtime - The runtime interface to use for agent execution
   * @param options - Optional configuration
   */
  constructor(runtime: RuntimeInterface, options: JobExecutorOptions = {}) {
    this.runtime = runtime;
    this.logger = options.logger ?? defaultLogger;
  }

  /**
   * Execute an agent and stream output to job log
   *
   * @param options - Runner options including agent config and prompt
   * @returns Result of the execution including job ID and status
   */
  async execute(options: RunnerOptionsWithCallbacks): Promise<RunnerResult> {
    const {
      agent,
      prompt,
      stateDir,
      triggerType,
      schedule,
      onMessage,
      onJobCreated,
      outputToFile,
    } = options;

    const jobsDir = join(stateDir, "jobs");
    let job: JobMetadata;
    let sessionId: string | undefined;
    let summary: string | undefined;
    let lastAssistantContent: string | undefined; // Track last assistant message for fallback summary
    let lastError: RunnerError | undefined;
    let errorDetails: RunnerErrorDetails | undefined;
    let messagesReceived = 0;
    let outputLogPath: string | undefined;

    // Determine trigger type: use 'fork' if forking, otherwise use provided or default to 'manual'
    const effectiveTriggerType: TriggerType = options.fork
      ? "fork"
      : ((triggerType ?? "manual") as TriggerType);

    // Step 1: Create job record
    try {
      job = await createJob(jobsDir, {
        agent: agent.name,
        trigger_type: effectiveTriggerType,
        prompt,
        schedule,
        forked_from: options.fork ? options.forkedFrom : undefined,
      });

      this.logger.info?.(`Created job ${job.id} for agent ${agent.name}`);

      // Notify caller of job ID immediately (before execution starts)
      if (onJobCreated) {
        onJobCreated(job.id);
      }
    } catch (error) {
      this.logger.error(`Failed to create job: ${(error as Error).message}`);
      throw error;
    }

    // Step 2: Setup output log file if outputToFile is enabled
    if (outputToFile) {
      try {
        const jobOutputDir = join(jobsDir, job.id);
        await mkdir(jobOutputDir, { recursive: true });
        outputLogPath = join(jobOutputDir, "output.log");
        this.logger.info?.(`Output logging enabled for job ${job.id} at ${outputLogPath}`);
      } catch (error) {
        this.logger.warn(`Failed to create job output directory: ${(error as Error).message}`);
        // Continue execution - output logging is optional
      }
    }

    // Step 3: Update job status to 'running'
    try {
      await updateJob(jobsDir, job.id, {
        status: "running",
      });
    } catch (error) {
      this.logger.warn(`Failed to update job status to running: ${(error as Error).message}`);
      // Continue execution - job was created
    }

    // Step 3.5: Validate session if resuming
    // This prevents unexpected logouts by checking session expiration before attempting resume
    // Pass timeout to getSessionInfo so expired sessions are automatically cleared (consistent with schedule-runner.ts)
    let effectiveResume: string | undefined;
    if (options.resume) {
      const sessionsDir = join(stateDir, "sessions");
      // Default to 24h if not configured - prevents unexpected logouts from expired server-side sessions
      const sessionTimeout = agent.session?.timeout ?? "24h";
      const existingSession = await getSessionInfo(sessionsDir, agent.name, {
        timeout: sessionTimeout,
        logger: this.logger,
        runtime: agent.runtime ?? "sdk", // Pass runtime for correct validation
      });

      if (existingSession?.session_id && existingSession.session_id !== options.resume) {
        // Caller provided a different session ID than what's stored on disk for this agent.
        // This happens with per-thread Slack sessions — the caller manages session IDs
        // externally and passes the correct one for this specific thread.
        // Trust the caller's session ID directly; the agent-level session is irrelevant.
        effectiveResume = options.resume;
        this.logger.debug?.(
          `Using caller-provided session for ${agent.name}: ${effectiveResume} (differs from agent-level session ${existingSession.session_id})`,
        );
      } else if (existingSession?.session_id) {
        // Caller's session matches the agent-level session — validate working dir and runtime
        const currentWorkingDirectory = resolveWorkingDirectory(agent);
        const wdValidation = validateWorkingDirectory(existingSession, currentWorkingDirectory);

        if (!wdValidation.valid) {
          this.logger.warn(
            `${wdValidation.message} - clearing stale session ${existingSession.session_id}`,
          );
          try {
            await clearSession(sessionsDir, agent.name);
          } catch (clearError) {
            this.logger.warn(`Failed to clear stale session: ${(clearError as Error).message}`);
          }
          // Continue without resume - working directory changed
          effectiveResume = undefined;
        } else {
          // Validate that the runtime context hasn't changed since the session was created
          // Sessions are tied to specific runtime configurations (SDK vs CLI, Docker vs native)
          const currentRuntimeType = (agent.runtime as "sdk" | "cli") ?? "sdk";
          const currentDockerEnabled = agent.docker?.enabled ?? false;
          const runtimeValidation = validateRuntimeContext(
            existingSession,
            currentRuntimeType,
            currentDockerEnabled,
          );

          if (!runtimeValidation.valid) {
            this.logger.warn(
              `${runtimeValidation.message} - clearing stale session ${existingSession.session_id}`,
            );
            try {
              await clearSession(sessionsDir, agent.name);
            } catch (clearError) {
              this.logger.warn(`Failed to clear stale session: ${(clearError as Error).message}`);
            }
            // Continue without resume - runtime context changed
            effectiveResume = undefined;
          } else {
            // Use the actual session ID from the stored session, not the original options.resume value
            // This ensures we always use the correct session ID stored on disk
            effectiveResume = existingSession.session_id;
            this.logger.info?.(
              `Found valid session for ${agent.name}: ${effectiveResume}, will attempt to resume`,
            );

            // Update last_used_at NOW to prevent session from expiring during long-running jobs
            // This fixes the authentication bug where sessions could expire mid-execution
            try {
              await updateSessionInfo(sessionsDir, agent.name, {
                session_id: existingSession.session_id,
                job_count: existingSession.job_count,
                mode: existingSession.mode,
                working_directory: currentWorkingDirectory,
                runtime_type: (agent.runtime as "sdk" | "cli") ?? "sdk",
                docker_enabled: agent.docker?.enabled ?? false,
              });
              this.logger.info?.(`Refreshed session timestamp for ${agent.name} before execution`);
            } catch (updateError) {
              this.logger.warn(
                `Failed to refresh session timestamp: ${(updateError as Error).message}`,
              );
              // Continue anyway - the session is still valid for now
            }
          }
        }
      } else {
        this.logger.info?.(
          `No valid session for ${agent.name} (expired or not found), starting fresh`,
        );

        // Write info to job output
        try {
          await appendJobOutput(jobsDir, job.id, {
            type: "system",
            content: `No valid session found (expired or missing). Starting fresh session.`,
          });
        } catch {
          // Ignore output write failures
        }

        // Don't resume - start fresh (effectiveResume stays undefined)
      }
    }

    // Step 4: Execute agent and stream output
    // Track whether we've already retried after a session expiration or token expiry
    let retriedAfterSessionExpiry = false;
    let retriedAfterTokenExpiry = false;

    const executeWithRetry = async (resumeSessionId: string | undefined): Promise<void> => {
      try {
        let messages: AsyncIterable<SDKMessage>;

        // Catch runtime initialization errors
        try {
          messages = this.runtime.execute({
            prompt,
            agent: options.agent,
            resume: resumeSessionId,
            fork: options.fork ? true : undefined,
            abortController: options.abortController,
            injectedMcpServers: options.injectedMcpServers,
          });
        } catch (initError) {
          // Wrap initialization errors with context
          throw new SDKInitializationError(
            buildErrorMessage((initError as Error).message, {
              jobId: job.id,
              agentName: agent.name,
            }),
            {
              jobId: job.id,
              agentName: agent.name,
              cause: initError as Error,
            },
          );
        }

        for await (const sdkMessage of messages) {
          messagesReceived++;

          // Process the message safely (handles malformed responses)
          let processed: ProcessedMessage | undefined;
          try {
            processed = processSDKMessage(sdkMessage);
          } catch (processError) {
            // Log but don't crash on malformed messages
            this.logger.warn(`Malformed SDK message received: ${(processError as Error).message}`);

            // Write a warning to job output
            try {
              await appendJobOutput(jobsDir, job.id, {
                type: "error",
                message: `Malformed SDK message: ${(processError as Error).message}`,
                code: "MALFORMED_MESSAGE",
              });
            } catch {
              // Ignore output write failures for malformed message warnings
            }

            // Continue processing other messages
            continue;
          }

          // Write to job output immediately (no buffering)
          try {
            await appendJobOutput(jobsDir, job.id, processed.output);
          } catch (outputError) {
            this.logger.warn(`Failed to write job output: ${(outputError as Error).message}`);
            // Continue processing - don't fail execution due to logging issues
          }

          // Also write to output.log file if outputToFile is enabled
          if (outputLogPath) {
            try {
              const logLine = this.formatOutputLogLine(processed.output);
              if (logLine) {
                await appendFile(outputLogPath, `${logLine}\n`, "utf-8");
              }
            } catch (fileError) {
              this.logger.warn(
                `Failed to write to output log file: ${(fileError as Error).message}`,
              );
              // Continue processing - file logging is optional
            }
          }

          // Log error messages to console immediately
          if (processed.output.type === "error") {
            this.logger.error(`Job ${job.id} error: ${processed.output.message}`);
          }

          // Extract session ID if present
          if (processed.sessionId) {
            sessionId = processed.sessionId;
          }

          // Track last non-partial assistant message content for fallback summary
          // This ensures we capture the final response even if it's long
          if (
            processed.output.type === "assistant" &&
            !processed.output.partial &&
            processed.output.content
          ) {
            lastAssistantContent = processed.output.content;
          }

          // Extract explicit summary if present (summary field or result message)
          // Only track explicit summaries here - assistant content is tracked above
          // Guard against null/undefined messages from malformed SDK responses
          if (sdkMessage && (sdkMessage.summary || sdkMessage.type === "result")) {
            const messageSummary = extractSummary(sdkMessage);
            if (messageSummary) {
              summary = messageSummary;
            }
          }

          // Call user's onMessage callback if provided
          if (onMessage) {
            try {
              await onMessage(sdkMessage);
            } catch (callbackError) {
              this.logger.warn(`onMessage callback error: ${(callbackError as Error).message}`);
            }
          }

          // Check for terminal messages
          if (isTerminalMessage(sdkMessage)) {
            if (sdkMessage.type === "error") {
              const errorMessage = (sdkMessage.message as string) ?? "Agent execution failed";
              lastError = new SDKStreamingError(
                buildErrorMessage(errorMessage, {
                  jobId: job.id,
                  agentName: agent.name,
                }),
                {
                  jobId: job.id,
                  agentName: agent.name,
                  code: sdkMessage.code as string | undefined,
                  messagesReceived,
                },
              );
            }
            break;
          }
        }
      } catch (error) {
        // Check if this is a session expiration error from the SDK
        // This can happen if the server-side session expired even though local validation passed
        if (
          isSessionExpiredError(error as Error) &&
          resumeSessionId &&
          !retriedAfterSessionExpiry
        ) {
          this.logger.warn(
            `Session expired on server for ${agent.name}. Clearing session and retrying with fresh session.`,
          );

          // Clear the expired session
          try {
            const sessionsDir = join(stateDir, "sessions");
            await clearSession(sessionsDir, agent.name);
            this.logger.info?.(`Cleared expired session for ${agent.name}`);
          } catch (clearError) {
            this.logger.warn(`Failed to clear expired session: ${(clearError as Error).message}`);
          }

          // Write info to job output about the retry
          try {
            await appendJobOutput(jobsDir, job.id, {
              type: "system",
              content: `Session expired on server. Retrying with fresh session.`,
            });
          } catch {
            // Ignore output write failures
          }

          // Retry with a fresh session (no resume)
          retriedAfterSessionExpiry = true;
          messagesReceived = 0; // Reset for fresh session
          await executeWithRetry(undefined);
          return;
        }

        // Check if this is an OAuth token expiry error
        // When the access token expires mid-session, retry triggers buildContainerEnv()
        // which reads the credentials file and refreshes the token automatically.
        if (isTokenExpiredError(error as Error) && !retriedAfterTokenExpiry) {
          this.logger.warn(`OAuth token expired for ${agent.name}. Retrying with fresh token.`);

          // Write info to job output about the retry
          try {
            await appendJobOutput(jobsDir, job.id, {
              type: "system",
              content: `OAuth token expired. Refreshing token and retrying.`,
            });
          } catch {
            // Ignore output write failures
          }

          // Retry — buildContainerEnv() will refresh the token from the credentials file
          retriedAfterTokenExpiry = true;
          messagesReceived = 0;
          await executeWithRetry(undefined);
          return;
        }

        // Wrap the error with context if not already a RunnerError
        lastError = wrapError(error, {
          jobId: job.id,
          agentName: agent.name,
          phase: messagesReceived === 0 ? "init" : "streaming",
        });

        // Add messages received count for streaming errors
        if (lastError instanceof SDKStreamingError && messagesReceived > 0) {
          (lastError as SDKStreamingError & { messagesReceived?: number }).messagesReceived =
            messagesReceived;
        }

        // Log the error with context
        this.logger.error(`${lastError.name}: ${lastError.message}`);

        // Write error to job output with full context
        try {
          await appendJobOutput(jobsDir, job.id, {
            type: "error",
            message: lastError.message,
            code:
              (lastError as SDKStreamingError).code ??
              (lastError.cause as NodeJS.ErrnoException)?.code,
            stack: lastError.stack,
          });
        } catch (outputError) {
          this.logger.warn(
            `Failed to write error to job output: ${(outputError as Error).message}`,
          );
        }
      }
    };

    await executeWithRetry(effectiveResume);

    // Build error details for programmatic access
    if (lastError) {
      errorDetails = {
        message: lastError.message,
        code:
          (lastError as SDKStreamingError).code ?? (lastError.cause as NodeJS.ErrnoException)?.code,
        stack: lastError.stack,
      };

      // Determine error type
      if (lastError instanceof SDKInitializationError) {
        errorDetails.type = "initialization";
        errorDetails.recoverable = lastError.isNetworkError();
      } else if (lastError instanceof SDKStreamingError) {
        errorDetails.type = "streaming";
        errorDetails.recoverable = lastError.isRecoverable();
        errorDetails.messagesReceived = lastError.messagesReceived;
      } else if (lastError instanceof MalformedResponseError) {
        errorDetails.type = "malformed_response";
        errorDetails.recoverable = false;
      } else {
        errorDetails.type = "unknown";
        errorDetails.recoverable = false;
      }
    }

    // Final summary logic:
    // 1. If an explicit summary was found (from summary field or result message), use it
    // 2. Otherwise, use the last assistant content
    // This ensures we capture the final response, not an early short message
    // Note: Truncation is handled by downstream consumers (e.g., Discord hook truncates to 4096)
    if (!summary && lastAssistantContent) {
      summary = lastAssistantContent;
    }

    // Step 5: Update job with final status
    const success = !lastError;
    const finishedAt = new Date().toISOString();

    // Determine exit reason based on error classification
    const exitReason = success ? "success" : classifyError(lastError!);

    try {
      await updateJob(jobsDir, job.id, {
        status: success ? "completed" : "failed",
        finished_at: finishedAt,
        session_id: sessionId,
        summary,
        exit_reason: exitReason,
        output_file: getJobOutputPath(jobsDir, job.id),
      });
    } catch (error) {
      this.logger.warn(`Failed to update job final status: ${(error as Error).message}`);
    }

    // Step 6: Persist session info for resume capability
    if (sessionId) {
      try {
        const sessionsDir = join(stateDir, "sessions");

        // Get existing session to determine if updating or creating
        const existingSession = await getSessionInfo(sessionsDir, agent.name, {
          runtime: agent.runtime ?? "sdk",
        });

        // Store the current working directory with the session
        const currentWorkingDirectory = resolveWorkingDirectory(agent);

        await updateSessionInfo(sessionsDir, agent.name, {
          session_id: sessionId,
          job_count: (existingSession?.job_count ?? 0) + 1,
          mode: existingSession?.mode ?? "autonomous",
          working_directory: currentWorkingDirectory,
          runtime_type: (agent.runtime as "sdk" | "cli") ?? "sdk",
          docker_enabled: agent.docker?.enabled ?? false,
        });

        this.logger.debug?.(`Persisted session ${sessionId} for agent ${agent.name}`);
      } catch (sessionError) {
        this.logger.warn(`Failed to persist session info: ${(sessionError as Error).message}`);
        // Continue - session persistence is non-fatal
      }
    }

    // Calculate duration
    const startTime = new Date(job.started_at).getTime();
    const endTime = new Date(finishedAt).getTime();
    const durationSeconds = Math.round((endTime - startTime) / 1000);

    return {
      success,
      jobId: job.id,
      sessionId,
      summary,
      error: lastError,
      errorDetails,
      durationSeconds,
    };
  }

  /**
   * Format a job output message as a human-readable log line
   *
   * Converts the structured JobOutputInput to a simple text format for the output.log file.
   *
   * @param output - The job output message to format
   * @returns Formatted log line, or null if message should not be logged
   */
  private formatOutputLogLine(output: {
    type: string;
    content?: string;
    message?: string;
    tool_name?: string;
    input?: unknown;
    result?: unknown;
    success?: boolean;
    [key: string]: unknown;
  }): string | null {
    const timestamp = new Date().toISOString();

    switch (output.type) {
      case "assistant":
        if (output.content) {
          return `[${timestamp}] [ASSISTANT] ${output.content}`;
        }
        break;

      case "tool_use":
        if (output.tool_name) {
          const inputStr = output.input ? ` ${JSON.stringify(output.input)}` : "";
          return `[${timestamp}] [TOOL] ${output.tool_name}${inputStr}`;
        }
        break;

      case "tool_result":
        if (output.result !== undefined) {
          const resultStr =
            typeof output.result === "string" ? output.result : JSON.stringify(output.result);
          const status = output.success === false ? "FAILED" : "OK";
          return `[${timestamp}] [TOOL_RESULT] (${status}) ${resultStr}`;
        }
        break;

      case "system":
        if (output.content || output.message) {
          return `[${timestamp}] [SYSTEM] ${output.content ?? output.message}`;
        }
        break;

      case "error":
        if (output.message || output.content) {
          return `[${timestamp}] [ERROR] ${output.message ?? output.content}`;
        }
        break;
    }

    return null;
  }
}

// =============================================================================
// Convenience Function
// =============================================================================

/**
 * Execute an agent with streaming output to job log
 *
 * This is a convenience function that creates a JobExecutor and runs
 * a single execution. For multiple executions, prefer creating a
 * JobExecutor instance directly.
 *
 * @param runtime - The runtime interface
 * @param options - Runner options including agent config and prompt
 * @param executorOptions - Optional executor configuration
 * @returns Result of the execution
 *
 * @example
 * ```typescript
 * import { RuntimeFactory } from "@herdctl/core";
 *
 * const runtime = RuntimeFactory.create(agent);
 * const result = await executeJob(runtime, {
 *   agent: resolvedAgent,
 *   prompt: "Fix the bug",
 *   stateDir: "/path/to/.herdctl",
 * });
 * ```
 */
export async function executeJob(
  runtime: RuntimeInterface,
  options: RunnerOptionsWithCallbacks,
  executorOptions: JobExecutorOptions = {},
): Promise<RunnerResult> {
  const executor = new JobExecutor(runtime, executorOptions);
  return executor.execute(options);
}
