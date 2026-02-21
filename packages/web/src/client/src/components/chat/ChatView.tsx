/**
 * ChatView component
 *
 * Main chat page with session list sidebar and message area.
 * Handles routing between session list and active chat.
 */

import { MessageCircle } from "lucide-react";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { agentChatPath } from "../../lib/paths";
import { useChatActions, useChatMessages, useChatSessions } from "../../store";
import { Composer } from "./Composer";
import { MessageFeed } from "./MessageFeed";

// =============================================================================
// Component
// =============================================================================

export function ChatView() {
  // Route param `name` now contains the qualified name (e.g., "herdctl.security-auditor")
  const { name: qualifiedName, sessionId } = useParams<{ name: string; sessionId?: string }>();
  const navigate = useNavigate();
  const { chatError } = useChatMessages();
  const { chatSessions } = useChatSessions();
  const { fetchChatMessages, setActiveChatSession, clearActiveChatState, createChatSession } =
    useChatActions();

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
      setActiveChatSession(null);
    }
  }, [sessionId, qualifiedName, fetchChatMessages, setActiveChatSession]);

  if (!qualifiedName) {
    return (
      <div className="flex items-center justify-center h-full text-herd-muted">
        <p className="text-sm">Agent not found</p>
      </div>
    );
  }

  const handleStartNewChat = async () => {
    const newSessionId = await createChatSession(qualifiedName);
    if (newSessionId) {
      navigate(agentChatPath(qualifiedName, newSessionId));
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full">
      {/* Chat content */}
      {sessionId ? (
        <>
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
          <MessageFeed agentName={qualifiedName} />

          {/* Composer */}
          <Composer agentName={qualifiedName} sessionId={sessionId} />
        </>
      ) : (
        /* Welcome state when no session is selected */
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center px-4">
            <div className="w-16 h-16 rounded-full bg-herd-primary-muted flex items-center justify-center">
              <MessageCircle className="w-8 h-8 text-herd-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-herd-fg mb-1">Chat with {qualifiedName}</h2>
              <p className="text-sm text-herd-muted max-w-sm">
                {chatSessions.length > 0
                  ? "Select a conversation from the sidebar or start a new one."
                  : "Start a new conversation to chat with this agent."}
              </p>
            </div>
            <button
              type="button"
              onClick={handleStartNewChat}
              className="bg-herd-primary hover:bg-herd-primary-hover text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              New Chat
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
