/**
 * Combined Zustand store for @herdctl/web
 *
 * Combines fleet, UI, output, and jobs slices into a single store.
 */

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { createFleetSlice, type FleetSlice } from "./fleet-slice";
import { createUISlice, type UISlice } from "./ui-slice";
import { createOutputSlice, type OutputSlice } from "./output-slice";
import { createJobsSlice, type JobsSlice } from "./jobs-slice";

// =============================================================================
// Combined Store Type
// =============================================================================

export type AppStore = FleetSlice & UISlice & OutputSlice & JobsSlice;

// =============================================================================
// Store
// =============================================================================

export const useStore = create<AppStore>()((...args) => ({
  ...createFleetSlice(...args),
  ...createUISlice(...args),
  ...createOutputSlice(...args),
  ...createJobsSlice(...args),
}));

// =============================================================================
// Re-exports
// =============================================================================

export type { FleetSlice, FleetState, FleetActions } from "./fleet-slice";
export type { UISlice, UIState, UIActions } from "./ui-slice";
export type {
  OutputSlice,
  OutputState,
  OutputActions,
  OutputMessage,
} from "./output-slice";
export type {
  JobsSlice,
  JobsState,
  JobsActions,
  JobsFilter,
} from "./jobs-slice";

// =============================================================================
// Selector Hooks
// =============================================================================

/**
 * Select fleet-related state
 */
export function useFleet() {
  return useStore(
    useShallow((state) => ({
      fleetStatus: state.fleetStatus,
      agents: state.agents,
      recentJobs: state.recentJobs,
      connectionStatus: state.connectionStatus,
      lastUpdated: state.lastUpdated,
    }))
  );
}

/**
 * Select a single agent by name
 */
export function useAgent(name: string | null) {
  return useStore((state) =>
    name ? state.agents.find((a) => a.name === name) ?? null : null
  );
}

/**
 * Select UI state
 */
export function useUI() {
  return useStore(
    useShallow((state) => ({
      sidebarCollapsed: state.sidebarCollapsed,
      selectedAgent: state.selectedAgent,
      activeView: state.activeView,
      theme: state.theme,
      rightPanelOpen: state.rightPanelOpen,
    }))
  );
}

/**
 * Select UI actions
 */
export function useUIActions() {
  return useStore(
    useShallow((state) => ({
      toggleSidebar: state.toggleSidebar,
      setSidebarCollapsed: state.setSidebarCollapsed,
      selectAgent: state.selectAgent,
      setActiveView: state.setActiveView,
      setTheme: state.setTheme,
      toggleRightPanel: state.toggleRightPanel,
      setRightPanelOpen: state.setRightPanelOpen,
    }))
  );
}

/**
 * Select fleet actions
 */
export function useFleetActions() {
  return useStore(
    useShallow((state) => ({
      setFleetStatus: state.setFleetStatus,
      setAgents: state.setAgents,
      updateAgent: state.updateAgent,
      addJob: state.addJob,
      completeJob: state.completeJob,
      failJob: state.failJob,
      cancelJob: state.cancelJob,
      setConnectionStatus: state.setConnectionStatus,
    }))
  );
}

/**
 * Select output messages for a specific job
 */
export function useJobOutput(jobId: string | null) {
  return useStore((state) =>
    jobId ? state.outputsByJob[jobId] ?? [] : []
  );
}

/**
 * Select output actions
 */
export function useOutputActions() {
  return useStore(
    useShallow((state) => ({
      appendOutput: state.appendOutput,
      clearJobOutput: state.clearJobOutput,
      setActiveJobView: state.setActiveJobView,
      clearAllOutput: state.clearAllOutput,
    }))
  );
}

// =============================================================================
// Jobs Selector Hooks
// =============================================================================

/**
 * Select jobs list state (with useShallow to prevent infinite re-renders)
 */
export function useJobs() {
  return useStore(
    useShallow((state) => ({
      jobs: state.jobs,
      totalJobs: state.totalJobs,
      jobsLoading: state.jobsLoading,
      jobsError: state.jobsError,
      jobsFilter: state.jobsFilter,
      jobsOffset: state.jobsOffset,
      jobsLimit: state.jobsLimit,
    }))
  );
}

/**
 * Select jobs actions
 */
export function useJobsActions() {
  return useStore(
    useShallow((state) => ({
      fetchJobs: state.fetchJobs,
      fetchJobDetail: state.fetchJobDetail,
      setJobsFilter: state.setJobsFilter,
      setJobsOffset: state.setJobsOffset,
      selectJob: state.selectJob,
      clearJobsState: state.clearJobsState,
    }))
  );
}

/**
 * Select selected job state (with useShallow to prevent infinite re-renders)
 */
export function useSelectedJob() {
  return useStore(
    useShallow((state) => ({
      selectedJobId: state.selectedJobId,
      selectedJob: state.selectedJob,
      selectedJobLoading: state.selectedJobLoading,
    }))
  );
}
