/**
 * @herdctl/chat - Shared chat infrastructure for herdctl connectors
 *
 * This package provides shared components for chat platform integrations:
 * - Session manager for conversation context preservation
 * - Message splitting utilities
 * - Streaming responder
 * - Message content extraction
 * - DM filtering
 * - Error handling utilities
 * - Status formatting
 */

// =============================================================================
// Session Manager
// =============================================================================

export {
  // Class
  ChatSessionManager,
  // Schemas
  ChannelSessionSchema,
  ChatSessionStateSchema,
  // Types
  type ChannelSession,
  type ChatSessionState,
  type SessionManagerLogger,
  type ChatSessionManagerOptions,
  type SessionResult,
  type IChatSessionManager,
  // Factory functions
  createInitialSessionState,
  createChannelSession,
  // Errors
  SessionErrorCode,
  SessionManagerError,
  SessionStateReadError,
  SessionStateWriteError,
  SessionDirectoryCreateError,
  isSessionManagerError,
} from "./session-manager/index.js";

// =============================================================================
// Shared Types
// =============================================================================

export {
  // Connection status
  type ChatConnectionStatus,
  // Connector state
  type ChatConnectorState,
  // Interfaces
  type IChatConnector,
  type IChatSessionManager as IChatConnectorSessionManager,
  type ChatConnectorLogger,
  // Message types
  type ChatMessageMetadata,
  type ChatMessageEvent,
  // Event types
  type SessionLifecycleEvent,
  type ChatConnectorEventMap,
  type ChatConnectorEventName,
  type ChatConnectorEventPayload,
} from "./types.js";

// =============================================================================
// Message Splitting
// =============================================================================

export {
  // Functions
  findSplitPoint,
  splitMessage,
  needsSplit,
  truncateMessage,
  formatCodeBlock,
  // Types
  type MessageSplitOptions,
  type SplitResult,
  // Constants
  DEFAULT_MESSAGE_DELAY_MS,
  MIN_CHUNK_SIZE,
  DEFAULT_SPLIT_POINTS,
} from "./message-splitting.js";

// =============================================================================
// Streaming Responder
// =============================================================================

export {
  StreamingResponder,
  type StreamingResponderOptions,
} from "./streaming-responder.js";

// =============================================================================
// Message Extraction
// =============================================================================

export {
  extractMessageContent,
  isTextContentBlock,
  hasTextContent,
  type TextContentBlock,
  type ContentBlock,
  type SDKMessage,
} from "./message-extraction.js";

// =============================================================================
// Tool Parsing
// =============================================================================

export {
  // Functions
  extractToolUseBlocks,
  extractToolResults,
  extractToolResultContent,
  getToolInputSummary,
  // Types
  type ToolUseBlock,
  type ToolResult,
  // Constants
  TOOL_EMOJIS,
} from "./tool-parsing.js";

// =============================================================================
// DM Filtering
// =============================================================================

export {
  isDMEnabled,
  getDMMode,
  checkDMUserFilter,
  shouldProcessInMode,
  type DMFilterResult,
  type DMConfig,
} from "./dm-filter.js";

// =============================================================================
// Errors
// =============================================================================

export {
  // Error codes
  ChatErrorCode,
  // Error classes
  ChatConnectorError,
  ChatConnectionError,
  AlreadyConnectedError,
  InvalidTokenError,
  MissingTokenError,
  // Type guards
  isChatConnectorError,
  isChatConnectionError,
  isAlreadyConnectedError,
  isInvalidTokenError,
  isMissingTokenError,
} from "./errors.js";

// =============================================================================
// Error Handler
// =============================================================================

export {
  // Categories
  ErrorCategory,
  // Types
  type ClassifiedError,
  type RetryOptions,
  type RetryResult,
  type UserErrorMessageKey,
  // Constants
  USER_ERROR_MESSAGES,
  // Functions
  withRetry,
  isTransientError,
  isRateLimitError,
  isAuthError,
  safeExecute,
  safeExecuteWithReply,
} from "./error-handler.js";

// =============================================================================
// Status Formatting
// =============================================================================

export {
  formatTimestamp,
  formatDuration,
  formatDurationMs,
  getStatusEmoji,
  formatNumber,
  formatCompactNumber,
  formatCharCount,
  formatCost,
} from "./status-formatting.js";
