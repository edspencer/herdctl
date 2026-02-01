/**
 * Runtime factory for creating runtime instances
 *
 * Creates appropriate runtime implementations based on agent configuration.
 * Currently supports SDK runtime (default) with CLI runtime coming in Phase 2.
 */

import type { ResolvedAgent } from "../../config/index.js";
import type { RuntimeInterface } from "./interface.js";
import { SDKRuntime } from "./sdk-runtime.js";
import { CLIRuntime } from "./cli-runtime.js";

/**
 * Runtime type identifier
 *
 * - 'sdk': Claude Agent SDK runtime (default, standard pricing)
 * - 'cli': Claude CLI runtime (Max plan pricing)
 */
export type RuntimeType = "sdk" | "cli";

/**
 * Runtime factory for creating runtime instances
 *
 * This factory creates the appropriate runtime implementation based on
 * agent configuration. It provides a centralized point for runtime
 * instantiation and validation.
 *
 * @example
 * ```typescript
 * const runtime = RuntimeFactory.create(resolvedAgent);
 * const messages = runtime.execute({
 *   prompt: "Fix the bug",
 *   agent: resolvedAgent,
 * });
 * ```
 */
export class RuntimeFactory {
  /**
   * Create a runtime instance based on agent configuration
   *
   * Determines the runtime type from agent.runtime (defaults to 'sdk')
   * and returns the appropriate runtime implementation.
   *
   * @param agent - Resolved agent configuration
   * @returns Runtime implementation
   * @throws Error if runtime type is unsupported or invalid
   */
  static create(agent: ResolvedAgent): RuntimeInterface {
    // Determine runtime type from agent config (default to SDK)
    const runtimeType: RuntimeType = (agent.runtime as RuntimeType) ?? "sdk";

    switch (runtimeType) {
      case "sdk":
        return new SDKRuntime();

      case "cli":
        return new CLIRuntime();

      default:
        throw new Error(
          `Unknown runtime type: ${runtimeType}. ` +
            "Supported types: 'sdk' (default), 'cli'"
        );
    }
  }
}
