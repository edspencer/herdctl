/**
 * AgentConfig component
 *
 * Read-only config display for the "Config" tab.
 * Shows General info, Schedules, Connectors, and Working Directory.
 */

import { Calendar, Clock, MessageCircle, Webhook } from "lucide-react";
import type { AgentInfo, ChatConnectorStatus, ScheduleInfo } from "../../lib/types";
import { Card } from "../ui";

// =============================================================================
// Types
// =============================================================================

interface AgentConfigProps {
  /** Agent information */
  agent: AgentInfo;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get icon for schedule type
 */
function getScheduleIcon(type: string) {
  switch (type) {
    case "interval":
      return Clock;
    case "cron":
      return Calendar;
    case "webhook":
      return Webhook;
    case "chat":
      return MessageCircle;
    default:
      return Clock;
  }
}

/**
 * Format schedule display string
 */
function formatScheduleValue(schedule: ScheduleInfo): string {
  if (schedule.interval) {
    return schedule.interval;
  }
  if (schedule.expression) {
    return schedule.expression;
  }
  return schedule.type;
}

/**
 * Get connector status color
 */
function getConnectorStatusColor(status: string): string {
  if (status === "connected" || status === "ready") {
    return "text-herd-status-running";
  }
  if (status === "error" || status === "failed") {
    return "text-herd-status-error";
  }
  return "text-herd-status-idle";
}

// =============================================================================
// Sub-Components
// =============================================================================

interface ConfigSectionProps {
  title: string;
  children: React.ReactNode;
}

function ConfigSection({ title, children }: ConfigSectionProps) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-herd-fg mb-3">{title}</h3>
      {children}
    </Card>
  );
}

interface ConfigRowProps {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}

function ConfigRow({ label, value, mono = false }: ConfigRowProps) {
  const displayValue = value ?? "--";
  return (
    <div className="flex justify-between items-baseline gap-4 py-1.5">
      <dt className="text-xs text-herd-muted shrink-0">{label}</dt>
      <dd
        className={`text-xs text-herd-fg text-right truncate ${mono ? "font-mono" : ""}`}
        title={typeof displayValue === "string" ? displayValue : undefined}
      >
        {displayValue}
      </dd>
    </div>
  );
}

interface ScheduleRowProps {
  schedule: ScheduleInfo;
}

function ScheduleRow({ schedule }: ScheduleRowProps) {
  const Icon = getScheduleIcon(schedule.type);
  const statusColor =
    schedule.status === "running"
      ? "text-herd-status-running"
      : schedule.status === "disabled"
        ? "text-herd-status-error"
        : "text-herd-status-idle";

  return (
    <tr className="border-b border-herd-border last:border-b-0">
      <td className="py-2 pr-3">
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-herd-muted" />
          <span className="text-xs text-herd-fg">{schedule.name}</span>
        </div>
      </td>
      <td className="py-2 px-3 text-xs text-herd-muted capitalize">{schedule.type}</td>
      <td className="py-2 px-3 text-xs text-herd-fg font-mono">{formatScheduleValue(schedule)}</td>
      <td className={`py-2 pl-3 text-xs capitalize ${statusColor}`}>{schedule.status}</td>
    </tr>
  );
}

interface ConnectorRowProps {
  name: string;
  connector: ChatConnectorStatus;
}

function ConnectorRow({ name, connector }: ConnectorRowProps) {
  const status = connector.connectionStatus ?? (connector.configured ? "configured" : "inactive");
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-herd-fg capitalize">{name}</span>
      <span className={`text-xs ${getConnectorStatusColor(status)}`}>{status}</span>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function AgentConfig({ agent }: AgentConfigProps) {
  return (
    <div className="space-y-4">
      {/* General Section */}
      <ConfigSection title="General">
        <dl className="divide-y divide-herd-border">
          <ConfigRow label="Name" value={agent.name} />
          <ConfigRow label="Description" value={agent.description} />
          <ConfigRow label="Model" value={agent.model} mono />
          <ConfigRow label="Permission Mode" value={agent.permission_mode} />
          <ConfigRow label="Max Concurrent" value={agent.maxConcurrent} />
        </dl>
      </ConfigSection>

      {/* Schedules Section */}
      <ConfigSection title="Schedules">
        {agent.schedules.length === 0 ? (
          <p className="text-xs text-herd-muted">No schedules configured</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-xs text-herd-muted font-medium uppercase tracking-wide border-b border-herd-border">
                <th className="text-left py-2 pr-3">Name</th>
                <th className="text-left py-2 px-3">Type</th>
                <th className="text-left py-2 px-3">Value</th>
                <th className="text-left py-2 pl-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {agent.schedules.map((schedule) => (
                <ScheduleRow key={schedule.name} schedule={schedule} />
              ))}
            </tbody>
          </table>
        )}
      </ConfigSection>

      {/* Connectors Section */}
      <ConfigSection title="Chat Connectors">
        {!agent.chat || Object.keys(agent.chat).length === 0 ? (
          <p className="text-xs text-herd-muted">No chat connectors configured</p>
        ) : (
          <div className="divide-y divide-herd-border">
            {Object.entries(agent.chat).map(([name, connector]) => (
              <ConnectorRow key={name} name={name} connector={connector} />
            ))}
          </div>
        )}
      </ConfigSection>

      {/* Working Directory Section */}
      {agent.working_directory && (
        <ConfigSection title="Environment">
          <dl>
            <ConfigRow label="Working Directory" value={agent.working_directory} mono />
          </dl>
        </ConfigSection>
      )}
    </div>
  );
}
