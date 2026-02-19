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
import type {
  FleetManagerLogger,
  FleetManagerStatus,
  TriggerOptions,
  TriggerResult,
} from "./types.js";
import type { IChatManager } from "./chat-manager-interface.js";

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
   * Get a chat manager by platform name
   *
   * @param platform - Platform name (e.g., "discord", "slack")
   * @returns The chat manager for the platform, or undefined if not available
   */
  getChatManager?(platform: string): IChatManager | undefined;

  /**
   * Get all registered chat managers
   *
   * @returns Map of platform name to chat manager
   */
  getChatManagers?(): Map<string, IChatManager>;

  /**
   * Trigger an agent job
   *
   * This method is used by chat managers to execute agent jobs in response
   * to chat messages. It provides a clean interface that doesn't require
   * managers to cast the emitter unsafely.
   *
   * @param agentName - Name of the agent to trigger
   * @param scheduleName - Optional schedule name
   * @param options - Optional trigger options
   * @returns Promise resolving to the trigger result
   */
  trigger(
    agentName: string,
    scheduleName?: string,
    options?: TriggerOptions,
  ): Promise<TriggerResult>;
}
