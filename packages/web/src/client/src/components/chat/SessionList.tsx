/**
 * SessionList component
 *
 * Sidebar list of chat sessions with create and delete functionality.
 * Shows preview, timestamp, and message count for each session.
 */

import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router";
import { Plus, Trash2, MessageSquare } from "lucide-react";
import { useChatSessions, useChatActions } from "../../store";
import { formatRelativeTime } from "../../lib/format";

// =============================================================================
// Types
// =============================================================================

interface SessionListProps {
  /** Agent qualified name to fetch sessions for */
  agentName: string;
  /** Currently active session ID */
  activeSessionId: string | null;
}

// =============================================================================
// Component
// =============================================================================

export function SessionList({ agentName, activeSessionId }: SessionListProps) {
  const navigate = useNavigate();
  const { chatSessions, chatSessionsLoading, chatError } = useChatSessions();
  const { fetchChatSessions, createChatSession, deleteChatSession } = useChatActions();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Fetch sessions on mount and when agent changes
  useEffect(() => {
    fetchChatSessions(agentName);
  }, [agentName, fetchChatSessions]);

  const handleNewChat = useCallback(async () => {
    const sessionId = await createChatSession(agentName);
    if (sessionId) {
      navigate(`/agents/${encodeURIComponent(agentName)}/chat/${sessionId}`);
    }
  }, [agentName, createChatSession, navigate]);

  const handleDeleteClick = useCallback((e: React.MouseEvent, sessionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmDelete(sessionId);
  }, []);

  const handleConfirmDelete = useCallback(
    async (e: React.MouseEvent, sessionId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDeletingId(sessionId);
      setConfirmDelete(null);
      await deleteChatSession(agentName, sessionId);
      setDeletingId(null);

      // Navigate away if we deleted the active session
      if (sessionId === activeSessionId) {
        navigate(`/agents/${encodeURIComponent(agentName)}/chat`);
      }
    },
    [agentName, activeSessionId, deleteChatSession, navigate]
  );

  const handleCancelDelete = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmDelete(null);
  }, []);

  return (
    <div className="w-[250px] border-r border-herd-border bg-herd-card flex flex-col h-full">
      {/* Header with New Chat button */}
      <div className="p-3 border-b border-herd-border">
        <button
          type="button"
          onClick={handleNewChat}
          className="w-full bg-herd-primary hover:bg-herd-primary-hover text-white rounded-lg px-3 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Chat
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {chatSessionsLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-herd-muted border-t-transparent rounded-full animate-spin" />
          </div>
        ) : chatError ? (
          <div className="p-3">
            <div className="bg-herd-status-error/10 border border-herd-status-error/20 text-herd-status-error rounded-lg px-3 py-2 text-xs">
              {chatError}
            </div>
          </div>
        ) : chatSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-herd-muted">
            <MessageSquare className="w-8 h-8 opacity-50 mb-2" />
            <p className="text-xs">No conversations yet</p>
          </div>
        ) : (
          <div className="py-2">
            {chatSessions.map((session) => {
              const isActive = session.sessionId === activeSessionId;
              const isDeleting = session.sessionId === deletingId;
              const isConfirming = session.sessionId === confirmDelete;

              return (
                <Link
                  key={session.sessionId}
                  to={`/agents/${encodeURIComponent(agentName)}/chat/${session.sessionId}`}
                  className={`group block mx-2 mb-1 px-3 py-2.5 rounded-lg transition-colors ${
                    isActive
                      ? "bg-herd-active"
                      : "hover:bg-herd-hover"
                  } ${isDeleting ? "opacity-50" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {/* Preview text */}
                      <p
                        className={`text-sm truncate ${
                          isActive ? "text-herd-fg font-medium" : "text-herd-fg"
                        }`}
                      >
                        {session.preview || "New conversation"}
                      </p>
                      {/* Metadata */}
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-herd-muted">
                          {formatRelativeTime(session.lastMessageAt)}
                        </span>
                        <span className="text-[11px] text-herd-muted">
                          {session.messageCount} msg{session.messageCount !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>

                    {/* Delete button */}
                    {isConfirming ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => handleConfirmDelete(e, session.sessionId)}
                          className="text-herd-status-error hover:text-herd-status-error/80 p-1"
                          title="Confirm delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelDelete}
                          className="text-herd-muted hover:text-herd-fg text-[10px] px-1"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => handleDeleteClick(e, session.sessionId)}
                        className="opacity-0 group-hover:opacity-100 text-herd-muted hover:text-herd-status-error p-1 transition-opacity"
                        title="Delete conversation"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
