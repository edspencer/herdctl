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
import { createChatSlice, type ChatSlice } from "./chat-slice";
import { createScheduleSlice, type ScheduleSlice } from "./schedule-slice";
import { createToastSlice, type ToastSlice } from "./toast-slice";

// =============================================================================
// Combined Store Type
// =============================================================================

export type AppStore = FleetSlice & UISlice & OutputSlice & JobsSlice & ChatSlice & ScheduleSlice & ToastSlice;

// =============================================================================
// Store
// =============================================================================

export const useStore = create<AppStore>()((...args) => ({
  ...createFleetSlice(...args),
  ...createUISlice(...args),
  ...createOutputSlice(...args),
  ...createJobsSlice(...args),
  ...createChatSlice(...args),
  ...createScheduleSlice(...args),
  ...createToastSlice(...args),
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
export type {
  ChatSlice,
  ChatState,
  ChatActions,
} from "./chat-slice";
export type {
  ScheduleSlice,
  ScheduleState,
  ScheduleActions,
} from "./schedule-slice";
export type {
  ToastSlice,
  ToastState,
  ToastActions,
  Toast,
  ToastType,
} from "./toast-slice";

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
 * Select a single agent by qualified name
 */
export function useAgent(qualifiedName: string | null) {
  return useStore((state) =>
    qualifiedName ? state.agents.find((a) => a.qualifiedName === qualifiedName) ?? null : null
  );
}

/**
 * Select UI state
 */
export function useUI() {
  return useStore(
    useShallow((state) => ({
      sidebarCollapsed: state.sidebarCollapsed,
      sidebarMobileOpen: state.sidebarMobileOpen,
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
      toggleSidebarMobile: state.toggleSidebarMobile,
      setSidebarMobileOpen: state.setSidebarMobileOpen,
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
      setRecentJobs: state.setRecentJobs,
      addJob: state.addJob,
      completeJob: state.completeJob,
      failJob: state.failJob,
      cancelJob: state.cancelJob,
      setConnectionStatus: state.setConnectionStatus,
    }))
  );
}

// Singleton empty array to prevent creating new references in selectors
const EMPTY_ARRAY: any[] = [];

/**
 * Select output messages for a specific job
 */
export function useJobOutput(jobId: string | null) {
  return useStore((state) =>
    jobId ? state.outputsByJob[jobId] ?? EMPTY_ARRAY : EMPTY_ARRAY
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

// =============================================================================
// Chat Selector Hooks
// =============================================================================

/**
 * Select chat sessions state (with useShallow to prevent infinite re-renders)
 */
export function useChatSessions() {
  return useStore(
    useShallow((state) => ({
      chatSessions: state.chatSessions,
      chatSessionsLoading: state.chatSessionsLoading,
      chatError: state.chatError,
    }))
  );
}

/**
 * Select chat messages state (with useShallow to prevent infinite re-renders)
 */
export function useChatMessages() {
  return useStore(
    useShallow((state) => ({
      chatMessages: state.chatMessages,
      chatMessagesLoading: state.chatMessagesLoading,
      activeChatSessionId: state.activeChatSessionId,
      chatStreaming: state.chatStreaming,
      chatStreamingContent: state.chatStreamingContent,
      chatError: state.chatError,
    }))
  );
}

/**
 * Select chat actions
 */
export function useChatActions() {
  return useStore(
    useShallow((state) => ({
      fetchChatSessions: state.fetchChatSessions,
      fetchChatMessages: state.fetchChatMessages,
      createChatSession: state.createChatSession,
      deleteChatSession: state.deleteChatSession,
      setActiveChatSession: state.setActiveChatSession,
      appendStreamingChunk: state.appendStreamingChunk,
      completeStreaming: state.completeStreaming,
      addUserMessage: state.addUserMessage,
      setChatError: state.setChatError,
      fetchSidebarSessions: state.fetchSidebarSessions,
      clearActiveChatState: state.clearActiveChatState,
      clearChatState: state.clearChatState,
    }))
  );
}

/**
 * Select sidebar sessions state (recent chats per agent)
 */
export function useSidebarSessions() {
  return useStore(
    useShallow((state) => ({
      sidebarSessions: state.sidebarSessions,
      sidebarSessionsLoading: state.sidebarSessionsLoading,
    }))
  );
}

// =============================================================================
// Schedule Selector Hooks
// =============================================================================

/**
 * Select schedule list state (with useShallow to prevent infinite re-renders)
 */
export function useSchedules() {
  return useStore(
    useShallow((state) => ({
      schedules: state.schedules,
      schedulesLoading: state.schedulesLoading,
      schedulesError: state.schedulesError,
    }))
  );
}

/**
 * Select schedule actions
 */
export function useScheduleActions() {
  return useStore(
    useShallow((state) => ({
      fetchSchedules: state.fetchSchedules,
      triggerSchedule: state.triggerSchedule,
      enableSchedule: state.enableSchedule,
      disableSchedule: state.disableSchedule,
      updateScheduleFromWS: state.updateScheduleFromWS,
      clearSchedulesState: state.clearSchedulesState,
    }))
  );
}

// =============================================================================
// Toast Selector Hooks
// =============================================================================

/**
 * Select toasts state
 */
export function useToasts() {
  return useStore((state) => state.toasts);
}

/**
 * Select toast actions
 */
export function useToastActions() {
  return useStore(
    useShallow((state) => ({
      addToast: state.addToast,
      removeToast: state.removeToast,
    }))
  );
}
