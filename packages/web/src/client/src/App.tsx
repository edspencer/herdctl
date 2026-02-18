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
import { AgentDetail } from "./components/agent";
import { JobHistory } from "./components/jobs";

// =============================================================================
// Placeholder Page Components
// =============================================================================

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
    <div className="p-4 h-full overflow-auto">
      <h1 className="text-lg font-semibold text-herd-fg mb-4">Job History</h1>
      <JobHistory />
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

  // Fetch initial fleet status (non-blocking — data populates into store)
  useFleetStatus();

  // Always render the layout shell — loading/error states show within the dashboard
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<FleetDashboard />} />
        <Route path="/agents/:name" element={<AgentDetail />} />
        <Route path="/agents/:name/chat" element={<AgentChatPage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/schedules" element={<SchedulesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </AppLayout>
  );
}
