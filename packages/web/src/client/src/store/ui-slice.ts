/**
 * UI slice for Zustand store
 *
 * Manages UI state: sidebar, theme, selected agent, active view, panels.
 */

import type { StateCreator } from "zustand";
import { setTheme as applyAndPersistTheme, getStoredTheme } from "../lib/theme";
import type { ActiveView, Theme } from "../lib/types";

// =============================================================================
// State Types
// =============================================================================

export interface UIState {
  /** Whether the sidebar is collapsed */
  sidebarCollapsed: boolean;
  /** Whether the mobile sidebar overlay is open */
  sidebarMobileOpen: boolean;
  /** Currently selected agent name (for detail view) */
  selectedAgent: string | null;
  /** Active view/route */
  activeView: ActiveView;
  /** Theme preference (stored in localStorage as 'herd-theme') */
  theme: Theme;
  /** Whether the right detail panel is open */
  rightPanelOpen: boolean;
}

export interface UIActions {
  /** Toggle sidebar collapsed state */
  toggleSidebar: () => void;
  /** Set sidebar collapsed state explicitly */
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** Toggle mobile sidebar overlay */
  toggleSidebarMobile: () => void;
  /** Set mobile sidebar open state explicitly */
  setSidebarMobileOpen: (open: boolean) => void;
  /** Select an agent (opens detail panel) */
  selectAgent: (name: string | null) => void;
  /** Set the active view/route */
  setActiveView: (view: ActiveView) => void;
  /** Set theme preference */
  setTheme: (theme: Theme) => void;
  /** Toggle right panel visibility */
  toggleRightPanel: () => void;
  /** Set right panel open state explicitly */
  setRightPanelOpen: (open: boolean) => void;
}

export type UISlice = UIState & UIActions;

// =============================================================================
// Initial State
// =============================================================================

const initialUIState: UIState = {
  sidebarCollapsed: false,
  sidebarMobileOpen: false,
  selectedAgent: null,
  activeView: "dashboard",
  theme: getStoredTheme(),
  rightPanelOpen: false,
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createUISlice: StateCreator<UISlice, [], [], UISlice> = (set) => ({
  ...initialUIState,

  toggleSidebar: () =>
    set((state) => ({
      sidebarCollapsed: !state.sidebarCollapsed,
    })),

  setSidebarCollapsed: (collapsed) =>
    set({
      sidebarCollapsed: collapsed,
    }),

  toggleSidebarMobile: () =>
    set((state) => ({
      sidebarMobileOpen: !state.sidebarMobileOpen,
    })),

  setSidebarMobileOpen: (open) =>
    set({
      sidebarMobileOpen: open,
    }),

  selectAgent: (name) =>
    set({
      selectedAgent: name,
      // Open right panel when selecting an agent
      rightPanelOpen: name !== null,
    }),

  setActiveView: (view) =>
    set({
      activeView: view,
    }),

  setTheme: (theme) => {
    applyAndPersistTheme(theme);
    return set({ theme });
  },

  toggleRightPanel: () =>
    set((state) => ({
      rightPanelOpen: !state.rightPanelOpen,
    })),

  setRightPanelOpen: (open) =>
    set({
      rightPanelOpen: open,
    }),
});
