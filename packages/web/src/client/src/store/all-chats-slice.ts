/**
 * Zustand slice for the All Chats page
 *
 * Manages directory groups, search, and expansion state for machine-wide session browsing.
 * Separate from chat-slice to avoid bloating the agent-scoped chat state.
 */

import type { StateCreator } from "zustand";
import * as api from "../lib/api";
import type { DirectoryGroup } from "../lib/types";

// =============================================================================
// State
// =============================================================================

export interface AllChatsState {
  allChatsGroups: DirectoryGroup[];
  allChatsTotalGroups: number;
  allChatsLoading: boolean;
  allChatsError: string | null;
  allChatsSearchQuery: string;
  allChatsExpandedGroups: Set<string>; // encoded paths of expanded groups
}

// =============================================================================
// Actions
// =============================================================================

export interface AllChatsActions {
  fetchAllChats: (params?: { limit?: number; sessionsPerGroup?: number }) => Promise<void>;
  setAllChatsSearchQuery: (query: string) => void;
  toggleAllChatsGroup: (encodedPath: string) => void;
  expandAllChatsGroups: () => void;
  collapseAllChatsGroups: () => void;
  loadMoreGroupSessions: (encodedPath: string) => Promise<void>;
}

// =============================================================================
// Combined Slice Type
// =============================================================================

export type AllChatsSlice = AllChatsState & AllChatsActions;

// =============================================================================
// Initial State
// =============================================================================

const initialAllChatsState: AllChatsState = {
  allChatsGroups: [],
  allChatsTotalGroups: 0,
  allChatsLoading: false,
  allChatsError: null,
  allChatsSearchQuery: "",
  allChatsExpandedGroups: new Set(),
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createAllChatsSlice: StateCreator<AllChatsSlice, [], [], AllChatsSlice> = (
  set,
  get,
) => ({
  ...initialAllChatsState,

  fetchAllChats: async (params) => {
    set({ allChatsLoading: true, allChatsError: null });
    try {
      const response = await api.fetchAllSessions(params);
      // Auto-expand all groups initially
      const expandedGroups = new Set(response.groups.map((g) => g.encodedPath));
      set({
        allChatsGroups: response.groups,
        allChatsTotalGroups: response.totalGroups,
        allChatsLoading: false,
        allChatsExpandedGroups: expandedGroups,
      });
    } catch (error) {
      set({
        allChatsLoading: false,
        allChatsError: error instanceof Error ? error.message : String(error),
      });
    }
  },

  setAllChatsSearchQuery: (query: string) => {
    set({ allChatsSearchQuery: query });
  },

  toggleAllChatsGroup: (encodedPath: string) => {
    const current = get().allChatsExpandedGroups;
    const next = new Set(current);
    if (next.has(encodedPath)) {
      next.delete(encodedPath);
    } else {
      next.add(encodedPath);
    }
    set({ allChatsExpandedGroups: next });
  },

  expandAllChatsGroups: () => {
    const groups = get().allChatsGroups;
    set({ allChatsExpandedGroups: new Set(groups.map((g) => g.encodedPath)) });
  },

  collapseAllChatsGroups: () => {
    set({ allChatsExpandedGroups: new Set() });
  },

  loadMoreGroupSessions: async (encodedPath: string) => {
    const groups = get().allChatsGroups;
    const group = groups.find((g) => g.encodedPath === encodedPath);
    if (!group) return;

    try {
      const response = await api.fetchDirectoryGroupSessions(encodedPath, {
        limit: 50,
        offset: group.sessions.length,
      });
      // Merge new sessions into the group
      const updatedGroups = groups.map((g) => {
        if (g.encodedPath === encodedPath) {
          return {
            ...g,
            sessions: [...g.sessions, ...response.group.sessions],
          };
        }
        return g;
      });
      set({ allChatsGroups: updatedGroups });
    } catch {
      // Silently fail for expansion — don't overwrite main error state
    }
  },
});
