/**
 * AgentDetail component
 *
 * Main agent detail page with tab navigation.
 * Tabs: Output (default), Jobs, Config
 */

import { useState } from "react";
import { useParams, Link } from "react-router";
import { ArrowLeft, Terminal, History, Settings } from "lucide-react";
import { useAgentDetail } from "../../hooks/useAgentDetail";
import { Card, Spinner } from "../ui";
import { AgentHeader } from "./AgentHeader";
import { AgentOutput } from "./AgentOutput";
import { AgentJobs } from "./AgentJobs";
import { AgentConfig } from "./AgentConfig";

// =============================================================================
// Types
// =============================================================================

type TabId = "output" | "jobs" | "config";

interface Tab {
  id: TabId;
  label: string;
  icon: typeof Terminal;
}

// =============================================================================
// Constants
// =============================================================================

const TABS: Tab[] = [
  { id: "output", label: "Output", icon: Terminal },
  { id: "jobs", label: "Jobs", icon: History },
  { id: "config", label: "Config", icon: Settings },
];

// =============================================================================
// Sub-Components
// =============================================================================

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return (
    <div className="flex border-b border-herd-border">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`
              flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors
              border-b-2 -mb-px
              ${
                isActive
                  ? "text-herd-primary border-herd-primary"
                  : "text-herd-muted hover:text-herd-fg border-transparent hover:border-herd-border"
              }
            `}
          >
            <Icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

interface NotFoundProps {
  name: string;
}

function NotFound({ name }: NotFoundProps) {
  return (
    <div className="p-4 h-full flex items-center justify-center">
      <Card className="p-6 max-w-md w-full text-center">
        <h2 className="text-lg font-semibold text-herd-fg mb-2">
          Agent Not Found
        </h2>
        <p className="text-sm text-herd-muted mb-4">
          No agent named "{name}" exists in the fleet.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-herd-primary hover:text-herd-primary-hover text-xs font-medium transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Dashboard
        </Link>
      </Card>
    </div>
  );
}

interface LoadingStateProps {
  name: string;
}

function LoadingState({ name }: LoadingStateProps) {
  return (
    <div className="p-4 h-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Spinner size="lg" />
        <p className="text-sm text-herd-muted">Loading agent "{name}"...</p>
      </div>
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="p-4 h-full flex items-center justify-center">
      <Card className="p-6 max-w-md w-full">
        <div className="bg-herd-status-error/10 border border-herd-status-error/20 text-herd-status-error rounded-lg px-3 py-2 text-xs mb-4">
          {message}
        </div>
        <div className="flex gap-2 justify-center">
          <button
            onClick={onRetry}
            className="bg-herd-primary hover:bg-herd-primary-hover text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
          >
            Retry
          </button>
          <Link
            to="/"
            className="border border-herd-border hover:bg-herd-hover text-herd-fg rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>
      </Card>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function AgentDetail() {
  const { name } = useParams<{ name: string }>();
  const { agent, loading, error, retry } = useAgentDetail(name ?? null);
  const [activeTab, setActiveTab] = useState<TabId>("output");

  // Handle missing name parameter
  if (!name) {
    return <NotFound name="(unknown)" />;
  }

  // Loading state
  if (loading) {
    return <LoadingState name={name} />;
  }

  // Error state
  if (error) {
    return <ErrorState message={error} onRetry={retry} />;
  }

  // Agent not found
  if (!agent) {
    return <NotFound name={name} />;
  }

  // Render active tab content
  function renderTabContent() {
    switch (activeTab) {
      case "output":
        return <AgentOutput agent={agent!} />;
      case "jobs":
        return <AgentJobs agent={agent!} />;
      case "config":
        return <AgentConfig agent={agent!} />;
      default:
        // This should never happen, but TypeScript requires exhaustive checks
        const exhaustiveCheck: never = activeTab;
        return exhaustiveCheck;
    }
  }

  return (
    <div className="p-4 space-y-4 overflow-auto h-full">
      {/* Back link */}
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-herd-muted hover:text-herd-fg text-xs font-medium transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to Dashboard
      </Link>

      {/* Agent Header */}
      <Card className="p-4">
        <AgentHeader agent={agent} />
      </Card>

      {/* Tab Navigation and Content */}
      <Card className="overflow-hidden">
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
        <div className="p-4">{renderTabContent()}</div>
      </Card>
    </div>
  );
}
