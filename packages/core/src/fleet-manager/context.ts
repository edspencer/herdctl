/**
 * FleetManager Context Module
 *
 * Provides a shared context interface that modules use to access FleetManager state.
 * This enables a cleaner composition pattern where modules receive the context once
 * at construction time rather than building dependency objects for each call.
 *
 * @module context
 */

import type { EventEmitter } from "node:events";
import type { ResolvedConfig } from "../config/index.js";
import type { StateDirectory } from "../state/index.js";
import type { Scheduler } from "../scheduler/index.js";
import type { FleetManagerLogger, FleetManagerStatus } from "./types.js";

/**
 * Context interface for FleetManager modules
 *
 * FleetManager implements this interface and passes itself to composed modules.
 * Modules can access current state through these getters without needing
 * individual dependency objects for each method call.
 */
export interface FleetManagerContext {
  /**
   * Get the current configuration (null if not initialized)
   */
  getConfig(): ResolvedConfig | null;

  /**
   * Get the state directory path
   */
  getStateDir(): string;

  /**
   * Get the state directory info (null if not initialized)
   */
  getStateDirInfo(): StateDirectory | null;

  /**
   * Get the logger instance
   */
  getLogger(): FleetManagerLogger;

  /**
   * Get the scheduler instance (null if not initialized)
   */
  getScheduler(): Scheduler | null;

  /**
   * Get the current fleet manager status
   */
  getStatus(): FleetManagerStatus;

  /**
   * Get timing information: when initialized
   */
  getInitializedAt(): string | null;

  /**
   * Get timing information: when started
   */
  getStartedAt(): string | null;

  /**
   * Get timing information: when stopped
   */
  getStoppedAt(): string | null;

  /**
   * Get the last error message
   */
  getLastError(): string | null;

  /**
   * Get the check interval in milliseconds
   */
  getCheckInterval(): number;

  /**
   * Emit an event
   */
  emit(event: string, ...args: unknown[]): boolean;

  /**
   * Get the event emitter (for subscribing to events in modules)
   */
  getEmitter(): EventEmitter;

  /**
   * Get the Discord manager instance (may return undefined if not initialized)
   */
  getDiscordManager?(): unknown;

  /**
   * Get the Slack manager instance (may return undefined if not initialized)
   */
  getSlackManager?(): unknown;
}
