/**
 * UI slice for Zustand store
 *
 * Manages UI state: sidebar, theme, selected agent, active view, panels.
 */

import type { StateCreator } from "zustand";
import type { Theme, ActiveView } from "../lib/types";

// =============================================================================
// State Types
// =============================================================================

export interface UIState {
  /** Whether the sidebar is collapsed */
  sidebarCollapsed: boolean;
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
// Theme Helpers
// =============================================================================

const THEME_STORAGE_KEY = "herd-theme";

/**
 * Get initial theme from localStorage or default to 'system'
 */
function getInitialTheme(): Theme {
  if (typeof window === "undefined") {
    return "system";
  }

  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }

  return "system";
}

/**
 * Apply theme to document
 */
function applyTheme(theme: Theme): void {
  if (typeof window === "undefined") {
    return;
  }

  const root = document.documentElement;

  if (theme === "system") {
    // Use system preference
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", prefersDark);
  } else {
    root.classList.toggle("dark", theme === "dark");
  }

  // Persist to localStorage
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

// =============================================================================
// Initial State
// =============================================================================

const initialUIState: UIState = {
  sidebarCollapsed: false,
  selectedAgent: null,
  activeView: "dashboard",
  theme: getInitialTheme(),
  rightPanelOpen: false,
};

// Apply initial theme on load
if (typeof window !== "undefined") {
  applyTheme(initialUIState.theme);

  // Listen for system theme changes when using 'system' preference
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    const currentTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (currentTheme === "system") {
      document.documentElement.classList.toggle("dark", e.matches);
    }
  });
}

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
    applyTheme(theme);
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
