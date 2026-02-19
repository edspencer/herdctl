/**
 * MessageBubble component
 *
 * Displays a single chat message with appropriate styling for user, assistant, or tool call.
 * User messages are right-aligned, assistant messages use serif font with markdown,
 * tool call messages show collapsible tool output blocks.
 */

import { useState } from "react";
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

/**
 * Format duration in milliseconds to a human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

/** Tool name to emoji mapping */
const TOOL_EMOJIS: Record<string, string> = {
  Bash: "\u{1F4BB}",
  bash: "\u{1F4BB}",
  Read: "\u{1F4C4}",
  Write: "\u{270F}\u{FE0F}",
  Edit: "\u{270F}\u{FE0F}",
  Glob: "\u{1F50D}",
  Grep: "\u{1F50D}",
  WebFetch: "\u{1F310}",
  WebSearch: "\u{1F310}",
};

// =============================================================================
// Tool Call Bubble
// =============================================================================

function ToolCallBubble({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const toolCall = message.toolCall!;
  const emoji = TOOL_EMOJIS[toolCall.toolName] ?? "\u{1F527}";

  const outputPreviewLength = 200;
  const hasLongOutput = toolCall.output.length > outputPreviewLength;
  const displayOutput = expanded
    ? toolCall.output
    : toolCall.output.substring(0, outputPreviewLength) + (hasLongOutput ? "..." : "");

  return (
    <div className="flex flex-col items-start animate-[fadeSlideIn_150ms_ease-out]">
      <div
        className={`max-w-[85%] px-3 py-2 rounded-lg border ${
          toolCall.isError ? "border-red-500/30 bg-red-500/5" : "border-herd-border bg-herd-hover"
        }`}
      >
        {/* Tool header */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 w-full text-left"
        >
          <span className="text-xs">{emoji}</span>
          <span className="text-xs font-medium text-herd-fg">{toolCall.toolName}</span>
          {toolCall.isError && <span className="text-[10px] text-red-500 font-medium">ERROR</span>}
          {toolCall.durationMs !== undefined && (
            <span className="text-[10px] text-herd-muted ml-auto">
              {formatDuration(toolCall.durationMs)}
            </span>
          )}
          <span className="text-[10px] text-herd-muted">{expanded ? "\u25B2" : "\u25BC"}</span>
        </button>

        {/* Input summary */}
        {toolCall.inputSummary && (
          <div className="mt-1">
            <code className="text-[11px] text-herd-muted break-all">{toolCall.inputSummary}</code>
          </div>
        )}

        {/* Output (collapsed by default for long output) */}
        {(expanded || !hasLongOutput) && toolCall.output.trim().length > 0 && (
          <pre className="mt-1.5 text-[11px] text-herd-fg/80 bg-herd-bg rounded px-2 py-1.5 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-all">
            {displayOutput}
          </pre>
        )}

        {/* Collapsed preview for long output */}
        {!expanded && hasLongOutput && toolCall.output.trim().length > 0 && (
          <div className="mt-1.5 text-[11px] text-herd-muted">
            {(toolCall.output.length / 1000).toFixed(1)}k chars
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function MessageBubble({ message, isStreaming = false }: MessageBubbleProps) {
  // Tool call messages get their own rendering
  if (message.role === "tool" && message.toolCall) {
    return <ToolCallBubble message={message} />;
  }

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
