/**
 * OutputMessage component
 *
 * Smart dispatcher for rendering different types of output messages.
 * Currently distinguishes between stdout and stderr streams.
 * In the future, can be extended to parse structured output types.
 */

import type { OutputMessage as OutputMessageType } from "../../store";

// =============================================================================
// Types
// =============================================================================

interface OutputMessageProps {
  /** The output message to render */
  message: OutputMessageType;
}

// =============================================================================
// Component
// =============================================================================

export function OutputMessage({ message }: OutputMessageProps) {
  const isStderr = message.stream === "stderr";

  return (
    <div
      className={`
        font-mono text-xs whitespace-pre-wrap break-all
        animate-[fadeSlideIn_150ms_ease-out]
        ${isStderr ? "text-herd-status-error" : "text-herd-code-fg"}
      `}
    >
      {message.data}
    </div>
  );
}
