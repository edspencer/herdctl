/**
 * FleetDashboard component
 *
 * Main dashboard page showing fleet overview, agent cards, and recent jobs.
 */

import { useEffect } from "react";
import { Server, History } from "lucide-react";
import { useFleet, useFleetActions } from "../../store";
import { useFleetStatus } from "../../hooks/useFleetStatus";
import { fetchJobs } from "../../lib/api";
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
      <span className={`text-sm font-medium ${colorClasses[variant]}`}>{value}</span>
      <span className="text-xs text-herd-muted">{label}</span>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

// =============================================================================
// Loading Placeholder Components
// =============================================================================

function LoadingAgentCards() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[1, 2, 3].map((i) => (
        <Card key={i} className="p-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-herd-hover opacity-50 animate-pulse" />
              <div className="h-4 w-24 bg-herd-hover opacity-50 animate-pulse rounded" />
            </div>
            <div className="h-3 w-32 bg-herd-hover opacity-50 animate-pulse rounded" />
            <div className="h-3 w-20 bg-herd-hover opacity-50 animate-pulse rounded" />
          </div>
        </Card>
      ))}
    </div>
  );
}

function LoadingHeaderCard() {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-5 w-36 bg-herd-hover opacity-50 animate-pulse rounded" />
          <div className="h-3 w-24 bg-herd-hover opacity-50 animate-pulse rounded" />
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-20 bg-herd-hover opacity-50 animate-pulse rounded-lg" />
          <div className="h-8 w-20 bg-herd-hover opacity-50 animate-pulse rounded-lg" />
        </div>
      </div>
    </Card>
  );
}

function LoadingRecentJobs() {
  return (
    <Card className="p-4">
      <div className="h-4 w-24 bg-herd-hover opacity-50 animate-pulse rounded mb-4" />
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="h-3 w-20 bg-herd-hover opacity-50 animate-pulse rounded" />
            <div className="h-3 w-40 bg-herd-hover opacity-50 animate-pulse rounded flex-1" />
            <div className="h-3 w-16 bg-herd-hover opacity-50 animate-pulse rounded" />
          </div>
        ))}
      </div>
    </Card>
  );
}

function AgentsEmptyState() {
  return (
    <Card className="p-6">
      <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
        <Server className="w-12 h-12 text-herd-muted" />
        <div>
          <p className="text-sm text-herd-fg font-medium">No agents configured</p>
          <p className="text-xs text-herd-muted mt-1">
            Add agents to your herdctl.yaml to get started
          </p>
        </div>
      </div>
    </Card>
  );
}

function RecentJobsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <History className="w-12 h-12 text-herd-muted" />
      <div>
        <p className="text-sm text-herd-fg font-medium">No jobs yet</p>
        <p className="text-xs text-herd-muted mt-1">Jobs will appear here when agents run</p>
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

/** Cutoff for "recent" jobs: 24 hours */
const RECENT_HOURS = 24;

export function FleetDashboard() {
  const { fleetStatus, agents, recentJobs, lastUpdated } = useFleet();
  const { setRecentJobs } = useFleetActions();
  const { loading } = useFleetStatus();

  // Seed recent jobs from the REST API on mount
  useEffect(() => {
    fetchJobs({ limit: 100 })
      .then((response) => {
        setRecentJobs(response.jobs);
      })
      .catch(() => {
        // Non-critical — dashboard still works from WebSocket events
      });
  }, [setRecentJobs]);

  // Filter to last 24 hours
  const cutoff = Date.now() - RECENT_HOURS * 60 * 60 * 1000;
  const recentJobsFiltered = recentJobs.filter(
    (job) => new Date(job.createdAt).getTime() >= cutoff,
  );

  const counts = fleetStatus?.counts ?? {
    totalAgents: 0,
    runningAgents: 0,
    idleAgents: 0,
    errorAgents: 0,
    totalSchedules: 0,
    runningSchedules: 0,
    runningJobs: 0,
  };

  // Derive completed job count from the fetched recent jobs
  const completedJobCount = recentJobs.filter((j) => j.status === "completed").length;

  // Show loading placeholders when initial data is loading
  if (loading && !fleetStatus) {
    return (
      <div className="p-4 space-y-6 overflow-auto h-full">
        <LoadingHeaderCard />
        <section>
          <h2 className="text-sm font-semibold text-herd-fg mb-3">Agents</h2>
          <LoadingAgentCards />
        </section>
        <section>
          <LoadingRecentJobs />
        </section>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 overflow-auto h-full">
      {/* Fleet Header Section */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Fleet name and status */}
          <div className="flex items-center gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-lg font-semibold text-herd-fg">Fleet Overview</h1>
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
            <StatChip label="agents" value={counts.totalAgents} variant="default" />
            <StatChip
              label="running"
              value={counts.runningJobs}
              variant={counts.runningJobs > 0 ? "success" : "muted"}
            />
            <StatChip label="completed" value={completedJobCount} variant="muted" />
          </div>
        </div>
      </Card>

      {/* Agent Card Grid */}
      <section>
        <h2 className="text-sm font-semibold text-herd-fg mb-3">Agents</h2>
        {agents.length === 0 ? (
          <AgentsEmptyState />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <AgentCard key={agent.qualifiedName} agent={agent} />
            ))}
          </div>
        )}
      </section>

      {/* Recent Jobs Section */}
      <section>
        <Card className="p-4">
          {recentJobsFiltered.length === 0 ? (
            <>
              <h2 className="text-sm font-semibold text-herd-fg mb-3">Recent Jobs</h2>
              <RecentJobsEmptyState />
            </>
          ) : (
            <RecentJobs jobs={recentJobsFiltered} pageSize={10} />
          )}
        </Card>
      </section>
    </div>
  );
}
