/**
 * ChatView component
 *
 * Main chat page with session list sidebar and message area.
 * Handles routing between session list and active chat.
 * Supports both existing sessions (with sessionId in URL) and new chats (no sessionId).
 */

import { Container, Info, MessageCircle, SplitSquareHorizontal } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { agentChatPath } from "../../lib/paths";
import {
  useChatActions,
  useChatInfoSidebar,
  useChatMessages,
  useChatSessions,
  useSidebarSessions,
} from "../../store";
import { ChatInfoSidebar } from "./ChatInfoSidebar";
import { Composer } from "./Composer";
import { MessageFeed } from "./MessageFeed";

// =============================================================================
// Component
// =============================================================================

export function ChatView() {
  // Route param `name` now contains the qualified name (e.g., "herdctl.security-auditor")
  const { name: qualifiedName, sessionId } = useParams<{ name: string; sessionId?: string }>();
  const navigate = useNavigate();
  const { chatError, messageGrouping, activeChatSessionId, chatMessages } = useChatMessages();
  const { chatSessions } = useChatSessions();
  const { sidebarSessions } = useSidebarSessions();
  const { chatInfoSidebarOpen, toggleChatInfoSidebar } = useChatInfoSidebar();
  const { fetchChatMessages, setActiveChatSession, clearActiveChatState, setMessageGrouping } =
    useChatActions();

  // Track the previous activeChatSessionId so the redirect effect only fires
  // when it genuinely changes (e.g., server assigns a new session after first message),
  // not when we navigate to "new chat" and the stale value is still in the store.
  const prevActiveSessionRef = useRef<string | null>(null);

  // When activeChatSessionId updates (e.g., after a new chat is created), update the URL
  // This handles the case where we start a new chat without a sessionId, send a message,
  // and the server returns the new sessionId in chat:complete
  useEffect(() => {
    const changed = activeChatSessionId !== prevActiveSessionRef.current;
    prevActiveSessionRef.current = activeChatSessionId;
    if (activeChatSessionId && !sessionId && qualifiedName && changed) {
      // New chat received its sessionId - update URL to include it
      navigate(agentChatPath(qualifiedName, activeChatSessionId), { replace: true });
    }
  }, [activeChatSessionId, sessionId, qualifiedName, navigate]);

  // Clear active chat session state when leaving the page or changing agents
  // (preserves sidebar sessions so they don't vanish on navigation)
  // biome-ignore lint/correctness/useExhaustiveDependencies: qualifiedName triggers cleanup on agent change
  useEffect(() => {
    return () => {
      clearActiveChatState();
    };
  }, [qualifiedName, clearActiveChatState]);

  // Fetch messages when session ID changes
  useEffect(() => {
    if (sessionId && qualifiedName) {
      fetchChatMessages(qualifiedName, sessionId);
    } else {
      // For new chats, set the agent name so WebSocket messages can be filtered
      setActiveChatSession(null, qualifiedName);
    }
  }, [sessionId, qualifiedName, fetchChatMessages, setActiveChatSession]);

  if (!qualifiedName) {
    return (
      <div className="flex items-center justify-center h-full text-herd-muted">
        <p className="text-sm">Agent not found</p>
      </div>
    );
  }

  // Find the current session metadata for createdAt, origin, resumable
  // Check both chatSessions (full list) and sidebarSessions (recent per agent)
  const currentSession =
    chatSessions.find((s) => s.sessionId === sessionId) ??
    (qualifiedName ? sidebarSessions[qualifiedName]?.find((s) => s.sessionId === sessionId) : null);

  // Check if session is resumable (defaults to true for new chats without metadata yet)
  const isResumable = currentSession?.resumable ?? true;

  // Determine if we're in "new chat" mode (no sessionId but user can type)
  const isNewChat = !sessionId;

  // Check if there are messages (either loaded or being composed in a new chat)
  const hasMessages = chatMessages.length > 0;

  return (
    <div className="flex-1 flex min-w-0 h-full">
      {/* Main chat column */}
      <div className="flex-1 flex flex-col min-w-0">
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

        {/* Non-resumable session banner */}
        {sessionId && !isResumable && (
          <div className="px-4 pt-4">
            <div className="max-w-2xl mx-auto">
              <div className="bg-herd-status-pending/10 border border-herd-status-pending/20 text-herd-status-pending rounded-lg px-3 py-2 text-xs flex items-center gap-2">
                <Container className="w-4 h-4 shrink-0" />
                <span>
                  This session ran in Docker and cannot be resumed from the web. Use{" "}
                  <code className="font-mono bg-herd-hover px-1 rounded">claude --resume</code> to
                  continue locally.
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Header bar with grouping toggle + info sidebar toggle */}
        {(sessionId || hasMessages) && (
          <div className="flex items-center justify-end px-4 pt-2">
            <div className="max-w-2xl mx-auto w-full flex justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  setMessageGrouping(messageGrouping === "separate" ? "grouped" : "separate")
                }
                className="text-[11px] text-herd-muted hover:text-herd-fg transition-colors flex items-center gap-1"
                title={`Message display: ${messageGrouping === "separate" ? "separate bubbles per turn" : "grouped into single bubble"}`}
              >
                <SplitSquareHorizontal className="w-3 h-3" />
                {messageGrouping === "separate" ? "Separate" : "Grouped"}
              </button>
              {sessionId && (
                <button
                  type="button"
                  onClick={toggleChatInfoSidebar}
                  className={`text-[11px] transition-colors hidden lg:flex items-center gap-1 ${
                    chatInfoSidebarOpen ? "text-herd-fg" : "text-herd-muted hover:text-herd-fg"
                  }`}
                  title="Toggle session info"
                >
                  <Info className="w-3 h-3" />
                  Info
                </button>
              )}
            </div>
          </div>
        )}

        {/* Welcome state for new chat without messages yet */}
        {isNewChat && !hasMessages ? (
          <div className="flex-1 flex flex-col">
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-4 text-center px-4">
                <div className="w-16 h-16 rounded-full bg-herd-primary-muted flex items-center justify-center">
                  <MessageCircle className="w-8 h-8 text-herd-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-herd-fg mb-1">
                    Chat with {qualifiedName}
                  </h2>
                  <p className="text-sm text-herd-muted max-w-sm">
                    Type a message below to start a new conversation.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Message feed for existing sessions or new chats with messages */
          <MessageFeed agentName={qualifiedName} />
        )}

        {/* Composer - shown for resumable sessions or new chats */}
        {(isResumable || isNewChat) && <Composer agentName={qualifiedName} sessionId={sessionId} />}
      </div>

      {/* Right info sidebar — only when session is active and sidebar is open */}
      {sessionId && chatInfoSidebarOpen && (
        <div className="hidden lg:block">
          <ChatInfoSidebar
            agentName={qualifiedName}
            sessionId={sessionId}
            createdAt={currentSession?.createdAt}
            origin={currentSession?.origin}
            resumable={currentSession?.resumable}
          />
        </div>
      )}
    </div>
  );
}
