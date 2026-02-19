/**
 * Webhook Hook Runner
 *
 * POSTs HookContext JSON to a configured URL.
 * Used for integrating with external services (monitoring, ticketing, dashboards).
 */

import type { HookContext, HookResult, WebhookHookConfigInput } from "../types.js";

/**
 * Default timeout for webhook hooks in milliseconds
 */
const DEFAULT_TIMEOUT = 10000;

/**
 * Logger interface for WebhookHookRunner
 */
export interface WebhookHookRunnerLogger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

/**
 * Options for WebhookHookRunner
 */
export interface WebhookHookRunnerOptions {
  /**
   * Logger for hook execution output
   */
  logger?: WebhookHookRunnerLogger;

  /**
   * Custom fetch implementation (for testing)
   */
  fetch?: typeof globalThis.fetch;
}

/**
 * Substitutes ${ENV_VAR} patterns in a string with environment variable values
 *
 * @param value - String potentially containing ${ENV_VAR} patterns
 * @returns String with environment variables substituted
 */
function substituteEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, envVar) => {
    const envValue = process.env[envVar];
    if (envValue === undefined) {
      // Return empty string for undefined env vars (silent failure)
      return "";
    }
    return envValue;
  });
}

/**
 * WebhookHookRunner POSTs HookContext JSON to a URL
 *
 * @example
 * ```typescript
 * const runner = new WebhookHookRunner({ logger: console });
 *
 * const result = await runner.execute(
 *   {
 *     type: 'webhook',
 *     url: 'https://api.example.com/hooks/job-complete',
 *     headers: { 'Authorization': 'Bearer ${API_TOKEN}' }
 *   },
 *   hookContext
 * );
 *
 * if (result.success) {
 *   console.log('Webhook delivered successfully');
 * } else {
 *   console.error('Webhook failed:', result.error);
 * }
 * ```
 */
export class WebhookHookRunner {
  private logger: WebhookHookRunnerLogger;
  private fetchFn: typeof globalThis.fetch;

  constructor(options: WebhookHookRunnerOptions = {}) {
    this.logger = options.logger ?? {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    this.fetchFn = options.fetch ?? globalThis.fetch;
  }

  /**
   * Execute a webhook hook with the given context
   *
   * @param config - Webhook hook configuration (accepts input type with optional fields)
   * @param context - Hook context to send in the request body
   * @returns Promise resolving to the hook result
   */
  async execute(config: WebhookHookConfigInput, context: HookContext): Promise<HookResult> {
    const startTime = Date.now();
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;
    const method = config.method ?? "POST";

    this.logger.debug(`Executing webhook hook: ${method} ${config.url}`);

    try {
      // Build headers with Content-Type and custom headers
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Add custom headers with env var substitution
      if (config.headers) {
        for (const [key, value] of Object.entries(config.headers)) {
          headers[key] = substituteEnvVars(value);
        }
      }

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await this.fetchFn(config.url, {
          method,
          headers,
          body: JSON.stringify(context),
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
            `Webhook hook completed successfully in ${durationMs}ms: ${method} ${config.url} (${response.status})`,
          );
          return {
            success: true,
            hookType: "webhook",
            durationMs,
            output: responseBody,
          };
        } else {
          this.logger.warn(
            `Webhook hook failed with status ${response.status}: ${method} ${config.url}`,
          );
          return {
            success: false,
            hookType: "webhook",
            durationMs,
            error: `HTTP ${response.status}: ${response.statusText}${responseBody ? ` - ${responseBody}` : ""}`,
            output: responseBody,
          };
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);

        const durationMs = Date.now() - startTime;

        // Handle abort (timeout)
        if (fetchError instanceof Error && fetchError.name === "AbortError") {
          this.logger.error(`Webhook hook timed out after ${timeout}ms: ${method} ${config.url}`);
          return {
            success: false,
            hookType: "webhook",
            durationMs,
            error: `Webhook timed out after ${timeout}ms`,
          };
        }

        // Handle other fetch errors (network errors, etc.)
        const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
        this.logger.error(`Webhook hook error: ${errorMessage}`);
        return {
          success: false,
          hookType: "webhook",
          durationMs,
          error: errorMessage,
        };
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(`Webhook hook error: ${errorMessage}`);

      return {
        success: false,
        hookType: "webhook",
        durationMs,
        error: errorMessage,
      };
    }
  }
}
