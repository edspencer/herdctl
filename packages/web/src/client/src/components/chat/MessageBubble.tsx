/**
 * MessageBubble component
 *
 * Displays a single chat message with appropriate styling for user vs assistant.
 * User messages are right-aligned, assistant messages use serif font with markdown.
 */

import type { ChatMessage } from "../../lib/types";
import { MarkdownRenderer } from "../agent/MarkdownRenderer";

// =============================================================================
// Types
// =============================================================================

interface MessageBubbleProps {
  /** The message to display */
  message: ChatMessage;
  /** Whether this is a streaming message (partial content) */
  isStreaming?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format timestamp as relative time or time string
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// =============================================================================
// Component
// =============================================================================

export function MessageBubble({ message, isStreaming = false }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex flex-col ${isUser ? "items-end" : "items-start"} animate-[fadeSlideIn_150ms_ease-out]`}
    >
      {/* Message bubble */}
      <div
        className={`max-w-[85%] px-4 py-2.5 ${
          isUser
            ? "bg-herd-user-bubble text-herd-fg rounded-2xl rounded-br-md"
            : "bg-herd-card border border-herd-border text-herd-fg rounded-2xl rounded-bl-md"
        }`}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className={isStreaming ? "relative" : ""}>
            <MarkdownRenderer content={message.content} useSerif />
            {isStreaming && (
              <span className="inline-flex ml-1">
                <span className="w-1 h-1 bg-herd-muted rounded-full animate-pulse" />
                <span className="w-1 h-1 bg-herd-muted rounded-full animate-pulse ml-0.5 [animation-delay:150ms]" />
                <span className="w-1 h-1 bg-herd-muted rounded-full animate-pulse ml-0.5 [animation-delay:300ms]" />
              </span>
            )}
          </div>
        )}
      </div>

      {/* Timestamp */}
      {!isStreaming && (
        <span className="text-[11px] text-herd-muted mt-1 px-1">
          {formatTimestamp(message.timestamp)}
        </span>
      )}
    </div>
  );
}
