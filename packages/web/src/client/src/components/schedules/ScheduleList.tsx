/**
 * ScheduleList component
 *
 * Full-page table of all schedules across all agents.
 * Supports triggering, enabling/disabling, and displays schedule metadata.
 */

import { Calendar, Play, Power, PowerOff } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router";
import type { ScheduleInfo, ScheduleType } from "../../lib/types";
import { useScheduleActions, useSchedules } from "../../store";
import { Card, Spinner, StatusBadge } from "../ui";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get display label for a schedule type
 */
function getTypeLabel(type: ScheduleType): string {
  switch (type) {
    case "interval":
      return "Interval";
    case "cron":
      return "Cron";
    case "webhook":
      return "Webhook";
    case "chat":
      return "Chat";
  }
}

/**
 * Get the expression string for a schedule (cron expression or interval)
 */
function getExpression(schedule: ScheduleInfo): string {
  if (schedule.expression) return schedule.expression;
  if (schedule.interval) return schedule.interval;
  return "-";
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return "-";

  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// =============================================================================
// Sub-Components
// =============================================================================

interface ScheduleRowProps {
  schedule: ScheduleInfo;
  onTrigger: (agentName: string, scheduleName: string) => void;
  onEnable: (agentName: string, scheduleName: string) => void;
  onDisable: (agentName: string, scheduleName: string) => void;
}

function ScheduleRow({ schedule, onTrigger, onEnable, onDisable }: ScheduleRowProps) {
  const isDisabled = schedule.status === "disabled";

  return (
    <tr className="hover:bg-herd-hover transition-colors">
      <td className="py-2 px-3 text-herd-fg">
        <Link
          to={`/agents/${encodeURIComponent(schedule.agentName)}`}
          className="text-herd-primary hover:text-herd-primary-hover transition-colors"
        >
          {schedule.agentName}
        </Link>
      </td>
      <td className="py-2 px-3 text-herd-fg">{schedule.name}</td>
      <td className="py-2 px-3">
        <span className="inline-flex items-center bg-herd-hover rounded-lg px-2 py-0.5 text-[11px] font-medium text-herd-muted">
          {getTypeLabel(schedule.type)}
        </span>
      </td>
      <td className="py-2 px-3 text-herd-muted text-xs font-mono">{getExpression(schedule)}</td>
      <td className="py-2 px-3">
        <StatusBadge status={schedule.status} />
      </td>
      <td className="py-2 px-3 text-herd-muted text-xs">{formatTimestamp(schedule.lastRunAt)}</td>
      <td className="py-2 px-3 text-herd-muted text-xs">{formatTimestamp(schedule.nextRunAt)}</td>
      <td className="py-2 px-3">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onTrigger(schedule.agentName, schedule.name)}
            className="bg-herd-primary hover:bg-herd-primary-hover text-white rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Trigger Now"
          >
            <Play className="w-3 h-3" />
            Trigger
          </button>
          {isDisabled ? (
            <button
              onClick={() => onEnable(schedule.agentName, schedule.name)}
              className="hover:bg-herd-hover text-herd-muted hover:text-herd-status-running rounded-lg p-1.5 transition-colors"
              title="Enable schedule"
            >
              <Power className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={() => onDisable(schedule.agentName, schedule.name)}
              className="hover:bg-herd-hover text-herd-muted hover:text-herd-status-error rounded-lg p-1.5 transition-colors"
              title="Disable schedule"
            >
              <PowerOff className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <Calendar className="w-12 h-12 text-herd-muted" />
      <div>
        <p className="text-sm text-herd-fg font-medium">No schedules configured</p>
        <p className="text-xs text-herd-muted mt-1">
          Schedules will appear here once agents have interval, cron, or webhook triggers defined
        </p>
      </div>
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="bg-herd-status-error/10 border border-herd-status-error/20 text-herd-status-error rounded-lg px-3 py-2 text-xs mb-4 flex items-center justify-between">
      <span>{message}</span>
      <button onClick={onRetry} className="hover:underline font-medium ml-4">
        Retry
      </button>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function ScheduleList() {
  const { schedules, schedulesLoading, schedulesError } = useSchedules();
  const { fetchSchedules, triggerSchedule, enableSchedule, disableSchedule } = useScheduleActions();

  // Fetch schedules on mount
  useEffect(() => {
    fetchSchedules().catch(() => {
      // Error is already handled in fetchSchedules, which sets schedulesError
    });
  }, [fetchSchedules]);

  // Handlers
  const handleTrigger = (agentName: string, scheduleName: string) => {
    triggerSchedule(agentName, scheduleName).catch(() => {
      // Error handled in store
    });
  };

  const handleEnable = (agentName: string, scheduleName: string) => {
    enableSchedule(agentName, scheduleName).catch(() => {
      // Error handled in store
    });
  };

  const handleDisable = (agentName: string, scheduleName: string) => {
    disableSchedule(agentName, scheduleName).catch(() => {
      // Error handled in store
    });
  };

  // Show loading spinner on initial load only
  if (schedulesLoading && schedules.length === 0 && !schedulesError) {
    return (
      <Card className="p-6">
        <div className="flex flex-col items-center justify-center gap-3 py-8">
          <Spinner size="lg" />
          <p className="text-sm text-herd-muted">Loading schedules...</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      {/* Header with title and loading indicator */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-herd-fg">All Schedules</h2>
        {schedulesLoading && schedules.length > 0 && <Spinner size="sm" />}
      </div>

      {/* Error banner */}
      {schedulesError && <ErrorBanner message={schedulesError} onRetry={fetchSchedules} />}

      {/* Table or empty state */}
      {schedules.length === 0 && !schedulesLoading ? (
        <EmptyState />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-herd-border text-[11px] text-herd-muted font-medium uppercase tracking-wide">
                <th className="text-left py-2 px-3">Agent</th>
                <th className="text-left py-2 px-3">Schedule</th>
                <th className="text-left py-2 px-3">Type</th>
                <th className="text-left py-2 px-3">Expression</th>
                <th className="text-left py-2 px-3">Status</th>
                <th className="text-left py-2 px-3">Last Run</th>
                <th className="text-left py-2 px-3">Next Run</th>
                <th className="text-left py-2 px-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-herd-border">
              {schedules.map((schedule) => (
                <ScheduleRow
                  key={`${schedule.agentName}:${schedule.name}`}
                  schedule={schedule}
                  onTrigger={handleTrigger}
                  onEnable={handleEnable}
                  onDisable={handleDisable}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
