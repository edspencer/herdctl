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
import { useLocation, useNavigate } from "react-router";
import { agentChatPath } from "../../lib/paths";
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
  const navigate = useNavigate();
  const location = useLocation();
  const recentSessions = useRecentSessions();
  const recentSessionsLoading = useRecentSessionsLoading();
  const { fetchRecentSessions, renameChatSession, deleteChatSession } = useChatActions();
  const { setSpotlightOpen } = useUIActions();

  const [searchQuery, setSearchQuery] = useState("");

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

    const query = searchQuery.toLowerCase().trim();
    return recentSessions.filter((session) => {
      // Match against customName
      if (session.customName?.toLowerCase().includes(query)) return true;
      // Match against preview
      if (session.preview?.toLowerCase().includes(query)) return true;
      // Match against agentName
      if (session.agentName.toLowerCase().includes(query)) return true;
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

  // Handle delete
  const handleDelete = useCallback(
    async (agentName: string, sessionId: string) => {
      await deleteChatSession(agentName, sessionId);
      // Navigate away if we deleted the active session
      if (sessionId === currentSessionId) {
        navigate(agentChatPath(agentName));
        onNavigate?.();
      }
      // Refresh the list after delete
      fetchRecentSessions();
    },
    [deleteChatSession, currentSessionId, navigate, onNavigate, fetchRecentSessions],
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
      {/* Search input */}
      <SidebarSearch
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search conversations..."
      />

      {/* New Chat button */}
      <div className="px-2 pb-2">
        <button
          type="button"
          onClick={handleNewChat}
          className="w-full flex items-center justify-center gap-1.5 bg-herd-primary hover:bg-herd-primary-hover text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New Chat
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
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}
