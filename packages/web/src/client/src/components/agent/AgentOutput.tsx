/**
 * AgentOutput component
 *
 * Main output component for the Output tab.
 * Manages WebSocket subscription and displays live output for the agent's current job.
 */

import { Terminal, History } from "lucide-react";
import { useJobOutput } from "../../hooks/useJobOutput";
import { Card } from "../ui";
import { JobOutput } from "./JobOutput";
import type { AgentInfo } from "../../lib/types";

// =============================================================================
// Types
// =============================================================================

interface AgentOutputProps {
  /** Agent information */
  agent: AgentInfo;
}

// =============================================================================
// Sub-Components
// =============================================================================

interface NoActiveJobProps {
  lastJobId: string | null;
  onViewLastJob?: () => void;
}

function NoActiveJob({ lastJobId, onViewLastJob }: NoActiveJobProps) {
  return (
    <Card className="p-6">
      <div className="flex flex-col items-center justify-center gap-3 text-center">
        <Terminal className="w-12 h-12 text-herd-muted" />
        <div>
          <p className="text-sm text-herd-fg font-medium">No Active Job</p>
          <p className="text-xs text-herd-muted mt-1">
            Trigger a job or wait for a scheduled run to see live output
          </p>
        </div>
        {lastJobId && onViewLastJob && (
          <button
            onClick={onViewLastJob}
            className="
              flex items-center gap-1.5 mt-2
              text-herd-primary hover:text-herd-primary-hover
              text-xs font-medium transition-colors
            "
          >
            <History className="w-3.5 h-3.5" />
            View last job output
          </button>
        )}
      </div>
    </Card>
  );
}

// =============================================================================
// Component
// =============================================================================

export function AgentOutput({ agent }: AgentOutputProps) {
  const hasActiveJob = agent.status === "running" && agent.currentJobId;
  const jobIdToDisplay = hasActiveJob ? agent.currentJobId : null;

  // Subscribe to the agent's output stream
  const { messages } = useJobOutput({
    agentName: agent.name,
    jobId: jobIdToDisplay,
  });

  // If no active job, show placeholder with option to view last job
  if (!hasActiveJob) {
    return (
      <NoActiveJob
        lastJobId={agent.lastJobId}
        // Note: Viewing historical job output would require fetching from API
        // For now, we only support live streaming. Historical view can be added later.
        onViewLastJob={undefined}
      />
    );
  }

  // Render live output for the active job
  return (
    <Card className="overflow-hidden">
      <JobOutput
        jobId={agent.currentJobId!}
        messages={messages}
        startTime={undefined} // Could be enhanced to pass job start time if available
      />
    </Card>
  );
}
