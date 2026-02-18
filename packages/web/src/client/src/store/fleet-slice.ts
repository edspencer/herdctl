/**
 * Fleet slice for Zustand store
 *
 * Manages fleet status, agents, jobs, and WebSocket connection state.
 */

import type { StateCreator } from "zustand";
import type {
  FleetStatus,
  AgentInfo,
  JobSummary,
  ConnectionStatus,
  AgentStartedPayload,
  AgentStoppedPayload,
  JobCreatedPayload,
  JobCompletedPayload,
  JobFailedPayload,
  JobCancelledPayload,
} from "../lib/types";
import { isAgentStartedPayload } from "../lib/types";

// =============================================================================
// State Types
// =============================================================================

export interface FleetState {
  /** Current fleet status (from server) */
  fleetStatus: FleetStatus | null;
  /** List of all agents */
  agents: AgentInfo[];
  /** Recent jobs (limited, most recent first) */
  recentJobs: JobSummary[];
  /** WebSocket connection status */
  connectionStatus: ConnectionStatus;
  /** Timestamp of last state update */
  lastUpdated: string | null;
}

export interface FleetActions {
  /** Set full fleet status snapshot */
  setFleetStatus: (status: FleetStatus) => void;
  /** Set full agents list (from REST API) */
  setAgents: (agents: AgentInfo[]) => void;
  /** Update a single agent (from WebSocket event) */
  updateAgent: (payload: AgentStartedPayload | AgentStoppedPayload) => void;
  /** Set recent jobs from API fetch (seeds the list) */
  setRecentJobs: (jobs: JobSummary[]) => void;
  /** Add a new job to recent jobs */
  addJob: (payload: JobCreatedPayload) => void;
  /** Mark a job as completed */
  completeJob: (payload: JobCompletedPayload) => void;
  /** Mark a job as failed */
  failJob: (payload: JobFailedPayload) => void;
  /** Mark a job as cancelled */
  cancelJob: (payload: JobCancelledPayload) => void;
  /** Set WebSocket connection status */
  setConnectionStatus: (status: ConnectionStatus) => void;
}

export type FleetSlice = FleetState & FleetActions;

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of recent jobs to keep in state */
const MAX_RECENT_JOBS = 50;

// =============================================================================
// Initial State
// =============================================================================

const initialFleetState: FleetState = {
  fleetStatus: null,
  agents: [],
  recentJobs: [],
  connectionStatus: "disconnected",
  lastUpdated: null,
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createFleetSlice: StateCreator<FleetSlice, [], [], FleetSlice> = (set) => ({
  ...initialFleetState,

  setFleetStatus: (status) =>
    set({
      fleetStatus: status,
      lastUpdated: new Date().toISOString(),
    }),

  setAgents: (agents) =>
    set({
      agents,
      lastUpdated: new Date().toISOString(),
    }),

  setRecentJobs: (jobs) =>
    set((state) => {
      // Merge fetched jobs with any WebSocket-added jobs already in state.
      // Use a Map keyed by jobId to deduplicate, preferring existing (more up-to-date) entries.
      const merged = new Map<string, JobSummary>();
      for (const job of jobs) {
        merged.set(job.jobId, job);
      }
      // WebSocket jobs override fetched ones (they have fresher status)
      for (const job of state.recentJobs) {
        merged.set(job.jobId, job);
      }
      const allJobs = Array.from(merged.values());
      allJobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return {
        recentJobs: allJobs.slice(0, MAX_RECENT_JOBS),
        lastUpdated: new Date().toISOString(),
      };
    }),

  updateAgent: (payload) =>
    set((state) => {
      if (isAgentStartedPayload(payload)) {
        // Agent started: add or update in list
        const existingIndex = state.agents.findIndex(
          (a) => a.name === payload.agent.name
        );

        if (existingIndex >= 0) {
          // Update existing agent
          const newAgents = [...state.agents];
          newAgents[existingIndex] = payload.agent;
          return {
            agents: newAgents,
            lastUpdated: new Date().toISOString(),
          };
        } else {
          // Add new agent
          return {
            agents: [...state.agents, payload.agent],
            lastUpdated: new Date().toISOString(),
          };
        }
      } else {
        // Agent stopped: update status or remove
        const existingIndex = state.agents.findIndex(
          (a) => a.name === payload.agentName
        );

        if (existingIndex >= 0) {
          const newAgents = [...state.agents];
          // Update the agent's status to indicate it stopped
          newAgents[existingIndex] = {
            ...newAgents[existingIndex],
            status: "idle",
            currentJobId: null,
          };
          return {
            agents: newAgents,
            lastUpdated: new Date().toISOString(),
          };
        }

        return state;
      }
    }),

  addJob: (payload) =>
    set((state) => {
      const newJob: JobSummary = {
        jobId: payload.jobId,
        agentName: payload.agentName,
        prompt: payload.prompt,
        status: "running",
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
      };

      // Add to front, limit size
      const recentJobs = [newJob, ...state.recentJobs].slice(0, MAX_RECENT_JOBS);

      return {
        recentJobs,
        lastUpdated: new Date().toISOString(),
      };
    }),

  completeJob: (payload) =>
    set((state) => {
      const jobIndex = state.recentJobs.findIndex(
        (j) => j.jobId === payload.jobId
      );

      if (jobIndex >= 0) {
        const newJobs = [...state.recentJobs];
        newJobs[jobIndex] = {
          ...newJobs[jobIndex],
          status: "completed",
          exitCode: payload.exitCode,
          completedAt: new Date().toISOString(),
        };
        return {
          recentJobs: newJobs,
          lastUpdated: new Date().toISOString(),
        };
      }

      return state;
    }),

  failJob: (payload) =>
    set((state) => {
      const jobIndex = state.recentJobs.findIndex(
        (j) => j.jobId === payload.jobId
      );

      if (jobIndex >= 0) {
        const newJobs = [...state.recentJobs];
        newJobs[jobIndex] = {
          ...newJobs[jobIndex],
          status: "failed",
          error: payload.error,
          completedAt: new Date().toISOString(),
        };
        return {
          recentJobs: newJobs,
          lastUpdated: new Date().toISOString(),
        };
      }

      return state;
    }),

  cancelJob: (payload) =>
    set((state) => {
      const jobIndex = state.recentJobs.findIndex(
        (j) => j.jobId === payload.jobId
      );

      if (jobIndex >= 0) {
        const newJobs = [...state.recentJobs];
        newJobs[jobIndex] = {
          ...newJobs[jobIndex],
          status: "cancelled",
          error: payload.reason,
          completedAt: new Date().toISOString(),
        };
        return {
          recentJobs: newJobs,
          lastUpdated: new Date().toISOString(),
        };
      }

      return state;
    }),

  setConnectionStatus: (connectionStatus) =>
    set({
      connectionStatus,
      lastUpdated: new Date().toISOString(),
    }),
});
