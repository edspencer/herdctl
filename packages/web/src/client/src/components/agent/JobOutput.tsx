/**
 * JobOutput component
 *
 * Renders live streaming output for a job.
 * Features auto-scroll (pins to bottom while streaming),
 * stderr highlighting, and jump-to-bottom button.
 */

import { ArrowDown, Terminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OutputMessage as OutputMessageType } from "../../store";
import { OutputMessage } from "./OutputMessage";

// =============================================================================
// Types
// =============================================================================

interface JobOutputProps {
  /** Job ID being displayed */
  jobId: string;
  /** Output messages for this job */
  messages: OutputMessageType[];
  /** Job start time for display */
  startTime?: string;
}

interface EmptyStateProps {
  jobId: string;
}

function EmptyState({ jobId }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <Terminal className="w-12 h-12 text-herd-muted" />
      <div>
        <p className="text-sm text-herd-fg font-medium">Waiting for output...</p>
        <p className="text-xs text-herd-muted mt-1 font-mono">{jobId}</p>
      </div>
    </div>
  );
}

interface JumpToBottomButtonProps {
  onClick: () => void;
}

function JumpToBottomButton({ onClick }: JumpToBottomButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="
        absolute bottom-4 right-4
        flex items-center gap-1.5
        bg-herd-primary hover:bg-herd-primary-hover
        text-white rounded-lg px-3 py-1.5
        text-xs font-medium transition-colors
        shadow-lg
        animate-[fadeSlideIn_150ms_ease-out]
      "
    >
      <ArrowDown className="w-3.5 h-3.5" />
      Jump to bottom
    </button>
  );
}

// =============================================================================
// Component
// =============================================================================

export function JobOutput({ jobId, messages, startTime }: JobOutputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showJumpButton, setShowJumpButton] = useState(false);

  // Check if user is scrolled to bottom (within threshold)
  const checkScrollPosition = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const threshold = 50; // pixels from bottom to consider "at bottom"
    const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const atBottom = scrollBottom <= threshold;

    setIsAtBottom(atBottom);
    setShowJumpButton(!atBottom && messages.length > 0);
  }, [messages.length]);

  // Auto-scroll when new messages arrive and user is at bottom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (isAtBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }, [isAtBottom]);

  // Add scroll listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("scroll", checkScrollPosition);
    return () => container.removeEventListener("scroll", checkScrollPosition);
  }, [checkScrollPosition]);

  // Jump to bottom handler
  const handleJumpToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    container.scrollTop = container.scrollHeight;
    setIsAtBottom(true);
    setShowJumpButton(false);
  }, []);

  // Format start time for display
  const formattedStartTime = startTime ? new Date(startTime).toLocaleString() : null;

  return (
    <div className="relative flex flex-col h-full">
      {/* Header with job info */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-herd-border bg-herd-card">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-herd-muted" />
          <span className="text-xs font-mono text-herd-muted">{jobId}</span>
        </div>
        {formattedStartTime && (
          <span className="text-xs text-herd-muted">{formattedStartTime}</span>
        )}
      </div>

      {/* Output container */}
      <div
        ref={containerRef}
        className="
          flex-1 overflow-auto
          bg-herd-code-bg
          p-3 min-h-[200px] max-h-[500px]
        "
      >
        {messages.length === 0 ? (
          <EmptyState jobId={jobId} />
        ) : (
          <div className="space-y-0.5">
            {messages.map((msg) => (
              <OutputMessage key={msg.id} message={msg} />
            ))}
          </div>
        )}
      </div>

      {/* Jump to bottom button */}
      {showJumpButton && <JumpToBottomButton onClick={handleJumpToBottom} />}
    </div>
  );
}
