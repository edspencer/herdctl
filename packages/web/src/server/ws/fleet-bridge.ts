/**
 * Fleet Bridge - Connects FleetManager events to WebSocket broadcasts
 *
 * This module subscribes to FleetManager events and broadcasts them to
 * connected WebSocket clients. It handles event filtering so that high-volume
 * events like job:output are only sent to subscribed clients.
 */

import {
  createLogger,
  type FleetManager,
  type AgentStartedPayload,
  type AgentStoppedPayload,
  type JobCreatedPayload,
  type JobOutputPayload,
  type JobCompletedPayload,
  type JobFailedPayload,
  type JobCancelledPayload,
  type ScheduleTriggeredPayload,
} from "@herdctl/core";
import type { WebSocketHandler } from "./handler.js";

const logger = createLogger("web:ws");

/**
 * FleetBridge connects FleetManager events to WebSocket clients
 */
export class FleetBridge {
  private fleetManager: FleetManager;
  private wsHandler: WebSocketHandler;
  private isStarted = false;

  // Store bound handlers so we can remove them later
  private handlers = {
    agentStarted: this.onAgentStarted.bind(this),
    agentStopped: this.onAgentStopped.bind(this),
    jobCreated: this.onJobCreated.bind(this),
    jobOutput: this.onJobOutput.bind(this),
    jobCompleted: this.onJobCompleted.bind(this),
    jobFailed: this.onJobFailed.bind(this),
    jobCancelled: this.onJobCancelled.bind(this),
    scheduleTriggered: this.onScheduleTriggered.bind(this),
  };

  constructor(fleetManager: FleetManager, wsHandler: WebSocketHandler) {
    this.fleetManager = fleetManager;
    this.wsHandler = wsHandler;
  }

  /**
   * Start listening to FleetManager events and broadcasting to WebSocket clients
   */
  start(): void {
    if (this.isStarted) {
      logger.debug("FleetBridge already started");
      return;
    }

    logger.debug("Starting FleetBridge event listeners");

    // Subscribe to FleetManager events
    this.fleetManager.on("agent:started", this.handlers.agentStarted);
    this.fleetManager.on("agent:stopped", this.handlers.agentStopped);
    this.fleetManager.on("job:created", this.handlers.jobCreated);
    this.fleetManager.on("job:output", this.handlers.jobOutput);
    this.fleetManager.on("job:completed", this.handlers.jobCompleted);
    this.fleetManager.on("job:failed", this.handlers.jobFailed);
    this.fleetManager.on("job:cancelled", this.handlers.jobCancelled);
    this.fleetManager.on("schedule:triggered", this.handlers.scheduleTriggered);

    this.isStarted = true;
    logger.info("FleetBridge started - broadcasting events to WebSocket clients");
  }

  /**
   * Stop listening to FleetManager events
   */
  stop(): void {
    if (!this.isStarted) {
      logger.debug("FleetBridge not started");
      return;
    }

    logger.debug("Stopping FleetBridge event listeners");

    // Unsubscribe from FleetManager events
    this.fleetManager.off("agent:started", this.handlers.agentStarted);
    this.fleetManager.off("agent:stopped", this.handlers.agentStopped);
    this.fleetManager.off("job:created", this.handlers.jobCreated);
    this.fleetManager.off("job:output", this.handlers.jobOutput);
    this.fleetManager.off("job:completed", this.handlers.jobCompleted);
    this.fleetManager.off("job:failed", this.handlers.jobFailed);
    this.fleetManager.off("job:cancelled", this.handlers.jobCancelled);
    this.fleetManager.off("schedule:triggered", this.handlers.scheduleTriggered);

    this.isStarted = false;
    logger.info("FleetBridge stopped");
  }

  /**
   * Check if the bridge is currently running
   */
  isRunning(): boolean {
    return this.isStarted;
  }

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  /**
   * Handle agent:started event
   *
   * Broadcast to ALL clients (low volume event)
   */
  private onAgentStarted(payload: AgentStartedPayload): void {
    logger.debug(`Broadcasting agent:started for ${payload.agent.name}`);
    this.wsHandler.broadcast({
      type: "agent:updated",
      payload,
    });
  }

  /**
   * Handle agent:stopped event
   *
   * Broadcast to ALL clients (low volume event)
   */
  private onAgentStopped(payload: AgentStoppedPayload): void {
    logger.debug(`Broadcasting agent:stopped for ${payload.agentName}`);
    this.wsHandler.broadcast({
      type: "agent:updated",
      payload,
    });
  }

  /**
   * Handle job:created event
   *
   * Broadcast to ALL clients (low volume event)
   */
  private onJobCreated(payload: JobCreatedPayload): void {
    logger.debug(`Broadcasting job:created for job ${payload.job.id} (agent: ${payload.agentName})`);
    this.wsHandler.broadcast({
      type: "job:created",
      payload,
    });
  }

  /**
   * Handle job:output event
   *
   * Broadcast ONLY to clients subscribed to this agent (high volume event)
   */
  private onJobOutput(payload: JobOutputPayload): void {
    // Only log at debug level since this can be very high volume
    const subscriberCount = this.wsHandler.getSubscriberCount(payload.agentName);
    if (subscriberCount > 0) {
      logger.debug(`Broadcasting job:output for job ${payload.jobId} to ${subscriberCount} subscribers`);
      this.wsHandler.broadcastToSubscribers(payload.agentName, {
        type: "job:output",
        payload,
      });
    }
  }

  /**
   * Handle job:completed event
   *
   * Broadcast to ALL clients (low volume event)
   */
  private onJobCompleted(payload: JobCompletedPayload): void {
    logger.debug(`Broadcasting job:completed for job ${payload.job.id} (agent: ${payload.agentName})`);
    this.wsHandler.broadcast({
      type: "job:completed",
      payload,
    });
  }

  /**
   * Handle job:failed event
   *
   * Broadcast to ALL clients (low volume event)
   */
  private onJobFailed(payload: JobFailedPayload): void {
    logger.debug(`Broadcasting job:failed for job ${payload.job.id} (agent: ${payload.agentName})`);
    this.wsHandler.broadcast({
      type: "job:failed",
      payload,
    });
  }

  /**
   * Handle job:cancelled event
   *
   * Broadcast to ALL clients (low volume event)
   */
  private onJobCancelled(payload: JobCancelledPayload): void {
    logger.debug(`Broadcasting job:cancelled for job ${payload.job.id} (agent: ${payload.agentName})`);
    this.wsHandler.broadcast({
      type: "job:cancelled",
      payload,
    });
  }

  /**
   * Handle schedule:triggered event
   *
   * Broadcast to ALL clients (low volume event)
   */
  private onScheduleTriggered(payload: ScheduleTriggeredPayload): void {
    logger.debug(`Broadcasting schedule:triggered for ${payload.agentName}/${payload.scheduleName}`);
    this.wsHandler.broadcast({
      type: "schedule:triggered",
      payload,
    });
  }
}
