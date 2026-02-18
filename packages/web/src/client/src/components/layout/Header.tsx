/**
 * Header component for the main content area
 *
 * Shows:
 * - Page title (derived from current route)
 * - Connection status indicator
 */

import { useLocation, useParams } from "react-router";
import { Menu } from "lucide-react";
import { useFleet, useUIActions } from "../../store";
import type { ConnectionStatus } from "../../lib/types";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get connection status dot color class
 */
function getConnectionDotClass(status: ConnectionStatus): string {
  switch (status) {
    case "connected":
      return "bg-herd-status-running";
    case "reconnecting":
      return "bg-herd-status-pending animate-pulse";
    case "disconnected":
      return "bg-herd-status-error";
  }
}

/**
 * Get connection status label
 */
function getConnectionLabel(status: ConnectionStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "reconnecting":
      return "Reconnecting";
    case "disconnected":
      return "Disconnected";
  }
}

/**
 * Get page title from route
 */
function getPageTitle(pathname: string, agentName?: string): string {
  if (pathname === "/") {
    return "Fleet Dashboard";
  }
  if (pathname === "/jobs") {
    return "Jobs";
  }
  if (pathname === "/schedules") {
    return "Schedules";
  }
  if (pathname === "/settings") {
    return "Settings";
  }
  if (pathname.startsWith("/agents/") && agentName) {
    if (pathname.endsWith("/chat")) {
      return `${agentName} Chat`;
    }
    return agentName;
  }
  return "herdctl";
}

// =============================================================================
// Component
// =============================================================================

export function Header() {
  const { connectionStatus } = useFleet();
  const { toggleSidebarMobile } = useUIActions();
  const location = useLocation();
  const params = useParams<{ name?: string }>();

  const pageTitle = getPageTitle(location.pathname, params.name);

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-herd-border bg-herd-card">
      {/* Left: hamburger + page title */}
      <div className="flex items-center gap-2">
        {/* Hamburger menu — visible only on mobile */}
        <button
          onClick={toggleSidebarMobile}
          className="md:hidden hover:bg-herd-hover text-herd-muted hover:text-herd-fg rounded-lg p-1.5 transition-colors"
          aria-label="Toggle sidebar"
        >
          <Menu className="w-4 h-4" />
        </button>
        <h1 className="text-lg font-semibold text-herd-fg">{pageTitle}</h1>
      </div>

      {/* Connection status */}
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${getConnectionDotClass(connectionStatus)}`}
        />
        <span className="text-xs text-herd-muted">
          {getConnectionLabel(connectionStatus)}
        </span>
      </div>
    </header>
  );
}
