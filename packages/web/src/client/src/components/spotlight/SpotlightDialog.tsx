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
 * - Enter/exit animations (backdrop fade, panel slide)
 * - Focus trap: Tab/Shift+Tab cycle within dialog, focus restored on close
 */

import { MessagesSquare, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { getAgentAvatar } from "../../lib/avatar";
import { agentChatPath, allChatsPath } from "../../lib/paths";
import type { AgentInfo } from "../../lib/types";
import { useFleet, useRecentSessions, useSpotlightOpen, useUIActions } from "../../store";

// =============================================================================
// Constants
// =============================================================================

const ANIMATION_DURATION_MS = 150;
const FOCUSABLE_SELECTOR = 'input, button, [tabindex]:not([tabindex="-1"])';

// =============================================================================
// Status Dot Component
// =============================================================================

function StatusDot({ status }: { status: AgentInfo["status"] }) {
  const colorClass =
    status === "idle"
      ? "bg-herd-status-idle"
      : status === "running"
        ? "bg-herd-status-running animate-pulse"
        : "bg-herd-status-error";

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

  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // Animation state: shouldRender keeps the DOM alive during exit animation
  const [shouldRender, setShouldRender] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasResetRef = useRef(false);
  const shouldRenderRef = useRef(false);

  // ---------------------------------------------------------------------------
  // 6.1 — Enter/exit animation lifecycle
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (spotlightOpen) {
      // Cancel any pending close timer
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setIsClosing(false);
      setShouldRender(true);
      shouldRenderRef.current = true;
    } else if (shouldRenderRef.current) {
      // Begin exit animation
      setIsClosing(true);
      closeTimerRef.current = setTimeout(() => {
        setShouldRender(false);
        shouldRenderRef.current = false;
        setIsClosing(false);
        closeTimerRef.current = null;
      }, ANIMATION_DURATION_MS);
    }
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [spotlightOpen]);

  // ---------------------------------------------------------------------------
  // 6.2 — Focus management: save previous focus & restore on close
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (spotlightOpen) {
      // Save the element that had focus before the dialog opened
      previousFocusRef.current = document.activeElement;
    }
  }, [spotlightOpen]);

  // Restore focus when dialog finishes unmounting
  useEffect(() => {
    if (!shouldRender && !spotlightOpen && previousFocusRef.current) {
      const el = previousFocusRef.current as HTMLElement;
      if (typeof el.focus === "function") {
        el.focus();
      }
      previousFocusRef.current = null;
    }
  }, [shouldRender, spotlightOpen]);

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

  // Determine default agent index from recent sessions (only from full agent list,
  // not filteredAgents, so it doesn't change as the user types)
  const defaultAgentIndex = useMemo(() => {
    if (recentSessions.length > 0) {
      const recentAgentName = recentSessions[0].agentName;
      const index = agents.findIndex((a) => a.qualifiedName === recentAgentName);
      return index >= 0 ? index : 0;
    }
    return 0;
  }, [recentSessions, agents]);

  // Reset state once when dialog opens (ref guard prevents StrictMode double-fire)
  // biome-ignore lint/correctness/useExhaustiveDependencies: only reset on open, not when defaultAgentIndex changes
  useEffect(() => {
    if (spotlightOpen && !hasResetRef.current) {
      hasResetRef.current = true;
      setQuery("");
      setHighlightedIndex(defaultAgentIndex);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else if (!spotlightOpen) {
      hasResetRef.current = false;
    }
  }, [spotlightOpen]);

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

  // Handle agent selection (navigate to new chat - session is created on first message)
  const handleSelect = useCallback(
    (agent: AgentInfo) => {
      // Clear saved focus so it doesn't fight with the chat input's autoFocus
      previousFocusRef.current = null;
      setSpotlightOpen(false);
      navigate(agentChatPath(agent.qualifiedName));
    },
    [navigate, setSpotlightOpen],
  );

  // Handle All Chats navigation
  const handleAllChats = useCallback(() => {
    previousFocusRef.current = null;
    setSpotlightOpen(false);
    navigate(allChatsPath());
  }, [navigate, setSpotlightOpen]);

  // Check if query matches "all chats" or "chats" for showing the All Chats option prominently
  const showAllChatsOption = useMemo(() => {
    if (!query.trim()) return true;
    const lowerQuery = query.toLowerCase();
    return "all chats".includes(lowerQuery) || "chats".includes(lowerQuery);
  }, [query]);

  // ---------------------------------------------------------------------------
  // 6.2 — Focus trap: cycle Tab/Shift+Tab within dialog
  // ---------------------------------------------------------------------------
  const handleFocusTrap = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !dialogRef.current) return;

    const focusableEls = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);

    if (focusableEls.length === 0) return;

    const first = focusableEls[0];
    const last = focusableEls[focusableEls.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

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

  // Don't render if not open and not animating out
  if (!shouldRender) {
    return null;
  }

  // Animation classes: enter vs exit
  const backdropAnimation = isClosing
    ? "animate-[fadeIn_150ms_ease-out_reverse_forwards]"
    : "animate-[fadeIn_150ms_ease-out_forwards]";
  const panelAnimation = isClosing
    ? "animate-[fadeSlideIn_150ms_ease-out_reverse_forwards]"
    : "animate-[fadeSlideIn_150ms_ease-out_forwards]";

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismissal pattern
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-black/30 ${backdropAnimation}`}
      onClick={handleBackdropClick}
      onKeyDown={handleFocusTrap}
      style={{ paddingTop: "20vh" }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Start a new chat"
        className={`bg-herd-card border border-herd-border rounded-[10px] shadow-lg max-w-md w-full mx-4 h-fit ${panelAnimation}`}
      >
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
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  index === highlightedIndex ? "bg-herd-primary-muted" : "hover:bg-herd-hover"
                }`}
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

        {/* All Chats navigation option */}
        {showAllChatsOption && (
          <div className="border-t border-herd-border">
            <button
              type="button"
              onClick={handleAllChats}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-herd-hover transition-colors"
            >
              <div className="w-8 h-8 rounded bg-herd-hover flex items-center justify-center flex-shrink-0">
                <MessagesSquare className="w-4 h-4 text-herd-muted" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-herd-fg">All Chats</div>
                <div className="text-xs text-herd-muted">Browse all sessions on this machine</div>
              </div>
            </button>
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
