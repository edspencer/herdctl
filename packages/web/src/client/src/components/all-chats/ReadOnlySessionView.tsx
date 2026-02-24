/**
 * ReadOnlySessionView component
 *
 * Displays a read-only view of a chat session that doesn't belong to a fleet agent.
 * Used when viewing unattributed sessions from the All Chats page.
 * Shows messages but no composer since the session cannot be resumed from the web.
 */

import { AlertTriangle, ArrowLeft, Check, Clipboard, FolderOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { type ChatSessionDetailResponse, fetchSessionByPath } from "../../lib/api";
import { allChatsPath } from "../../lib/paths";
import type { ChatMessage } from "../../lib/types";
import { MessageBubble } from "../chat/MessageBubble";

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

export function ReadOnlySessionView() {
  const { encodedPath, sessionId } = useParams<{
    encodedPath: string;
    sessionId: string;
  }>();
  const navigate = useNavigate();

  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ChatSessionDetailResponse | null>(null);
  const [copied, setCopied] = useState(false);

  // Ref for scroll container
  const feedRef = useRef<HTMLDivElement>(null);

  // Fetch session data on mount
  useEffect(() => {
    if (!encodedPath || !sessionId) {
      setError("Missing path or session ID");
      setLoading(false);
      return;
    }

    async function loadSession() {
      setLoading(true);
      setError(null);

      try {
        const result = await fetchSessionByPath(encodedPath!, sessionId!);
        setData(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load session";
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    loadSession();
  }, [encodedPath, sessionId]);

  // Scroll to bottom when messages load
  useEffect(() => {
    if (data?.messages && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [data?.messages]);

  // Copy resume command to clipboard
  const handleCopyCommand = useCallback(async () => {
    if (!sessionId) return;

    const command = `claude --resume ${sessionId}`;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied - silently fail
    }
  }, [sessionId]);

  // Navigate back to All Chats
  const handleBack = useCallback(() => {
    navigate(allChatsPath());
  }, [navigate]);

  // Derive display values
  const displayPath = encodedPath ? decodePathForDisplay(encodedPath) : "";
  const shortSessionId = sessionId?.slice(0, 8) ?? "";

  // Loading state
  if (loading) {
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

  // Error state
  if (error) {
    return (
      <div className="flex-1 flex flex-col h-full">
        <div className="p-4 border-b border-herd-border">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-1.5 text-sm text-herd-muted hover:text-herd-fg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to All Chats
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="bg-herd-status-error/10 border border-herd-status-error/20 text-herd-status-error rounded-lg px-4 py-3 text-sm max-w-md text-center">
            {error}
          </div>
        </div>
      </div>
    );
  }

  // Messages to display
  const messages: ChatMessage[] = data?.messages ?? [];

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
        <div className="flex items-start gap-2 mb-3">
          <FolderOpen className="w-4 h-4 text-herd-muted shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-herd-fg break-all">{displayPath}</p>
            <p className="text-xs text-herd-muted font-mono mt-0.5">Session {shortSessionId}</p>
          </div>
        </div>

        {/* Warning banner */}
        <div className="bg-herd-status-pending/10 border border-herd-status-pending/20 rounded-lg px-3 py-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-herd-status-pending shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-herd-status-pending">
                This session has no matching fleet agent. View only.
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <p className="text-xs text-herd-muted">Resume with:</p>
                <code className="text-xs font-mono bg-herd-hover px-1.5 py-0.5 rounded text-herd-fg">
                  claude --resume {shortSessionId}
                </code>
                <button
                  type="button"
                  onClick={handleCopyCommand}
                  className="flex items-center gap-1 text-xs text-herd-muted hover:text-herd-fg transition-colors"
                  title="Copy command"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3 text-herd-status-running" />
                      <span className="text-herd-status-running">Copied</span>
                    </>
                  ) : (
                    <>
                      <Clipboard className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Metadata row */}
        {data?.metadata && (
          <div className="flex items-center gap-4 mt-3 text-xs text-herd-muted">
            {data.metadata.gitBranch && (
              <span>
                Branch: <span className="font-mono text-herd-fg">{data.metadata.gitBranch}</span>
              </span>
            )}
            {data.metadata.claudeCodeVersion && (
              <span>
                Claude Code:{" "}
                <span className="font-mono text-herd-fg">{data.metadata.claudeCodeVersion}</span>
              </span>
            )}
            {data.metadata.model && (
              <span>
                Model: <span className="font-mono text-herd-fg">{data.metadata.model}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Message feed */}
      <div ref={feedRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-herd-muted">No messages in this session</p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-4">
            {messages.map((message, index) => (
              <MessageBubble key={`${message.timestamp}-${index}`} message={message} />
            ))}
          </div>
        )}
      </div>

      {/* No composer - read only */}
    </div>
  );
}
