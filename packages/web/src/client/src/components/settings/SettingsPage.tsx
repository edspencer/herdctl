/**
 * Settings page for @herdctl/web
 *
 * Provides:
 * - Theme toggle (Light / Dark / System)
 * - Fleet information display
 */

import { Sun, Moon, Monitor, Server, Users } from "lucide-react";
import { useUI, useUIActions, useFleet } from "../../store";
import type { Theme } from "../../lib/types";

// =============================================================================
// Theme Option Button
// =============================================================================

interface ThemeOptionProps {
  value: Theme;
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onSelect: (theme: Theme) => void;
}

function ThemeOption({ value, label, icon, isActive, onSelect }: ThemeOptionProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
        isActive
          ? "bg-herd-primary text-white"
          : "bg-herd-hover text-herd-fg hover:bg-herd-active"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// =============================================================================
// Info Row
// =============================================================================

interface InfoRowProps {
  label: string;
  value: string | number | null | undefined;
}

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className="text-xs text-herd-muted">{label}</span>
      <span className="text-sm text-herd-fg font-mono">
        {value ?? "\u2014"}
      </span>
    </div>
  );
}

// =============================================================================
// Format Helpers
// =============================================================================

function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null) {
    return "\u2014";
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0 || secs > 0) parts.push(`${secs}s`);

  return parts.join(" ");
}

function formatState(state: string | undefined): string {
  if (!state) return "\u2014";
  return state.charAt(0).toUpperCase() + state.slice(1);
}

// =============================================================================
// SettingsPage Component
// =============================================================================

export function SettingsPage() {
  const { theme } = useUI();
  const { setTheme } = useUIActions();
  const { fleetStatus, agents, connectionStatus } = useFleet();

  const counts = fleetStatus?.counts;

  return (
    <div className="p-4 h-full overflow-auto">
      <h1 className="text-lg font-semibold text-herd-fg mb-4">Settings</h1>

      <div className="max-w-2xl space-y-4">
        {/* ---- Appearance Card ---- */}
        <div className="bg-herd-card border border-herd-border rounded-[10px] p-4">
          <h2 className="text-sm font-medium text-herd-fg mb-3">Appearance</h2>
          <p className="text-xs text-herd-muted mb-3">
            Choose how the dashboard looks. System mode follows your OS preference.
          </p>
          <div className="flex gap-2">
            <ThemeOption
              value="light"
              label="Light"
              icon={<Sun className="w-4 h-4" />}
              isActive={theme === "light"}
              onSelect={setTheme}
            />
            <ThemeOption
              value="dark"
              label="Dark"
              icon={<Moon className="w-4 h-4" />}
              isActive={theme === "dark"}
              onSelect={setTheme}
            />
            <ThemeOption
              value="system"
              label="System"
              icon={<Monitor className="w-4 h-4" />}
              isActive={theme === "system"}
              onSelect={setTheme}
            />
          </div>
        </div>

        {/* ---- Fleet Information Card ---- */}
        <div className="bg-herd-card border border-herd-border rounded-[10px] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Server className="w-4 h-4 text-herd-muted" />
            <h2 className="text-sm font-medium text-herd-fg">Fleet Information</h2>
          </div>
          <div className="divide-y divide-herd-border">
            <InfoRow label="State" value={formatState(fleetStatus?.state)} />
            <InfoRow label="Uptime" value={formatUptime(fleetStatus?.uptimeSeconds)} />
            <InfoRow label="Total Agents" value={counts?.totalAgents} />
            <InfoRow label="Running Agents" value={counts?.runningAgents} />
            <InfoRow label="Total Jobs" value={counts?.totalJobs} />
            <InfoRow label="Completed Jobs" value={counts?.completedJobs} />
            <InfoRow label="Failed Jobs" value={counts?.failedJobs} />
            <InfoRow
              label="Scheduler"
              value={formatState(fleetStatus?.scheduler.status)}
            />
            <InfoRow
              label="Scheduler Triggers"
              value={fleetStatus?.scheduler.triggerCount}
            />
          </div>
        </div>

        {/* ---- Agents Overview Card ---- */}
        <div className="bg-herd-card border border-herd-border rounded-[10px] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-herd-muted" />
            <h2 className="text-sm font-medium text-herd-fg">Agents</h2>
          </div>
          {agents.length === 0 ? (
            <p className="text-xs text-herd-muted">No agents configured</p>
          ) : (
            <div className="divide-y divide-herd-border">
              {agents.map((agent) => (
                <div
                  key={agent.name}
                  className="flex items-center justify-between py-1.5"
                >
                  <span className="text-sm text-herd-fg">{agent.name}</span>
                  <span
                    className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
                      agent.status === "running"
                        ? "text-herd-status-running"
                        : agent.status === "error"
                          ? "text-herd-status-error"
                          : "text-herd-status-idle"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        agent.status === "running"
                          ? "bg-herd-status-running animate-pulse"
                          : agent.status === "error"
                            ? "bg-herd-status-error"
                            : "bg-herd-status-idle"
                      }`}
                    />
                    {agent.status.charAt(0).toUpperCase() + agent.status.slice(1)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ---- Connection Card ---- */}
        <div className="bg-herd-card border border-herd-border rounded-[10px] p-4">
          <h2 className="text-sm font-medium text-herd-fg mb-3">Connection</h2>
          <div className="divide-y divide-herd-border">
            <div className="flex items-center justify-between py-1.5">
              <span className="text-xs text-herd-muted">WebSocket</span>
              <span
                className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
                  connectionStatus === "connected"
                    ? "text-herd-status-running"
                    : connectionStatus === "reconnecting"
                      ? "text-herd-status-pending"
                      : "text-herd-status-error"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    connectionStatus === "connected"
                      ? "bg-herd-status-running"
                      : connectionStatus === "reconnecting"
                        ? "bg-herd-status-pending animate-pulse"
                        : "bg-herd-status-idle"
                  }`}
                />
                {connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
