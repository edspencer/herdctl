/**
 * Schedule slice for Zustand store
 *
 * Manages schedule list state, triggering, and enable/disable actions.
 */

import type { StateCreator } from "zustand";
import {
  disableSchedule as apiDisableSchedule,
  enableSchedule as apiEnableSchedule,
  fetchSchedules,
  triggerAgent,
} from "../lib/api";
import type { ScheduleInfo } from "../lib/types";

// =============================================================================
// Types
// =============================================================================

export interface ScheduleState {
  /** List of all schedules across all agents */
  schedules: ScheduleInfo[];
  /** Loading state for schedule list */
  schedulesLoading: boolean;
  /** Error message for schedule operations */
  schedulesError: string | null;
}

export interface ScheduleActions {
  /** Fetch all schedules from the server */
  fetchSchedules: () => Promise<void>;
  /** Trigger a schedule (or agent default) */
  triggerSchedule: (agentName: string, scheduleName?: string) => Promise<void>;
  /** Enable a disabled schedule */
  enableSchedule: (agentName: string, scheduleName: string) => Promise<void>;
  /** Disable an active schedule */
  disableSchedule: (agentName: string, scheduleName: string) => Promise<void>;
  /** Update a single schedule from a WebSocket event (refetches the list) */
  updateScheduleFromWS: () => void;
  /** Clear all schedule state */
  clearSchedulesState: () => void;
}

export type ScheduleSlice = ScheduleState & ScheduleActions;

// =============================================================================
// Initial State
// =============================================================================

const initialScheduleState: ScheduleState = {
  schedules: [],
  schedulesLoading: false,
  schedulesError: null,
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createScheduleSlice: StateCreator<ScheduleSlice, [], [], ScheduleSlice> = (
  set,
  get,
) => ({
  ...initialScheduleState,

  fetchSchedules: async () => {
    set({ schedulesLoading: true, schedulesError: null });

    try {
      const schedules = await fetchSchedules();
      set({
        schedules,
        schedulesLoading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch schedules";
      set({
        schedulesLoading: false,
        schedulesError: message,
      });
    }
  },

  triggerSchedule: async (agentName: string, scheduleName?: string) => {
    set({ schedulesError: null });

    try {
      await triggerAgent(agentName, { scheduleName });
      // Refetch schedules to get updated state (runCount, lastRunAt, etc.)
      await get().fetchSchedules();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to trigger schedule";
      set({ schedulesError: message });
    }
  },

  enableSchedule: async (agentName: string, scheduleName: string) => {
    set({ schedulesError: null });

    try {
      const updatedSchedule = await apiEnableSchedule(agentName, scheduleName);
      // Update the schedule in the list
      set((state) => ({
        schedules: state.schedules.map((s) =>
          s.agentName === agentName && s.name === scheduleName ? updatedSchedule : s,
        ),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to enable schedule";
      set({ schedulesError: message });
    }
  },

  disableSchedule: async (agentName: string, scheduleName: string) => {
    set({ schedulesError: null });

    try {
      const updatedSchedule = await apiDisableSchedule(agentName, scheduleName);
      // Update the schedule in the list
      set((state) => ({
        schedules: state.schedules.map((s) =>
          s.agentName === agentName && s.name === scheduleName ? updatedSchedule : s,
        ),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to disable schedule";
      set({ schedulesError: message });
    }
  },

  updateScheduleFromWS: () => {
    // Refetch all schedules to ensure consistency
    get()
      .fetchSchedules()
      .catch(() => {
        // Error is already handled in fetchSchedules
      });
  },

  clearSchedulesState: () => {
    set(initialScheduleState);
  },
});
