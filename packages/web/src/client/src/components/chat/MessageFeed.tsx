/**
 * MessageFeed component
 *
 * Scrollable message list with auto-scroll to bottom on new messages.
 * Shows streaming indicator when agent is responding.
 */

import { MessageCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const {
    chatMessages,
    chatMessagesLoading,
    chatStreaming,
    chatStreamingContent,
    messageGrouping,
  } = useChatMessages();
  const feedRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Track whether user is scrolled to the bottom
  const checkScrollPosition = useCallback(() => {
    const feed = feedRef.current;
    if (!feed) return;
    const threshold = 20;
    const distanceFromBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
    setIsAtBottom(distanceFromBottom <= threshold);
  }, []);

  // Attach scroll listener
  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    feed.addEventListener("scroll", checkScrollPosition);
    return () => feed.removeEventListener("scroll", checkScrollPosition);
  }, [checkScrollPosition]);

  // Auto-scroll only when pinned to bottom.
  // chatMessages and chatStreamingContent are intentional triggers: the effect
  // must re-run when new messages arrive or streaming chunks append so we scroll
  // to reveal them, even though the effect body doesn't reference them directly.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional triggers for scroll
  useEffect(() => {
    if (!isAtBottom) return;
    const feed = feedRef.current;
    if (!feed) return;
    feed.scrollTop = feed.scrollHeight;
  }, [chatMessages, chatStreamingContent, isAtBottom]);

  // When "grouped", merge consecutive assistant messages (no tool between them)
  // into a single bubble. Persisted history always stores separate turns,
  // so this merge is needed for the grouped visual display.
  const displayMessages = useMemo(() => {
    if (messageGrouping === "separate") return chatMessages;
    const merged: ChatMessage[] = [];
    for (const msg of chatMessages) {
      const prev = merged[merged.length - 1];
      if (msg.role === "assistant" && prev?.role === "assistant") {
        merged[merged.length - 1] = {
          ...prev,
          content: prev.content + msg.content,
          timestamp: msg.timestamp,
        };
      } else {
        merged.push(msg);
      }
    }
    return merged;
  }, [chatMessages, messageGrouping]);

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
  if (displayMessages.length === 0 && !chatStreaming) {
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
        {displayMessages.map((message, index) => (
          <MessageBubble key={`${message.timestamp}-${index}`} message={message} />
        ))}

        {/* Streaming message */}
        {streamingMessage && <MessageBubble message={streamingMessage} isStreaming />}
      </div>
    </div>
  );
}
