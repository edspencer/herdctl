/**
 * AgentJobs component
 *
 * Displays job history for a specific agent using the shared JobHistory component.
 */

import { JobHistory } from "../jobs";
import type { AgentInfo } from "../../lib/types";

// =============================================================================
// Types
// =============================================================================

interface AgentJobsProps {
  /** Agent information */
  agent: AgentInfo;
}

// =============================================================================
// Component
// =============================================================================

export function AgentJobs({ agent }: AgentJobsProps) {
  return <JobHistory agentName={agent.name} />;
}
