/**
 * Runtime factory for creating runtime instances
 *
 * Creates appropriate runtime implementations based on agent configuration.
 * Supports SDK runtime, CLI runtime, and optional Docker containerization.
 */

import type { ResolvedAgent } from "../../config/index.js";
import { CLIRuntime } from "./cli-runtime.js";
import { ContainerRunner } from "./container-runner.js";
import { resolveDockerConfig } from "./docker-config.js";
import type { RuntimeInterface } from "./interface.js";
import { SDKRuntime } from "./sdk-runtime.js";

/**
 * Runtime type identifier
 *
 * - 'sdk': Claude Agent SDK runtime (default, standard pricing)
 * - 'cli': Claude CLI runtime (Max plan pricing)
 */
export type RuntimeType = "sdk" | "cli";

/**
 * Options for runtime factory
 */
export interface RuntimeFactoryOptions {
  /**
   * herdctl state directory (.herdctl/)
   *
   * Required when Docker is enabled to locate docker-sessions directory.
   * If not provided, defaults to '.herdctl' in current working directory.
   */
  stateDir?: string;
}

/**
 * Runtime factory for creating runtime instances
 *
 * This factory creates the appropriate runtime implementation based on
 * agent configuration. It provides a centralized point for runtime
 * instantiation and validation.
 *
 * When docker.enabled is true, the base runtime is wrapped with
 * ContainerRunner for Docker containerization.
 *
 * @example
 * ```typescript
 * // SDK runtime (default)
 * const runtime = RuntimeFactory.create(resolvedAgent);
 *
 * // CLI runtime with Docker
 * const dockerRuntime = RuntimeFactory.create(dockerAgent, {
 *   stateDir: '/path/to/.herdctl'
 * });
 * ```
 */
export class RuntimeFactory {
  /**
   * Create a runtime instance based on agent configuration
   *
   * Determines the runtime type from agent.runtime (defaults to 'sdk')
   * and wraps with ContainerRunner if agent.docker.enabled is true.
   *
   * @param agent - Resolved agent configuration
   * @param options - Factory options including stateDir for Docker
   * @returns Runtime implementation (possibly wrapped with ContainerRunner)
   * @throws Error if runtime type is unsupported or invalid
   */
  static create(agent: ResolvedAgent, options: RuntimeFactoryOptions = {}): RuntimeInterface {
    // Determine runtime type from agent config (default to SDK)
    const runtimeType: RuntimeType = (agent.runtime as RuntimeType) ?? "sdk";

    let runtime: RuntimeInterface;

    switch (runtimeType) {
      case "sdk":
        runtime = new SDKRuntime();
        break;

      case "cli":
        runtime = new CLIRuntime();
        break;

      default:
        throw new Error(
          `Unknown runtime type: ${runtimeType}. Supported types: 'sdk' (default), 'cli'`,
        );
    }

    // Wrap with ContainerRunner if Docker is enabled
    if (agent.docker?.enabled) {
      const dockerConfig = resolveDockerConfig(agent.docker);
      const stateDir = options.stateDir ?? `${process.cwd()}/.herdctl`;

      runtime = new ContainerRunner(runtime, dockerConfig, stateDir);
    }

    return runtime;
  }
}
