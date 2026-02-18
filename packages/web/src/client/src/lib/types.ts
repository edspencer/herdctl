/**
 * Client-side type definitions for @herdctl/web
 *
 * These types mirror the server-side types from @herdctl/core but are defined
 * separately because the client cannot import from server packages.
 */

// =============================================================================
// Fleet Status Types
// =============================================================================

export type FleetState =
  | "uninitialized"
  | "initialized"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "error";

export type SchedulerStatus = "stopped" | "running" | "stopping";

export interface FleetCounts {
  totalAgents: number;
  runningAgents: number;
  idleAgents: number;
  errorAgents: number;
  totalJobs: number;
  runningJobs: number;
  completedJobs: number;
  failedJobs: number;
}

export interface SchedulerInfo {
  status: SchedulerStatus;
  checkCount: number;
  triggerCount: number;
  lastCheckAt: string | null;
  checkIntervalMs: number;
}

export interface FleetStatus {
  state: FleetState;
  uptimeSeconds: number | null;
  initializedAt: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  counts: FleetCounts;
  scheduler: SchedulerInfo;
}

// =============================================================================
// Agent Types
// =============================================================================

export type AgentStatus = "idle" | "running" | "error";

export type ScheduleType = "interval" | "cron" | "webhook" | "chat";

export type ScheduleStatus = "idle" | "running" | "disabled";

export interface ScheduleInfo {
  name: string;
  agentName: string;
  type: ScheduleType;
  interval?: string;
  cron?: string;
  status: ScheduleStatus;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
}

export type ChatConnectorType = "discord" | "slack" | "web";

export interface ChatConnectorInfo {
  type: ChatConnectorType;
  status: string;
}

export interface AgentInfo {
  name: string;
  description?: string;
  status: AgentStatus;
  currentJobId: string | null;
  lastJobId: string | null;
  maxConcurrent: number;
  runningCount: number;
  errorMessage: string | null;
  scheduleCount: number;
  schedules: ScheduleInfo[];
  model?: string;
  working_directory?: string;
  permission_mode?: string;
  chatConnectors: ChatConnectorInfo[];
}

// =============================================================================
// Job Types
// =============================================================================

export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type StreamType = "stdout" | "stderr";

export interface JobSummary {
  jobId: string;
  agentName: string;
  prompt: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number;
  error?: string;
}

// =============================================================================
// WebSocket Message Types (Client -> Server)
// =============================================================================

export interface SubscribeMessage {
  type: "subscribe";
  payload: {
    agentName: string;
  };
}

export interface UnsubscribeMessage {
  type: "unsubscribe";
  payload: {
    agentName: string;
  };
}

export interface PingMessage {
  type: "ping";
}

export type ClientMessage = SubscribeMessage | UnsubscribeMessage | PingMessage;

// =============================================================================
// WebSocket Message Types (Server -> Client)
// =============================================================================

export interface FleetStatusMessage {
  type: "fleet:status";
  payload: FleetStatus;
}

export interface AgentStartedPayload {
  agent: AgentInfo;
}

export interface AgentStoppedPayload {
  agentName: string;
  reason: string;
}

export interface AgentUpdatedMessage {
  type: "agent:updated";
  payload: AgentStartedPayload | AgentStoppedPayload;
}

export interface JobCreatedPayload {
  agentName: string;
  jobId: string;
  prompt: string;
}

export interface JobCreatedMessage {
  type: "job:created";
  payload: JobCreatedPayload;
}

export interface JobOutputPayload {
  agentName: string;
  jobId: string;
  data: string;
  stream: StreamType;
}

export interface JobOutputMessage {
  type: "job:output";
  payload: JobOutputPayload;
}

export interface JobCompletedPayload {
  agentName: string;
  jobId: string;
  exitCode: number;
}

export interface JobCompletedMessage {
  type: "job:completed";
  payload: JobCompletedPayload;
}

export interface JobFailedPayload {
  agentName: string;
  jobId: string;
  error: string;
}

export interface JobFailedMessage {
  type: "job:failed";
  payload: JobFailedPayload;
}

export interface JobCancelledPayload {
  agentName: string;
  jobId: string;
  reason: string;
}

export interface JobCancelledMessage {
  type: "job:cancelled";
  payload: JobCancelledPayload;
}

export interface ScheduleTriggeredPayload {
  agentName: string;
  scheduleName: string;
  jobId: string;
}

export interface ScheduleTriggeredMessage {
  type: "schedule:triggered";
  payload: ScheduleTriggeredPayload;
}

export interface PongMessage {
  type: "pong";
}

export type ServerMessage =
  | FleetStatusMessage
  | AgentUpdatedMessage
  | JobCreatedMessage
  | JobOutputMessage
  | JobCompletedMessage
  | JobFailedMessage
  | JobCancelledMessage
  | ScheduleTriggeredMessage
  | PongMessage;

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a payload is AgentStartedPayload (has `agent` property)
 */
export function isAgentStartedPayload(
  payload: AgentStartedPayload | AgentStoppedPayload
): payload is AgentStartedPayload {
  return "agent" in payload;
}

/**
 * Check if a payload is AgentStoppedPayload (has `agentName` but no `agent`)
 */
export function isAgentStoppedPayload(
  payload: AgentStartedPayload | AgentStoppedPayload
): payload is AgentStoppedPayload {
  return "agentName" in payload && !("agent" in payload);
}

// =============================================================================
// Connection Status
// =============================================================================

export type ConnectionStatus = "connected" | "disconnected" | "reconnecting";

// =============================================================================
// UI State Types
// =============================================================================

export type Theme = "light" | "dark" | "system";

export type ActiveView = "dashboard" | "agents" | "jobs" | "schedules" | "settings";
