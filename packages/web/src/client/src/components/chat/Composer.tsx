/**
 * Composer component
 *
 * Auto-resizing textarea with send button for composing chat messages.
 * Supports Enter to send, Shift+Enter for newline.
 */

import { ArrowUp } from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { WebSocketClient } from "../../lib/ws";
import { useChatActions, useChatMessages } from "../../store";

// =============================================================================
// Types
// =============================================================================

interface ComposerProps {
  /** Agent name for placeholder text */
  agentName: string;
  /** Session ID for sending messages. Undefined for new chats. */
  sessionId?: string;
}

// =============================================================================
// Component
// =============================================================================

export function Composer({ agentName, sessionId }: ComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { chatStreaming } = useChatMessages();
  const { addUserMessage } = useChatActions();

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to auto to properly calculate scroll height
    textarea.style.height = "auto";
    // Set to scroll height but cap at max
    const newHeight = Math.min(textarea.scrollHeight, 200);
    textarea.style.height = `${newHeight}px`;
  }, []);

  // Focus textarea when session changes (covers initial mount, navigation, and Spotlight flow)
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId triggers focus on session change
  useEffect(() => {
    textareaRef.current?.focus();
  }, [sessionId]);

  const canSend = value.trim().length > 0 && !chatStreaming;

  const handleSend = useCallback(() => {
    if (!canSend) return;

    const message = value.trim();
    setValue("");

    // Add user message to store immediately
    addUserMessage(message);

    // Send via WebSocket
    // For new chats (no sessionId), the server will create a session and return
    // the sessionId in the chat:complete message
    const wsClient = (window as unknown as { __herdWsClient?: WebSocketClient }).__herdWsClient;
    if (wsClient) {
      const payload: { agentName: string; message: string; sessionId?: string } = {
        agentName,
        message,
      };
      // Only include sessionId if it exists (omit for new chats)
      if (sessionId) {
        payload.sessionId = sessionId;
      }
      wsClient.send({
        type: "chat:send",
        payload,
      });
    }
  }, [canSend, value, addUserMessage, agentName, sessionId]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
  }, []);

  return (
    <div className="border-t border-herd-border bg-herd-card p-4">
      <div className="max-w-2xl mx-auto">
        <div className="relative flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={`Send a message to ${agentName}...`}
            rows={1}
            className="flex-1 bg-herd-input-bg border border-herd-border rounded-lg px-3 py-2.5 text-base text-herd-fg placeholder:text-herd-muted focus:outline-none focus:border-herd-primary/60 transition-colors resize-none"
            style={{ minHeight: "42px", maxHeight: "200px" }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
              canSend
                ? "bg-herd-primary hover:bg-herd-primary-hover text-white"
                : "bg-herd-hover text-herd-muted cursor-not-allowed"
            }`}
            title="Send message"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[11px] text-herd-muted mt-2 text-center">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
