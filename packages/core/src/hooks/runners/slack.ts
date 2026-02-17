/**
 * Slack Hook Runner
 *
 * Posts job notifications to a Slack channel using rich message formatting.
 * Used for team visibility into fleet activity.
 */

import type { HookContext, HookResult, SlackHookConfigInput } from "../types.js";

/**
 * Default timeout for Slack API requests in milliseconds
 */
const DEFAULT_TIMEOUT = 10000;

/**
 * Maximum output length for message text (Slack limit: ~40K, practical: 4000)
 */
const MAX_TEXT_LENGTH = 3500;

/**
 * Maximum length for attachment fields
 */
const MAX_FIELD_LENGTH = 900;

/**
 * Colors for different event types
 */
const EVENT_COLORS = {
  completed: "#22c55e", // green
  failed: "#ef4444", // red
  timeout: "#f59e0b", // amber
  cancelled: "#6b7280", // gray
} as const;

/**
 * Logger interface for SlackHookRunner
 */
export interface SlackHookRunnerLogger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

/**
 * Options for SlackHookRunner
 */
export interface SlackHookRunnerOptions {
  /**
   * Logger for hook execution output
   */
  logger?: SlackHookRunnerLogger;

  /**
   * Custom fetch implementation (for testing)
   */
  fetch?: typeof globalThis.fetch;
}

/**
 * Slack attachment field
 */
interface SlackField {
  title: string;
  value: string;
  short?: boolean;
}

/**
 * Slack attachment structure
 */
interface SlackAttachment {
  color: string;
  fallback: string;
  title: string;
  text?: string;
  fields: SlackField[];
  footer: string;
  ts: number;
}

/**
 * Slack message payload for API
 */
interface SlackMessagePayload {
  channel: string;
  attachments: SlackAttachment[];
}

/**
 * Truncates a string to a maximum length, adding ellipsis if truncated
 */
function truncateOutput(output: string, maxLength: number): string {
  if (output.length <= maxLength) {
    return output;
  }
  return output.slice(0, maxLength - 3) + "...";
}

/**
 * Formats duration in milliseconds to a human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Gets the title for the event
 */
function getEventTitle(event: HookContext["event"]): string {
  switch (event) {
    case "completed":
      return "Job Completed";
    case "failed":
      return "Job Failed";
    case "timeout":
      return "Job Timed Out";
    case "cancelled":
      return "Job Cancelled";
    default:
      return "Job Event";
  }
}

/**
 * Gets the fallback text for the event (plain text for notifications)
 */
function getEventFallback(event: HookContext["event"], agentName: string): string {
  switch (event) {
    case "completed":
      return `Job completed for ${agentName}`;
    case "failed":
      return `Job failed for ${agentName}`;
    case "timeout":
      return `Job timed out for ${agentName}`;
    case "cancelled":
      return `Job cancelled for ${agentName}`;
    default:
      return `Job event for ${agentName}`;
  }
}

/**
 * Builds a Slack attachment from the hook context
 */
function buildAttachment(context: HookContext): SlackAttachment {
  const agentName = context.agent.name || context.agent.id;

  const fields: SlackField[] = [
    {
      title: "Agent",
      value: agentName,
      short: true,
    },
    {
      title: "Job ID",
      value: `\`${context.job.id}\``,
      short: true,
    },
    {
      title: "Duration",
      value: formatDuration(context.job.durationMs),
      short: true,
    },
  ];

  // Add schedule name if present
  if (context.job.scheduleName) {
    fields.push({
      title: "Schedule",
      value: context.job.scheduleName,
      short: true,
    });
  }

  // Add error message if present
  if (context.result.error) {
    fields.push({
      title: "Error",
      value: `\`\`\`${truncateOutput(context.result.error, MAX_FIELD_LENGTH)}\`\`\``,
      short: false,
    });
  }

  // Add metadata JSON if present
  if (context.metadata && Object.keys(context.metadata).length > 0) {
    fields.push({
      title: "Metadata",
      value: `\`\`\`${truncateOutput(JSON.stringify(context.metadata, null, 2), MAX_FIELD_LENGTH)}\`\`\``,
      short: false,
    });
  }

  // Build the attachment with output in text field
  const output = context.result.output.trim();
  let text: string | undefined;
  if (output && output.length > 0) {
    text = truncateOutput(output, MAX_TEXT_LENGTH);
  }

  return {
    color: EVENT_COLORS[context.event] ?? EVENT_COLORS.completed,
    fallback: getEventFallback(context.event, agentName),
    title: getEventTitle(context.event),
    text,
    fields,
    footer: "herdctl",
    ts: Math.floor(new Date(context.job.completedAt).getTime() / 1000),
  };
}

