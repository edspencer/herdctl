/**
 * FleetDashboard component
 *
 * Main dashboard page showing fleet overview, agent cards, and recent jobs.
 */

import { useFleet } from "../../store";
import { StatusBadge, Card, TimeAgo } from "../ui";
import { AgentCard } from "./AgentCard";
import { RecentJobs } from "./RecentJobs";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format uptime seconds to human-readable string
 * e.g., "2d 5h 30m" or "1h 45m 30s" for shorter durations
 */
function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds < 0) {
    return "--";
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

// =============================================================================
// Sub-Components
// =============================================================================

interface StatChipProps {
  label: string;
  value: number;
  variant?: "default" | "success" | "muted";
}

function StatChip({ label, value, variant = "default" }: StatChipProps) {
  const colorClasses = {
    default: "text-herd-fg",
    success: "text-herd-status-running",
    muted: "text-herd-muted",
  };

  return (
    <div className="bg-herd-hover rounded-lg px-3 py-1.5 flex items-center gap-1.5">
      <span className={`text-sm font-medium ${colorClasses[variant]}`}>
        {value}
      </span>
      <span className="text-xs text-herd-muted">{label}</span>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function FleetDashboard() {
  const { fleetStatus, agents, recentJobs, lastUpdated } = useFleet();

  const counts = fleetStatus?.counts ?? {
    totalAgents: 0,
    runningAgents: 0,
    idleAgents: 0,
    errorAgents: 0,
    totalJobs: 0,
    runningJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
  };

  return (
    <div className="p-4 space-y-6 overflow-auto h-full">
      {/* Fleet Header Section */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Fleet name and status */}
          <div className="flex items-center gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-lg font-semibold text-herd-fg">
                  Fleet Overview
                </h1>
                <TimeAgo timestamp={lastUpdated} prefix="Updated" />
              </div>
              {fleetStatus && (
                <p className="text-xs text-herd-muted mt-0.5">
                  Uptime: {formatUptime(fleetStatus.uptimeSeconds)}
                </p>
              )}
            </div>
            {fleetStatus && (
              <StatusBadge
                status={
                  fleetStatus.state === "running"
                    ? "running"
                    : fleetStatus.state === "error"
                      ? "error"
                      : "idle"
                }
                size="md"
              />
            )}
          </div>

          {/* Quick stat chips */}
          <div className="flex flex-wrap gap-2">
            <StatChip
              label="agents"
              value={counts.totalAgents}
              variant="default"
            />
            <StatChip
              label="running"
              value={counts.runningJobs}
              variant={counts.runningJobs > 0 ? "success" : "muted"}
            />
            <StatChip
              label="completed"
              value={counts.completedJobs}
              variant="muted"
            />
          </div>
        </div>
      </Card>

      {/* Agent Card Grid */}
      <section>
        <h2 className="text-sm font-semibold text-herd-fg mb-3">Agents</h2>
        {agents.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-herd-muted">
              No agents configured. Add agents to your herd.yaml to get started.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <AgentCard key={agent.name} agent={agent} />
            ))}
          </div>
        )}
      </section>

      {/* Recent Jobs Section */}
      <section>
        <Card className="p-4">
          <RecentJobs jobs={recentJobs} limit={10} />
        </Card>
      </section>
    </div>
  );
}
