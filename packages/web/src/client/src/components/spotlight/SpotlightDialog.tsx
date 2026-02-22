/**
 * SpotlightDialog component
 *
 * Apple Spotlight-style dialog for quickly starting a new chat with an agent.
 * Opens with Cmd+K / Ctrl+K and allows searching/selecting agents.
 *
 * Features:
 * - Auto-focused search input
 * - Real-time agent filtering
 * - Keyboard navigation (Arrow Up/Down, Enter, Escape)
 * - Pre-selects most recently active agent
 * - Creates new chat session and navigates to it
 */

import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { getAgentAvatar } from "../../lib/avatar";
import { agentChatPath } from "../../lib/paths";
import type { AgentInfo } from "../../lib/types";
import {
  useChatActions,
  useFleet,
  useRecentSessions,
  useSpotlightOpen,
  useUIActions,
} from "../../store";

// =============================================================================
// Status Dot Component
// =============================================================================

function StatusDot({ status }: { status: AgentInfo["status"] }) {
  const colorClass =
    status === "idle" ? "bg-emerald-400" : status === "running" ? "bg-amber-400" : "bg-red-400";

  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${colorClass}`} />;
}

// =============================================================================
// Main Component
// =============================================================================

export function SpotlightDialog() {
  const navigate = useNavigate();
  const spotlightOpen = useSpotlightOpen();
  const { setSpotlightOpen } = useUIActions();
  const { agents } = useFleet();
  const recentSessions = useRecentSessions();
  const { createChatSession } = useChatActions();

  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter agents based on search query
  const filteredAgents = useMemo(() => {
    if (!query.trim()) {
      return agents;
    }
    const lowerQuery = query.toLowerCase();
    return agents.filter(
      (agent) =>
        agent.qualifiedName.toLowerCase().includes(lowerQuery) ||
        agent.name.toLowerCase().includes(lowerQuery) ||
        agent.description?.toLowerCase().includes(lowerQuery),
    );
  }, [agents, query]);

  // Determine default agent from recent sessions
  const defaultAgentIndex = useMemo(() => {
    if (recentSessions.length > 0) {
      const recentAgentName = recentSessions[0].agentName;
      const index = filteredAgents.findIndex((a) => a.qualifiedName === recentAgentName);
      return index >= 0 ? index : 0;
    }
    return 0;
  }, [recentSessions, filteredAgents]);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (spotlightOpen) {
      setQuery("");
      setError(null);
      setIsCreating(false);
      // Set initial highlight to default agent after agents are available
      setHighlightedIndex(defaultAgentIndex);
      // Focus input on next tick
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [spotlightOpen, defaultAgentIndex]);

  // Reset highlighted index when query changes (query is intentionally in deps to trigger reset)
  // biome-ignore lint/correctness/useExhaustiveDependencies: query triggers highlight reset
  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return;
    const highlighted = listRef.current.children[highlightedIndex] as HTMLElement | undefined;
    if (highlighted) {
      highlighted.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  // Handle agent selection
  const handleSelect = useCallback(
    async (agent: AgentInfo) => {
      if (isCreating) return;

      setIsCreating(true);
      setError(null);

      const sessionId = await createChatSession(agent.qualifiedName);

      if (sessionId) {
        setSpotlightOpen(false);
        navigate(agentChatPath(agent.qualifiedName, sessionId));
      } else {
        setError("Failed to create chat session. Please try again.");
        setIsCreating(false);
      }
    },
    [createChatSession, navigate, setSpotlightOpen, isCreating],
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % filteredAgents.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 + filteredAgents.length) % filteredAgents.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredAgents.length > 0) {
          handleSelect(filteredAgents[highlightedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSpotlightOpen(false);
      }
    },
    [filteredAgents, highlightedIndex, setSpotlightOpen, handleSelect],
  );

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        setSpotlightOpen(false);
      }
    },
    [setSpotlightOpen],
  );

  // Don't render if not open
  if (!spotlightOpen) {
    return null;
  }

  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismissal pattern
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismissal pattern
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/30"
      onClick={handleBackdropClick}
      style={{ paddingTop: "20vh" }}
    >
      <div className="bg-herd-card border border-herd-border rounded-[10px] shadow-lg max-w-md w-full mx-4 h-fit">
        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-herd-muted pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Start a conversation with..."
            className="w-full bg-herd-input-bg border-b border-herd-border rounded-t-[10px] pl-10 pr-4 py-3 text-sm text-herd-fg placeholder:text-herd-muted focus:outline-none"
            disabled={isCreating}
          />
        </div>

        {/* Agent results list */}
        <div ref={listRef} className="max-h-64 overflow-y-auto">
          {filteredAgents.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-herd-muted">
              {agents.length === 0 ? "No agents available" : `No agents matching "${query}"`}
            </div>
          ) : (
            filteredAgents.map((agent, index) => (
              <button
                key={agent.qualifiedName}
                type="button"
                onClick={() => handleSelect(agent)}
                disabled={isCreating}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  index === highlightedIndex ? "bg-herd-primary-muted" : "hover:bg-herd-hover"
                } ${isCreating ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                {/* Agent avatar */}
                <img
                  src={getAgentAvatar(agent.qualifiedName)}
                  alt=""
                  className="w-8 h-8 rounded flex-shrink-0"
                />

                {/* Agent info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-herd-fg truncate">{agent.qualifiedName}</div>
                  {agent.description && (
                    <div className="text-xs text-herd-muted truncate">{agent.description}</div>
                  )}
                </div>

                {/* Status dot */}
                <StatusDot status={agent.status} />
              </button>
            ))
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="px-4 py-2 border-t border-herd-border">
            <div className="bg-herd-status-error/10 border border-herd-status-error/20 text-herd-status-error rounded-lg px-3 py-2 text-xs">
              {error}
            </div>
          </div>
        )}

        {/* Keyboard hints */}
        <div className="px-4 py-2 border-t border-herd-border flex items-center gap-4 text-[11px] text-herd-muted">
          <span>
            <kbd className="px-1 py-0.5 bg-herd-hover rounded text-[10px]">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-herd-hover rounded text-[10px]">↵</kbd> select
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-herd-hover rounded text-[10px]">esc</kbd> close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