/**
 * SlackHookRunner posts job notifications to a Slack channel
 *
 * Uses the Slack Web API (chat.postMessage) with attachments for rich formatting.
 *
 * @example
 * ```typescript
 * const runner = new SlackHookRunner({ logger: console });
 *
 * const result = await runner.execute(
 *   {
 *     type: 'slack',
 *     channel_id: 'C1234567890',
 *     bot_token_env: 'SLACK_BOT_TOKEN'
 *   },
 *   hookContext
 * );
 * ```
 */
export class SlackHookRunner {
  private logger: SlackHookRunnerLogger;
  private fetchFn: typeof globalThis.fetch;

  constructor(options: SlackHookRunnerOptions = {}) {
    this.logger = options.logger ?? {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    this.fetchFn = options.fetch ?? globalThis.fetch;
  }

  /**
   * Execute a Slack hook with the given context
   *
   * @param config - Slack hook configuration
   * @param context - Hook context to send in the notification
   * @returns Promise resolving to the hook result
   */
  async execute(config: SlackHookConfigInput, context: HookContext): Promise<HookResult> {
    const startTime = Date.now();

    this.logger.debug(`Executing Slack hook for channel: ${config.channel_id}`);

    // Read bot token from environment variable
    const tokenEnv = config.bot_token_env ?? "SLACK_BOT_TOKEN";
    const botToken = process.env[tokenEnv];
    if (!botToken) {
      const durationMs = Date.now() - startTime;
      const errorMessage = `Slack bot token not found in environment variable: ${tokenEnv}`;
      this.logger.error(errorMessage);
      return {
        success: false,
        hookType: "slack",
        durationMs,
        error: errorMessage,
      };
    }

    try {
      // Build the Slack attachment
      const attachment = buildAttachment(context);
      const payload: SlackMessagePayload = {
        channel: config.channel_id,
        attachments: [attachment],
      };

      // Slack Web API endpoint for posting messages
      const url = "https://slack.com/api/chat.postMessage";

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

      try {
        const response = await this.fetchFn(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            Authorization: `Bearer ${botToken}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const durationMs = Date.now() - startTime;

        // Read response body
        let responseBody: string | undefined;
        try {
          responseBody = await response.text();
        } catch {
          // Ignore response body read errors
        }

        // Slack API always returns 200 with ok: true/false in body
        if (response.ok && responseBody) {
          try {
            const json = JSON.parse(responseBody);
            if (json.ok) {
              this.logger.info(
                `Slack hook completed successfully in ${durationMs}ms: channel ${config.channel_id}`
              );
              return {
                success: true,
                hookType: "slack",
                durationMs,
                output: responseBody,
              };
            } else {
              // Slack API error (ok: false)
              const errorDetail = `Slack API error: ${json.error || "unknown"}`;
              this.logger.warn(`Slack hook failed: ${errorDetail}`);
              return {
                success: false,
                hookType: "slack",
                durationMs,
                error: errorDetail,
                output: responseBody,
              };
            }
          } catch {
            // JSON parse error
            const errorDetail = `Failed to parse Slack API response`;
            this.logger.warn(`Slack hook failed: ${errorDetail}`);
            return {
              success: false,
              hookType: "slack",
              durationMs,
              error: errorDetail,
              output: responseBody,
            };
          }
        } else {
          // HTTP error
          const errorDetail = `HTTP ${response.status}: ${response.statusText}`;
          this.logger.warn(`Slack hook failed with status ${response.status}: ${errorDetail}`);
          return {
            success: false,
            hookType: "slack",
            durationMs,
            error: errorDetail,
            output: responseBody,
          };
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);

        const durationMs = Date.now() - startTime;

        // Handle abort (timeout)
        if (fetchError instanceof Error && fetchError.name === "AbortError") {
          this.logger.error(`Slack hook timed out after ${DEFAULT_TIMEOUT}ms`);
          return {
            success: false,
            hookType: "slack",
            durationMs,
            error: `Slack hook timed out after ${DEFAULT_TIMEOUT}ms`,
          };
        }

        // Handle other fetch errors (network errors, etc.)
        const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
        this.logger.error(`Slack hook error: ${errorMessage}`);
        return {
          success: false,
          hookType: "slack",
          durationMs,
          error: errorMessage,
        };
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(`Slack hook error: ${errorMessage}`);

      return {
        success: false,
        hookType: "slack",
        durationMs,
        error: errorMessage,
      };
    }
  }
}
