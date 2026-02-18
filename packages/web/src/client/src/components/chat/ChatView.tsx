/**
 * ChatView component
 *
 * Main chat page with session list sidebar and message area.
 * Handles routing between session list and active chat.
 */

import { useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import { MessageCircle, ArrowLeft } from "lucide-react";
import { Link } from "react-router";
import { useChatMessages, useChatActions, useChatSessions } from "../../store";
import { SessionList } from "./SessionList";
import { MessageFeed } from "./MessageFeed";
import { Composer } from "./Composer";

// =============================================================================
// Component
// =============================================================================

export function ChatView() {
  const { name: agentName, sessionId } = useParams<{ name: string; sessionId?: string }>();
  const navigate = useNavigate();
  const { activeChatSessionId, chatError } = useChatMessages();
  const { chatSessions } = useChatSessions();
  const { fetchChatMessages, setActiveChatSession, clearChatState, createChatSession } =
    useChatActions();

  // Clear chat state when leaving the page or changing agents
  useEffect(() => {
    return () => {
      clearChatState();
    };
  }, [agentName, clearChatState]);

  // Fetch messages when session ID changes
  useEffect(() => {
    if (sessionId && agentName) {
      fetchChatMessages(agentName, sessionId);
    } else {
      setActiveChatSession(null);
    }
  }, [sessionId, agentName, fetchChatMessages, setActiveChatSession]);

  if (!agentName) {
    return (
      <div className="flex items-center justify-center h-full text-herd-muted">
        <p className="text-sm">Agent not found</p>
      </div>
    );
  }

  const handleStartNewChat = async () => {
    const newSessionId = await createChatSession(agentName);
    if (newSessionId) {
      navigate(`/agents/${encodeURIComponent(agentName)}/chat/${newSessionId}`);
    }
  };

  return (
    <div className="flex h-full">
      {/* Session list sidebar */}
      <SessionList agentName={agentName} activeSessionId={sessionId ?? null} />

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-12 border-b border-herd-border bg-herd-card flex items-center px-4 gap-3">
          <Link
            to={`/agents/${encodeURIComponent(agentName)}`}
            className="text-herd-muted hover:text-herd-fg transition-colors"
            title="Back to agent"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="text-sm font-medium text-herd-fg">
            Chat with {agentName}
          </h1>
          {sessionId && (
            <span className="text-[11px] text-herd-muted font-mono">
              {sessionId.slice(0, 8)}
            </span>
          )}
        </div>

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
            <MessageFeed agentName={agentName} />

            {/* Composer */}
            <Composer agentName={agentName} sessionId={sessionId} />
          </>
        ) : (
          /* Welcome state when no session is selected */
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4 text-center px-4">
              <div className="w-16 h-16 rounded-full bg-herd-primary-muted flex items-center justify-center">
                <MessageCircle className="w-8 h-8 text-herd-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-herd-fg mb-1">
                  Chat with {agentName}
                </h2>
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
    </div>
  );
}
