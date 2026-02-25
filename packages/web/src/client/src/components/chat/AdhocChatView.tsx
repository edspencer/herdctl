/**
 * AdhocChatView component
 *
 * Chat view for ad hoc sessions (unattributed Claude Code sessions).
 * Allows resuming and interacting with sessions that don't belong to any fleet agent.
 * Uses the CLI runtime to execute `claude --resume <sessionId>` in the session's working directory.
 */

import { ArrowLeft, FolderOpen } from "lucide-react";
import { useCallback, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { allChatsPath } from "../../lib/paths";
import { useChatActions, useChatMessages } from "../../store";
import { Composer } from "./Composer";
import { MessageFeed } from "./MessageFeed";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Decode an encoded path back to a display-friendly format.
 * The encoding replaces / with - and prepends a -.
 * Example: "-Users-ed-Code-myproject" -> "/Users/ed/Code/myproject"
 *
 * Note: This is lossy if path segments contain hyphens, but acceptable for display.
 */
function decodePathForDisplay(encodedPath: string): string {
  if (encodedPath.startsWith("-")) {
    return "/" + encodedPath.slice(1).replace(/-/g, "/");
  }
  return encodedPath.replace(/-/g, "/");
}

// =============================================================================
// Component
// =============================================================================

export function AdhocChatView() {
  const { encodedPath, sessionId } = useParams<{
    encodedPath: string;
    sessionId: string;
  }>();
  const navigate = useNavigate();
  const { chatError, chatMessagesLoading } = useChatMessages();
  const { fetchAdhocChatMessages, clearActiveChatState } = useChatActions();

  // Fetch messages on mount
  useEffect(() => {
    if (encodedPath && sessionId) {
      fetchAdhocChatMessages(encodedPath, sessionId);
    }
  }, [encodedPath, sessionId, fetchAdhocChatMessages]);

  // Clear state on unmount
  useEffect(() => {
    return () => {
      clearActiveChatState();
    };
  }, [clearActiveChatState]);

  // Navigate back to All Chats
  const handleBack = useCallback(() => {
    navigate(allChatsPath());
  }, [navigate]);

  // Decode path for display
  const displayPath = encodedPath ? decodePathForDisplay(encodedPath) : "";
  const shortSessionId = sessionId?.slice(0, 8) ?? "";

  if (!encodedPath || !sessionId) {
    return (
      <div className="flex items-center justify-center h-full text-herd-muted">
        <p className="text-sm">Session not found</p>
      </div>
    );
  }

  // Loading state
  if (chatMessagesLoading) {
    return (
      <div className="flex-1 flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-herd-muted">
            <div className="w-5 h-5 border-2 border-herd-muted border-t-transparent rounded-full animate-spin" />
            <span className="text-xs">Loading session...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Header */}
      <div className="shrink-0 p-4 border-b border-herd-border bg-herd-card">
        {/* Back button */}
        <button
          type="button"
          onClick={handleBack}
          className="flex items-center gap-1.5 text-sm text-herd-muted hover:text-herd-fg transition-colors mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to All Chats
        </button>

        {/* Directory and session info */}
        <div className="flex items-start gap-2">
          <FolderOpen className="w-4 h-4 text-herd-muted shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-herd-fg break-all">{displayPath}</p>
            <p className="text-xs text-herd-muted font-mono mt-0.5">Session {shortSessionId}</p>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {chatError && (
        <div className="px-4 pt-4">
          <div className="max-w-2xl mx-auto">
            <div className="bg-herd-status-error/10 border border-herd-status-error/20 text-herd-status-error rounded-lg px-3 py-2 text-xs">
              {chatError}
            </div>
          </div>
        </div>
      )}

      {/* Message feed */}
      <MessageFeed agentName="__adhoc__" />

      {/* Composer with ad hoc props */}
      <Composer
        agentName="__adhoc__"
        sessionId={sessionId}
        isAdhoc
        workingDirectory={displayPath}
      />
    </div>
  );
}
