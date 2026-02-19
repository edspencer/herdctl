/**
 * Header component for the main content area
 *
 * Shows:
 * - Page title (derived from current route)
 * - Connection status indicator
 */

import { useLocation, useParams } from "react-router";
import { Menu, Sun, Moon, Monitor, ArrowLeft } from "lucide-react";
import { Link } from "react-router";
import { useFleet, useUI, useUIActions } from "../../store";
import type { ConnectionStatus, Theme } from "../../lib/types";

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
interface PageTitleInfo {
  title: string;
  backTo?: string;
  sessionId?: string;
}

function getPageTitleInfo(pathname: string, agentName?: string): PageTitleInfo {
  if (pathname === "/") {
    return { title: "Fleet Dashboard" };
  }
  if (pathname === "/jobs") {
    return { title: "Jobs" };
  }
  if (pathname === "/schedules") {
    return { title: "Schedules" };
  }
  if (pathname.startsWith("/agents/") && agentName) {
    // Match /agents/:name/chat/:sessionId
    const chatSessionMatch = pathname.match(/^\/agents\/[^/]+\/chat\/(.+)$/);
    if (chatSessionMatch) {
      return {
        title: `Chat with ${agentName}`,
        backTo: `/agents/${encodeURIComponent(agentName)}`,
        sessionId: chatSessionMatch[1],
      };
    }
    if (pathname.endsWith("/chat")) {
      return {
        title: `Chat with ${agentName}`,
        backTo: `/agents/${encodeURIComponent(agentName)}`,
      };
    }
    return { title: agentName };
  }
  return { title: "herdctl" };
}

// =============================================================================
// Component
// =============================================================================

const themeOptions: { value: Theme; icon: typeof Sun; label: string }[] = [
  { value: "light", icon: Sun, label: "Light mode" },
  { value: "dark", icon: Moon, label: "Dark mode" },
  { value: "system", icon: Monitor, label: "System theme" },
];

export function Header() {
  const { connectionStatus } = useFleet();
  const { theme } = useUI();
  const { toggleSidebarMobile, setTheme } = useUIActions();
  const location = useLocation();
  const params = useParams<{ name?: string }>();

  const pageInfo = getPageTitleInfo(location.pathname, params.name);

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-herd-border bg-herd-card">
      {/* Left: hamburger + back button + page title */}
      <div className="flex items-center gap-2">
        {/* Hamburger menu — visible only on mobile */}
        <button
          onClick={toggleSidebarMobile}
          className="md:hidden hover:bg-herd-hover text-herd-muted hover:text-herd-fg rounded-lg p-1.5 transition-colors"
          aria-label="Toggle sidebar"
        >
          <Menu className="w-4 h-4" />
        </button>
        {pageInfo.backTo && (
          <Link
            to={pageInfo.backTo}
            className="text-herd-muted hover:text-herd-fg transition-colors"
            title="Back to agent"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
        )}
        <h1 className="text-lg font-semibold text-herd-fg">{pageInfo.title}</h1>
        {pageInfo.sessionId && (
          <span className="text-xs text-herd-muted font-mono">
            {pageInfo.sessionId.slice(0, 8)}
          </span>
        )}
      </div>

      {/* Right: theme toggle + connection status */}
      <div className="flex items-center gap-3">
        {/* Theme toggle */}
        <div className="flex items-center bg-herd-hover rounded-lg p-0.5">
          {themeOptions.map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              className={`p-1.5 rounded-md transition-colors ${
                theme === value
                  ? "bg-herd-card text-herd-fg shadow-sm"
                  : "text-herd-muted hover:text-herd-fg"
              }`}
              title={label}
              aria-label={label}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          ))}
        </div>

        {/* Connection status */}
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${getConnectionDotClass(connectionStatus)}`}
          />
          <span className="text-xs text-herd-muted">
            {getConnectionLabel(connectionStatus)}
          </span>
        </div>
      </div>
    </header>
  );
}
