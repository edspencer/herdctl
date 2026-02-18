/**
 * REST API client for @herdctl/web
 *
 * Provides typed functions for fetching data from the herdctl web server.
 * All functions throw on non-OK responses.
 */

import type { FleetStatus, AgentInfo, ScheduleInfo, JobSummary } from "./types";

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
    public readonly url: string
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
async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
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
 * Fetch a single agent by name
 *
 * GET /api/agents/:name
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
  /** Filter by agent name */
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
 * Fetch all schedules
 *
 * GET /api/schedules
 */
export async function fetchSchedules(): Promise<ScheduleInfo[]> {
  return get<ScheduleInfo[]>("/api/schedules");
}
