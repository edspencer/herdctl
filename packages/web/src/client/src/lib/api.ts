/**
 * REST API client for @herdctl/web
 *
 * Provides typed functions for fetching data from the herdctl web server.
 * All functions throw on non-OK responses.
 */

import type {
  AgentInfo,
  CancelJobResult,
  ChatMessage,
  ChatSession,
  FleetStatus,
  ForkJobResult,
  JobSummary,
  ScheduleInfo,
  TriggerResult,
} from "./types";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Base URL for API requests. Defaults to current origin.
 * Can be overridden for development or testing.
 */
let baseUrl = typeof window !== "undefined" ? window.location.origin : "";

/**
 * Set the base URL for API requests
 */
export function setBaseUrl(url: string): void {
  baseUrl = url.replace(/\/$/, ""); // Remove trailing slash
}

/**
 * Get the current base URL
 */
export function getBaseUrl(): string {
  return baseUrl;
}

// =============================================================================
// Error Handling
// =============================================================================

/**
 * API error with response details
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly url: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Helper to handle fetch responses
 * Throws ApiError on non-OK responses
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `HTTP ${response.status}: ${response.statusText}`;

    // Try to extract error message from response body
    try {
      const body = await response.json();
      if (body.error) {
        message = body.error;
      } else if (body.message) {
        message = body.message;
      }
    } catch {
      // Ignore JSON parsing errors, use default message
    }

    throw new ApiError(message, response.status, response.statusText, response.url);
  }

  return response.json() as Promise<T>;
}

/**
 * Helper to make typed GET requests
 */
async function get<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(`${baseUrl}${path}`);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  return handleResponse<T>(response);
}

/**
 * Helper to make typed POST requests
 */
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  return handleResponse<T>(response);
}

/**
 * Helper to make typed DELETE requests
 */
async function del<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
    },
  });

  return handleResponse<T>(response);
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * Fetch the current fleet status
 *
 * GET /api/fleet/status
 */
export async function fetchFleetStatus(): Promise<FleetStatus> {
  return get<FleetStatus>("/api/fleet/status");
}

/**
 * Fetch all agents
 *
 * GET /api/agents
 */
export async function fetchAgents(): Promise<AgentInfo[]> {
  return get<AgentInfo[]>("/api/agents");
}

/**
 * Fetch a single agent by qualified name
 *
 * GET /api/agents/:name
 *
 * @param name - Agent qualified name (e.g., "herdctl.security-auditor") or local name
 */
export async function fetchAgent(name: string): Promise<AgentInfo> {
  return get<AgentInfo>(`/api/agents/${encodeURIComponent(name)}`);
}

/**
 * Parameters for fetching jobs
 */
export interface FetchJobsParams {
  /** Maximum number of jobs to return */
  limit?: number;
  /** Number of jobs to skip (for pagination) */
  offset?: number;
  /** Filter by agent qualified name (e.g., "herdctl.security-auditor") */
  agentName?: string;
  /** Filter by job status */
  status?: string;
}

/**
 * Paginated jobs response
 */
export interface PaginatedJobsResponse {
  jobs: JobSummary[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Fetch jobs with optional filtering and pagination
 *
 * GET /api/jobs
 */
export async function fetchJobs(params?: FetchJobsParams): Promise<PaginatedJobsResponse> {
  return get<PaginatedJobsResponse>("/api/jobs", params);
}

/**
 * Fetch a single job by ID
 *
 * GET /api/jobs/:id
 */
export async function fetchJobById(jobId: string): Promise<JobSummary> {
  return get<JobSummary>(`/api/jobs/${encodeURIComponent(jobId)}`);
}

/**
 * Cancel a running job
 *
 * POST /api/jobs/:id/cancel
 */
export async function cancelJob(jobId: string): Promise<CancelJobResult> {
  return post<CancelJobResult>(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {});
}

/**
 * Fork an existing job
 *
 * POST /api/jobs/:id/fork
 */
export async function forkJob(
  jobId: string,
  options?: { prompt?: string },
): Promise<ForkJobResult> {
  return post<ForkJobResult>(`/api/jobs/${encodeURIComponent(jobId)}/fork`, options ?? {});
}

/**
 * Fetch all schedules
 *
 * GET /api/schedules
 */
export async function fetchSchedules(): Promise<ScheduleInfo[]> {
  return get<ScheduleInfo[]>("/api/schedules");
}

/**
 * Trigger a job for an agent
 *
 * POST /api/agents/:name/trigger
 */
export async function triggerAgent(
  agentName: string,
  options?: { scheduleName?: string; prompt?: string },
): Promise<TriggerResult> {
  return post<TriggerResult>(`/api/agents/${encodeURIComponent(agentName)}/trigger`, options ?? {});
}

/**
 * Enable a schedule
 *
 * POST /api/schedules/:agentName/:scheduleName/enable
 */
export async function enableSchedule(
  agentName: string,
  scheduleName: string,
): Promise<ScheduleInfo> {
  return post<ScheduleInfo>(
    `/api/schedules/${encodeURIComponent(agentName)}/${encodeURIComponent(scheduleName)}/enable`,
    {},
  );
}

/**
 * Disable a schedule
 *
 * POST /api/schedules/:agentName/:scheduleName/disable
 */
export async function disableSchedule(
  agentName: string,
  scheduleName: string,
): Promise<ScheduleInfo> {
  return post<ScheduleInfo>(
    `/api/schedules/${encodeURIComponent(agentName)}/${encodeURIComponent(scheduleName)}/disable`,
    {},
  );
}

// =============================================================================
// Chat API Functions
// =============================================================================

/**
 * Chat session response from create/fetch
 */
export interface ChatSessionResponse {
  sessionId: string;
  createdAt: string;
}

/**
 * Full chat session detail response
 */
export interface ChatSessionDetailResponse {
  sessionId: string;
  messages: ChatMessage[];
  createdAt: string;
  lastMessageAt: string;
}

/**
 * Create a new chat session for an agent
 *
 * POST /api/chat/:agentName/sessions
 */
export async function createChatSession(agentName: string): Promise<ChatSessionResponse> {
  return post<ChatSessionResponse>(`/api/chat/${encodeURIComponent(agentName)}/sessions`, {});
}

/**
 * Fetch all chat sessions for an agent
 *
 * GET /api/chat/:agentName/sessions
 */
export async function fetchChatSessions(agentName: string): Promise<{ sessions: ChatSession[] }> {
  return get<{ sessions: ChatSession[] }>(`/api/chat/${encodeURIComponent(agentName)}/sessions`);
}

/**
 * Fetch a single chat session with messages
 *
 * GET /api/chat/:agentName/sessions/:sessionId
 */
export async function fetchChatSession(
  agentName: string,
  sessionId: string,
): Promise<ChatSessionDetailResponse> {
  return get<ChatSessionDetailResponse>(
    `/api/chat/${encodeURIComponent(agentName)}/sessions/${encodeURIComponent(sessionId)}`,
  );
}

/**
 * Delete a chat session
 *
 * DELETE /api/chat/:agentName/sessions/:sessionId
 */
export async function deleteChatSession(agentName: string, sessionId: string): Promise<void> {
  await del<{ deleted: boolean }>(
    `/api/chat/${encodeURIComponent(agentName)}/sessions/${encodeURIComponent(sessionId)}`,
  );
}
