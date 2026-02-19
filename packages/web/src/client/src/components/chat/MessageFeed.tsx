/**
 * MessageFeed component
 *
 * Scrollable message list with auto-scroll to bottom on new messages.
 * Shows streaming indicator when agent is responding.
 */

import { MessageCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ChatMessage } from "../../lib/types";
import { useChatMessages } from "../../store";
import { MessageBubble } from "./MessageBubble";

// =============================================================================
// Types
// =============================================================================

interface MessageFeedProps {
  /** Agent name for display in empty state */
  agentName: string;
}

// =============================================================================
// Component
// =============================================================================

export function MessageFeed(_props: MessageFeedProps) {
  const { chatMessages, chatMessagesLoading, chatStreaming, chatStreamingContent } =
    useChatMessages();
  const feedRef = useRef<HTMLDivElement>(null);
  const prevMessagesLengthRef = useRef(chatMessages.length);

  // Auto-scroll to bottom when new messages arrive or streaming content changes
  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;

    // Only auto-scroll if:
    // 1. New messages were added
    // 2. Streaming content updated
    // 3. User is already near the bottom
    const isNearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 100;
    const newMessagesAdded = chatMessages.length > prevMessagesLengthRef.current;

    if (newMessagesAdded || chatStreaming || isNearBottom) {
      feed.scrollTop = feed.scrollHeight;
    }

    prevMessagesLengthRef.current = chatMessages.length;
  }, [chatMessages, chatStreaming]);

  // Loading state
  if (chatMessagesLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-herd-muted">
          <div className="w-5 h-5 border-2 border-herd-muted border-t-transparent rounded-full animate-spin" />
          <span className="text-xs">Loading messages...</span>
        </div>
      </div>
    );
  }

  // Empty state
  if (chatMessages.length === 0 && !chatStreaming) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-herd-muted">
          <MessageCircle className="w-12 h-12 opacity-50" />
          <p className="text-sm">Send a message to start the conversation</p>
        </div>
      </div>
    );
  }

  // Create streaming message if we have streaming content
  const streamingMessage: ChatMessage | null = chatStreaming
    ? {
        role: "assistant",
        content: chatStreamingContent || "...",
        timestamp: new Date().toISOString(),
      }
    : null;

  return (
    <div ref={feedRef} className="flex-1 overflow-y-auto px-4 py-4">
      <div className="max-w-2xl mx-auto space-y-4">
        {chatMessages.map((message, index) => (
          <MessageBubble key={`${message.timestamp}-${index}`} message={message} />
        ))}

        {/* Streaming message */}
        {streamingMessage && <MessageBubble message={streamingMessage} isStreaming />}
      </div>
    </div>
  );
}
