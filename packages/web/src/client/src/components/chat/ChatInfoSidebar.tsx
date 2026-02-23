/**
 * ChatInfoSidebar component
 *
 * Right-side info panel for the active chat session.
 * Shows session actions (continue in Claude Code, copy session ID),
 * live token usage stats, and session metadata.
 */

import { Check, Copy, Terminal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { fetchSdkSessionId } from "../../lib/api";
import { useAgent, useChatMessages, useChatTokenUsage } from "../../store";

// =============================================================================
// Types
// =============================================================================

interface ChatInfoSidebarProps {
  agentName: string;
  sessionId: string;
  createdAt?: string;
}

// =============================================================================
// Sub-Components
// =============================================================================

/** Section header matching design system */
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs text-herd-sidebar-muted font-medium uppercase tracking-wide mb-2">
      {children}
    </h3>
  );
}

/** Copy button following the CopyButton pattern from JobDetail */
function CopyAction({
  text,
  label,
  icon,
}: {
  text: string;
  label: string;
  icon?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* fallback: silently fail if clipboard API is not available */
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="w-full flex items-center gap-2 hover:bg-herd-sidebar-hover text-herd-sidebar-muted hover:text-herd-sidebar-fg rounded-lg px-2 py-1.5 text-xs font-medium transition-colors text-left"
      title={label}
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 shrink-0 text-herd-status-running" />
          <span className="text-herd-status-running truncate">Copied!</span>
        </>
      ) : (
        <>
          {icon ?? <Copy className="w-3.5 h-3.5 shrink-0" />}
          <span className="truncate">{label}</span>
        </>
      )}
    </button>
  );
}

/** Key-value info row */
function InfoRow({
  label,
  value,
  mono,
  truncate,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] text-herd-sidebar-muted">{label}</span>
      <span
        className={`text-xs text-herd-sidebar-fg ${mono ? "font-mono" : ""} ${truncate ? "truncate" : ""}`}
        title={truncate ? value : undefined}
      >
        {value}
      </span>
    </div>
  );
}

/** Context window progress bar */
function ContextProgressBar({
  inputTokens,
  contextWindow,
}: {
  inputTokens: number;
  contextWindow: number;
}) {
  const percentage = Math.min((inputTokens / contextWindow) * 100, 100);
  const label = `${percentage.toFixed(0)}%`;

  // Color thresholds: green < 60%, amber 60-85%, red > 85%
  let barColor = "bg-herd-status-running";
  if (percentage >= 85) barColor = "bg-herd-status-error";
  else if (percentage >= 60) barColor = "bg-herd-status-pending";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-herd-sidebar-muted">Context window</span>
        <span className="text-herd-sidebar-muted font-mono">{label}</span>
      </div>
      <div className="h-1.5 rounded-full bg-herd-sidebar-hover overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} transition-all`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

/** Format a token count for display */
function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 10_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }
  return count.toLocaleString();
}

/** Format an ISO timestamp to a relative or short date string */
function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60_000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    // For older dates, show short date
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// =============================================================================
// Main Component
// =============================================================================

export function ChatInfoSidebar({ agentName, sessionId, createdAt }: ChatInfoSidebarProps) {
  const agent = useAgent(agentName);
  const { chatMessages } = useChatMessages();
  const { lastInputTokens, totalOutputTokens, hasTokenData } = useChatTokenUsage();
  const [sdkSessionId, setSdkSessionId] = useState<string | null>(null);
  const [sdkSessionLoading, setSdkSessionLoading] = useState(false);
  const [dockerEnabled, setDockerEnabled] = useState(false);

  // Fetch SDK session ID when session changes
  useEffect(() => {
    setSdkSessionId(null);
    setDockerEnabled(false);
    setSdkSessionLoading(true);
    fetchSdkSessionId(agentName, sessionId)
      .then((res) => {
        setSdkSessionId(res.sdkSessionId);
        setDockerEnabled(res.dockerEnabled ?? false);
      })
      .catch(() => {})
      .finally(() => setSdkSessionLoading(false));
  }, [agentName, sessionId]);

  const workDir = agent?.working_directory;
  const model = agent?.model ?? "unknown";

  // Default context window: 200k for all current Claude models
  const contextWindow = 200_000;

  // Build "Continue in Claude Code" command (only for non-Docker agents)
  const resumeCommand =
    sdkSessionId && !dockerEnabled
      ? `${workDir ? `cd ${workDir} && ` : ""}claude --resume ${sdkSessionId}`
      : null;

  return (
    <div className="w-[220px] h-full border-l border-herd-sidebar-border bg-herd-sidebar overflow-y-auto">
      <div className="p-3 space-y-4">
        {/* Session Actions */}
        <div>
          <SectionHeader>Actions</SectionHeader>
          <div className="space-y-0.5">
            {resumeCommand ? (
              <CopyAction
                text={resumeCommand}
                label="Continue in Claude"
                icon={<Terminal className="w-3.5 h-3.5 shrink-0" />}
              />
            ) : (
              <div className="px-2 py-1.5 text-xs text-herd-sidebar-muted">
                {sdkSessionLoading
                  ? "Loading..."
                  : dockerEnabled
                    ? "Docker session (host resume N/A)"
                    : "No SDK session yet"}
              </div>
            )}
            <CopyAction text={sessionId} label="Copy Session ID" />
          </div>
        </div>

        {/* Token Usage */}
        <div>
          <SectionHeader>Token Usage</SectionHeader>
          {hasTokenData ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[11px] text-herd-sidebar-muted">Input</div>
                  <div className="text-sm font-mono text-herd-sidebar-fg">
                    {formatTokens(lastInputTokens)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-herd-sidebar-muted">Output</div>
                  <div className="text-sm font-mono text-herd-sidebar-fg">
                    {formatTokens(totalOutputTokens)}
                  </div>
                </div>
              </div>
              <ContextProgressBar inputTokens={lastInputTokens} contextWindow={contextWindow} />
            </div>
          ) : (
            <div className="text-xs text-herd-sidebar-muted">N/A</div>
          )}
        </div>

        {/* Session Info */}
        <div>
          <SectionHeader>Session</SectionHeader>
          <div className="space-y-1.5">
            <InfoRow label="Messages" value={String(chatMessages.length)} />
            <InfoRow label="Model" value={model} mono />
            {workDir && <InfoRow label="Directory" value={workDir} mono truncate />}
            {createdAt && <InfoRow label="Created" value={formatTimestamp(createdAt)} />}
          </div>
        </div>
      </div>
    </div>
  );
}
