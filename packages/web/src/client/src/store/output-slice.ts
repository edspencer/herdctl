/**
 * Output slice for Zustand store
 *
 * Manages job output messages for live streaming display.
 * Buffers output per job with automatic trimming.
 */

import type { StateCreator } from "zustand";
import type { StreamType } from "../lib/types";

// =============================================================================
// Types
// =============================================================================

/**
 * A single output message from an agent's job
 */
export interface OutputMessage {
  /** Unique ID for this message (counter-based) */
  id: string;
  /** Job ID this output belongs to */
  jobId: string;
  /** Agent name that produced this output */
  agentName: string;
  /** The output data */
  data: string;
  /** Which stream (stdout or stderr) */
  stream: StreamType;
  /** Timestamp when received */
  timestamp: number;
}

export interface OutputState {
  /** Map of jobId -> array of output messages */
  outputsByJob: Record<string, OutputMessage[]>;
  /** Which job IDs the user is currently viewing (for future cleanup) */
  activeJobViews: Set<string>;
  /** Internal counter for generating unique message IDs */
  _messageCounter: number;
}

export interface OutputActions {
  /** Append output to a job's buffer */
  appendOutput: (jobId: string, agentName: string, data: string, stream: StreamType) => void;
  /** Clear all output for a specific job */
  clearJobOutput: (jobId: string) => void;
  /** Mark a job as actively being viewed */
  setActiveJobView: (jobId: string, active: boolean) => void;
  /** Clear all output data */
  clearAllOutput: () => void;
}

export type OutputSlice = OutputState & OutputActions;

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of messages to keep per job */
const MAX_MESSAGES_PER_JOB = 1000;

// =============================================================================
// Initial State
// =============================================================================

const initialOutputState: OutputState = {
  outputsByJob: {},
  activeJobViews: new Set<string>(),
  _messageCounter: 0,
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createOutputSlice: StateCreator<OutputSlice, [], [], OutputSlice> = (set) => ({
  ...initialOutputState,

  appendOutput: (jobId, agentName, data, stream) =>
    set((state) => {
      const newCounter = state._messageCounter + 1;
      const message: OutputMessage = {
        id: `msg-${newCounter}`,
        jobId,
        agentName,
        data,
        stream,
        timestamp: Date.now(),
      };

      const existingMessages = state.outputsByJob[jobId] ?? [];
      let newMessages = [...existingMessages, message];

      // Trim oldest messages if exceeding buffer limit
      if (newMessages.length > MAX_MESSAGES_PER_JOB) {
        newMessages = newMessages.slice(newMessages.length - MAX_MESSAGES_PER_JOB);
      }

      return {
        outputsByJob: {
          ...state.outputsByJob,
          [jobId]: newMessages,
        },
        _messageCounter: newCounter,
      };
    }),

  clearJobOutput: (jobId) =>
    set((state) => {
      const { [jobId]: _removed, ...rest } = state.outputsByJob;
      return {
        outputsByJob: rest,
      };
    }),

  setActiveJobView: (jobId, active) =>
    set((state) => {
      // Create a new Set to ensure Zustand tracks the change
      const newActiveViews = new Set(state.activeJobViews);
      if (active) {
        newActiveViews.add(jobId);
      } else {
        newActiveViews.delete(jobId);
      }
      return {
        activeJobViews: newActiveViews,
      };
    }),

  clearAllOutput: () =>
    set({
      outputsByJob: {},
      activeJobViews: new Set<string>(),
      _messageCounter: 0,
    }),
});
