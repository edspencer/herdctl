/**
 * Combined Zustand store for @herdctl/web
 *
 * Combines fleet and UI slices into a single store.
 */

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { createFleetSlice, type FleetSlice } from "./fleet-slice";
import { createUISlice, type UISlice } from "./ui-slice";

// =============================================================================
// Combined Store Type
// =============================================================================

export type AppStore = FleetSlice & UISlice;

// =============================================================================
// Store
// =============================================================================

export const useStore = create<AppStore>()((...args) => ({
  ...createFleetSlice(...args),
  ...createUISlice(...args),
}));

// =============================================================================
// Re-exports
// =============================================================================

export type { FleetSlice, FleetState, FleetActions } from "./fleet-slice";
export type { UISlice, UIState, UIActions } from "./ui-slice";

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
