/**
 * Root App component for @herdctl/web dashboard
 *
 * - Initializes WebSocket connection
 * - Fetches initial fleet status
 * - Renders routing with layout shell
 */

import { Route, Routes } from "react-router";
import { AgentDetail } from "./components/agent";
import { ChatView } from "./components/chat";
import { FleetDashboard } from "./components/dashboard/FleetDashboard";
import { JobHistory } from "./components/jobs";
import { AppLayout } from "./components/layout/AppLayout";
import { ScheduleList } from "./components/schedules";
import { ErrorBoundary } from "./components/ui";
import { ToastContainer } from "./components/ui/Toast";
import { useFleetStatus } from "./hooks/useFleetStatus";
import { useWebSocket } from "./hooks/useWebSocket";

// =============================================================================
// Placeholder Page Components
// =============================================================================

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
    <div className="p-4 h-full overflow-auto">
      <h1 className="text-lg font-semibold text-herd-fg mb-4">Schedules</h1>
      <ScheduleList />
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
    <ErrorBoundary>
      <AppLayout>
        <Routes>
          <Route
            path="/"
            element={
              <ErrorBoundary>
                <FleetDashboard />
              </ErrorBoundary>
            }
          />
          <Route
            path="/agents/:name"
            element={
              <ErrorBoundary>
                <AgentDetail />
              </ErrorBoundary>
            }
          />
          <Route
            path="/agents/:name/:tab"
            element={
              <ErrorBoundary>
                <AgentDetail />
              </ErrorBoundary>
            }
          />
          <Route
            path="/agents/:name/chat"
            element={
              <ErrorBoundary>
                <ChatView />
              </ErrorBoundary>
            }
          />
          <Route
            path="/agents/:name/chat/:sessionId"
            element={
              <ErrorBoundary>
                <ChatView />
              </ErrorBoundary>
            }
          />
          <Route
            path="/jobs"
            element={
              <ErrorBoundary>
                <JobsPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="/schedules"
            element={
              <ErrorBoundary>
                <SchedulesPage />
              </ErrorBoundary>
            }
          />
        </Routes>
      </AppLayout>
      <ToastContainer />
    </ErrorBoundary>
  );
}
