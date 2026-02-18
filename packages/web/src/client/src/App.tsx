/**
 * Root App component for @herdctl/web dashboard
 *
 * - Initializes WebSocket connection
 * - Fetches initial fleet status
 * - Renders routing with layout shell
 */

import { Routes, Route } from "react-router";
import { useWebSocket } from "./hooks/useWebSocket";
import { useFleetStatus } from "./hooks/useFleetStatus";
import { AppLayout } from "./components/layout/AppLayout";
import { FleetDashboard } from "./components/dashboard/FleetDashboard";

// =============================================================================
// Placeholder Page Components
// =============================================================================

function AgentDetailPage() {
  return (
    <div className="p-4">
      <p className="text-herd-muted text-sm">
        Agent Detail — Coming in Phase 3
      </p>
    </div>
  );
}

function AgentChatPage() {
  return (
    <div className="p-4">
      <p className="text-herd-muted text-sm">
        Agent Chat — Coming in Phase 4
      </p>
    </div>
  );
}

function JobsPage() {
  return (
    <div className="p-4">
      <p className="text-herd-muted text-sm">
        Job History — Coming in Phase 3
      </p>
    </div>
  );
}

function SchedulesPage() {
  return (
    <div className="p-4">
      <p className="text-herd-muted text-sm">
        Schedule Overview — Coming in Phase 3
      </p>
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="p-4">
      <p className="text-herd-muted text-sm">
        Settings — Coming in Phase 5
      </p>
    </div>
  );
}

// =============================================================================
// App Component
// =============================================================================

export default function App() {
  // Initialize WebSocket connection
  useWebSocket();

  // Fetch initial fleet status
  const { loading, error, retry } = useFleetStatus();

  // Show loading state
  if (loading) {
    return (
      <div className="h-dvh flex items-center justify-center bg-herd-bg">
        <div className="bg-herd-card border border-herd-border rounded-[10px] p-4 text-center">
          <p className="text-sm text-herd-fg">Loading fleet data...</p>
        </div>
      </div>
    );
  }

  // Show error state with retry
  if (error) {
    return (
      <div className="h-dvh flex items-center justify-center bg-herd-bg">
        <div className="bg-herd-card border border-herd-border rounded-[10px] p-4 text-center max-w-sm">
          <p className="text-sm text-herd-status-error mb-3">{error}</p>
          <button
            onClick={retry}
            className="bg-herd-primary hover:bg-herd-primary-hover text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Render main app with routing
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<FleetDashboard />} />
        <Route path="/agents/:name" element={<AgentDetailPage />} />
        <Route path="/agents/:name/chat" element={<AgentChatPage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/schedules" element={<SchedulesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </AppLayout>
  );
}
