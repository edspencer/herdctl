/**
 * Discord Hook Runner
 *
 * Posts job notifications to a Discord channel using embeds.
 * Used for team visibility into fleet activity.
 */

import type { HookContext, HookResult, DiscordHookConfigInput } from "../types.js";

/**
 * Default timeout for Discord API requests in milliseconds
 */
const DEFAULT_TIMEOUT = 10000;

/**
 * Maximum output length for embed description (Discord limit: 4096 chars)
 */
const MAX_DESCRIPTION_LENGTH = 4096;

/**
 * Maximum length for embed field values (Discord limit: 1024 chars)
 * Used for metadata and error fields
 */
const MAX_FIELD_LENGTH = 900; // Leave room for code fence markers

/**
 * Embed colors for different event types
 */
const EMBED_COLORS = {
  completed: 0x22c55e, // green
  failed: 0xef4444, // red
  timeout: 0xf59e0b, // amber
  cancelled: 0x6b7280, // gray
} as const;

/**
 * Logger interface for DiscordHookRunner
 */
export interface DiscordHookRunnerLogger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

/**
 * Options for DiscordHookRunner
 */
export interface DiscordHookRunnerOptions {
  /**
   * Logger for hook execution output
   */
  logger?: DiscordHookRunnerLogger;

  /**
   * Custom fetch implementation (for testing)
   */
  fetch?: typeof globalThis.fetch;
}

/**
 * Discord Embed structure for API
 */
interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  timestamp: string;
  footer?: {
    text: string;
  };
}

/**
 * Discord message payload for API
 */
interface DiscordMessagePayload {
  embeds: DiscordEmbed[];
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
 * Gets the title emoji and text for the event
 */
function getEventTitle(event: HookContext["event"]): string {
  switch (event) {
    case "completed":
      return "✅ Job Completed";
    case "failed":
      return "❌ Job Failed";
    case "timeout":
      return "⏱️ Job Timed Out";
    case "cancelled":
      return "🚫 Job Cancelled";
    default:
      return "📋 Job Event";
  }
}

/**
 * Builds a Discord embed from the hook context
 */
function buildEmbed(context: HookContext): DiscordEmbed {
  const fields: DiscordEmbed["fields"] = [
    {
      name: "Agent",
      value: context.agent.name || context.agent.id,
      inline: true,
    },
    {
      name: "Job ID",
      value: `\`${context.job.id}\``,
      inline: true,
    },
    {
      name: "Duration",
      value: formatDuration(context.job.durationMs),
      inline: true,
    },
  ];

  // Add schedule name if present
  if (context.job.scheduleName) {
    fields.push({
      name: "Schedule",
      value: context.job.scheduleName,
      inline: true,
    });
  }

  // Add error message if present (in a field since errors are usually short)
  if (context.result.error) {
    fields.push({
      name: "Error",
      value: `\`\`\`\n${truncateOutput(context.result.error, MAX_FIELD_LENGTH)}\n\`\`\``,
      inline: false,
    });
  }

  // Add metadata JSON if present (in a field)
  if (context.metadata && Object.keys(context.metadata).length > 0) {
    fields.push({
      name: "Metadata",
      value: `\`\`\`json\n${truncateOutput(JSON.stringify(context.metadata, null, 2), MAX_FIELD_LENGTH)}\n\`\`\``,
      inline: false,
    });
  }

  // Build the embed with output in description (allows up to 4096 chars)
  const output = context.result.output.trim();
  let description: string | undefined;
  if (output && output.length > 0) {
    description = truncateOutput(output, MAX_DESCRIPTION_LENGTH);
  }

  return {
    title: getEventTitle(context.event),
    description,
    color: EMBED_COLORS[context.event] ?? EMBED_COLORS.completed,
    fields,
    timestamp: context.job.completedAt,
    footer: {
      text: "herdctl",
    },
  };
}

/**
 * DiscordHookRunner posts job notifications to a Discord channel
 *
 * @example
 * ```typescript
 * const runner = new DiscordHookRunner({ logger: console });
 *
 * const result = await runner.execute(
 *   {
 *     type: 'discord',
 *     channel_id: '1234567890',
 *     bot_token_env: 'DISCORD_BOT_TOKEN'
 *   },
 *   hookContext
 * );
 *
 * if (result.success) {
 *   console.log('Discord notification sent');
 * } else {
 *   console.error('Discord notification failed:', result.error);
 * }
 * ```
 */
export class DiscordHookRunner {
  private logger: DiscordHookRunnerLogger;
  private fetchFn: typeof globalThis.fetch;

  constructor(options: DiscordHookRunnerOptions = {}) {
    this.logger = options.logger ?? {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    this.fetchFn = options.fetch ?? globalThis.fetch;
  }

  /**
   * Execute a Discord hook with the given context
   *
   * @param config - Discord hook configuration (accepts input type with optional fields)
   * @param context - Hook context to send in the notification
   * @returns Promise resolving to the hook result
   */
  async execute(config: DiscordHookConfigInput, context: HookContext): Promise<HookResult> {
    const startTime = Date.now();

    this.logger.debug(`Executing Discord hook for channel: ${config.channel_id}`);

    // Read bot token from environment variable
    const botToken = process.env[config.bot_token_env];
    if (!botToken) {
      const durationMs = Date.now() - startTime;
      const errorMessage = `Discord bot token not found in environment variable: ${config.bot_token_env}`;
      this.logger.error(errorMessage);
      return {
        success: false,
        hookType: "discord",
        durationMs,
        error: errorMessage,
      };
    }

    try {
      // Build the Discord embed
      const embed = buildEmbed(context);
      const payload: DiscordMessagePayload = {
        embeds: [embed],
      };

      // Discord API endpoint for posting messages
      const url = `https://discord.com/api/v10/channels/${config.channel_id}/messages`;

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

      try {
        const response = await this.fetchFn(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bot ${botToken}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const durationMs = Date.now() - startTime;

        // Read response body for logging/debugging
        let responseBody: string | undefined;
        try {
          responseBody = await response.text();
        } catch {
          // Ignore response body read errors
        }

        // 2xx status codes are success
        if (response.ok) {
          this.logger.info(
            `Discord hook completed successfully in ${durationMs}ms: channel ${config.channel_id} (${response.status})`
          );
          return {
            success: true,
            hookType: "discord",
            durationMs,
            output: responseBody,
          };
        } else {
          // Parse Discord API error
          let errorDetail = `HTTP ${response.status}: ${response.statusText}`;
          if (responseBody) {
            try {
              const errorJson = JSON.parse(responseBody);
              if (errorJson.message) {
                errorDetail = `Discord API error: ${errorJson.message} (code: ${errorJson.code || response.status})`;
              }
            } catch {
              errorDetail += ` - ${responseBody}`;
            }
          }

          this.logger.warn(`Discord hook failed with status ${response.status}: ${errorDetail}`);
          return {
            success: false,
            hookType: "discord",
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
          this.logger.error(`Discord hook timed out after ${DEFAULT_TIMEOUT}ms`);
          return {
            success: false,
            hookType: "discord",
            durationMs,
            error: `Discord hook timed out after ${DEFAULT_TIMEOUT}ms`,
          };
        }

        // Handle other fetch errors (network errors, etc.)
        const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
        this.logger.error(`Discord hook error: ${errorMessage}`);
        return {
          success: false,
          hookType: "discord",
          durationMs,
          error: errorMessage,
        };
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(`Discord hook error: ${errorMessage}`);

      return {
        success: false,
        hookType: "discord",
        durationMs,
        error: errorMessage,
      };
    }
  }
}
