/**
 * RecentConversationsList component
 *
 * Displays a searchable list of recent conversations across all agents.
 * Fetches recent sessions on mount and provides search filtering.
 *
 * Uses herd-* design tokens for styling.
 */

import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import type { SessionOrigin } from "../../lib/types";
import {
  useChatActions,
  useRecentSessions,
  useRecentSessionsLoading,
  useUIActions,
} from "../../store";
import { RecentConversationRow } from "./RecentConversationRow";
import { SidebarSearch } from "./SidebarSearch";

interface RecentConversationsListProps {
  /** Called when navigating to a conversation (used to close mobile overlay) */
  onNavigate?: () => void;
}

export function RecentConversationsList({ onNavigate }: RecentConversationsListProps) {
  const location = useLocation();
  const recentSessions = useRecentSessions();
  const recentSessionsLoading = useRecentSessionsLoading();
  const { fetchRecentSessions, renameChatSession } = useChatActions();
  const { setSpotlightOpen } = useUIActions();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  // Fetch recent sessions on mount (skip if we already have data to avoid refetch on rapid tab switching)
  useEffect(() => {
    if (recentSessions.length === 0 && !recentSessionsLoading) {
      fetchRecentSessions();
    }
  }, [fetchRecentSessions, recentSessions.length, recentSessionsLoading]);

  // Detect if we're on Mac for keyboard shortcut hint
  const isMac = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return navigator.platform?.toLowerCase().includes("mac") ?? false;
  }, []);

  // Parse current route to determine active session
  const { currentAgentName, currentSessionId } = useMemo(() => {
    // Pattern: /agents/:name/chat/:sessionId
    const match = location.pathname.match(/^\/agents\/([^/]+)\/chat\/([^/]+)$/);
    if (match) {
      return {
        currentAgentName: decodeURIComponent(match[1]),
        currentSessionId: match[2],
      };
    }
    return { currentAgentName: null, currentSessionId: null };
  }, [location.pathname]);

  // Filter sessions based on search query
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return recentSessions;

    const originLabels: Record<SessionOrigin, string> = {
      web: "web",
      discord: "discord",
      slack: "slack",
      schedule: "schedule",
      native: "cli",
    };

    const query = searchQuery.toLowerCase().trim();
    return recentSessions.filter((session) => {
      // Match against customName
      if (session.customName?.toLowerCase().includes(query)) return true;
      // Match against preview
      if (session.preview?.toLowerCase().includes(query)) return true;
      // Match against agentName
      if (session.agentName.toLowerCase().includes(query)) return true;
      // Match against origin label
      if (originLabels[session.origin].includes(query)) return true;
      return false;
    });
  }, [recentSessions, searchQuery]);

  // Handle rename
  const handleRename = useCallback(
    async (agentName: string, sessionId: string, name: string) => {
      await renameChatSession(agentName, sessionId, name);
      // Refresh the list after rename
      fetchRecentSessions();
    },
    [renameChatSession, fetchRecentSessions],
  );

  // Handle new chat button
  const handleNewChat = useCallback(() => {
    setSpotlightOpen(true);
  }, [setSpotlightOpen]);

  // Loading state with skeleton placeholders
  if (recentSessionsLoading) {
    return (
      <div className="p-2 space-y-2">
        {/* Skeleton rows */}
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-2 animate-pulse">
            <div className="w-5 h-5 rounded bg-herd-sidebar-muted/20 flex-shrink-0" />
            <div className="flex-1 space-y-1">
              <div className="h-3.5 bg-herd-sidebar-muted/20 rounded w-3/4" />
              <div className="h-2.5 bg-herd-sidebar-muted/10 rounded w-1/2" />
            </div>
            <div className="h-2.5 bg-herd-sidebar-muted/10 rounded w-6" />
          </div>
        ))}
      </div>
    );
  }

  // Empty state (no conversations exist)
  if (recentSessions.length === 0) {
    return (
      <div className="p-4 flex flex-col items-center text-center">
        <p className="text-sm text-herd-sidebar-muted mb-2">No conversations yet</p>
        <p className="text-xs text-herd-sidebar-muted/70 mb-4">
          Press {isMac ? "Cmd" : "Ctrl"}+K to start a new chat
        </p>
        <button
          type="button"
          onClick={handleNewChat}
          className="flex items-center gap-1.5 bg-herd-primary hover:bg-herd-primary-hover text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New Chat
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Search + New Chat row */}
      <div className="flex items-center gap-1.5 mx-2 mb-2">
        <SidebarSearch
          value={searchQuery}
          onChange={setSearchQuery}
          onFocusChange={setSearchFocused}
          placeholder="Search conversations..."
          className="relative flex-1 transition-all duration-150"
        />
        <button
          type="button"
          onClick={handleNewChat}
          className="flex-shrink-0 flex items-center gap-1.5 bg-herd-primary hover:bg-herd-primary-hover text-white rounded-lg px-2 py-1.5 text-xs font-medium"
          title="New Chat"
        >
          <Plus className="w-3.5 h-3.5 flex-shrink-0" />
          <span
            className={`overflow-hidden whitespace-nowrap min-w-0 transition-all duration-200 ease-in-out ${
              searchFocused ? "w-0 opacity-0" : "w-14 opacity-100"
            }`}
          >
            New Chat
          </span>
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-auto px-2 space-y-0.5">
        {filteredSessions.length === 0 ? (
          <p className="text-xs text-herd-sidebar-muted px-3 py-2">
            No matches for "{searchQuery}"
          </p>
        ) : (
          filteredSessions.map((session) => (
            <RecentConversationRow
              key={`${session.agentName}-${session.sessionId}`}
              session={session}
              isActive={
                session.agentName === currentAgentName && session.sessionId === currentSessionId
              }
              onNavigate={onNavigate}
              onRename={handleRename}
            />
          ))
        )}
      </div>
    </div>
  );
}
