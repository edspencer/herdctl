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
  // Types
  type ChannelSession,
  // Schemas
  ChannelSessionSchema,
  // Class
  ChatSessionManager,
  type ChatSessionManagerOptions,
  type ChatSessionState,
  ChatSessionStateSchema,
  createChannelSession,
  // Factory functions
  createInitialSessionState,
  type IChatSessionManager,
  isSessionManagerError,
  SessionDirectoryCreateError,
  // Errors
  SessionErrorCode,
  SessionManagerError,
  type SessionManagerLogger,
  type SessionResult,
  SessionStateReadError,
  SessionStateWriteError,
} from "./session-manager/index.js";

// =============================================================================
// Shared Types
// =============================================================================

export type {
  // Connection status
  ChatConnectionStatus,
  ChatConnectorEventMap,
  ChatConnectorEventName,
  ChatConnectorEventPayload,
  ChatConnectorLogger,
  // Connector state
  ChatConnectorState,
  ChatMessageEvent,
  // Message types
  ChatMessageMetadata,
  // Interfaces
  IChatConnector,
  IChatSessionManager as IChatConnectorSessionManager,
  // Event types
  SessionLifecycleEvent,
} from "./types.js";

// =============================================================================
// Message Splitting
// =============================================================================

export {
  // Constants
  DEFAULT_MESSAGE_DELAY_MS,
  DEFAULT_SPLIT_POINTS,
  // Functions
  findSplitPoint,
  formatCodeBlock,
  // Types
  type MessageSplitOptions,
  MIN_CHUNK_SIZE,
  needsSplit,
  type SplitResult,
  splitMessage,
  truncateMessage,
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
  type ContentBlock,
  extractMessageContent,
  hasTextContent,
  isTextContentBlock,
  type SDKMessage,
  type TextContentBlock,
} from "./message-extraction.js";

// =============================================================================
// Tool Parsing
// =============================================================================

export {
  extractToolResultContent,
  extractToolResults,
  // Functions
  extractToolUseBlocks,
  getToolInputSummary,
  // Constants
  TOOL_EMOJIS,
  type ToolResult,
  // Types
  type ToolUseBlock,
} from "./tool-parsing.js";

// =============================================================================
// DM Filtering
// =============================================================================

export {
  checkDMUserFilter,
  type DMConfig,
  type DMFilterResult,
  getDMMode,
  isDMEnabled,
  shouldProcessInMode,
} from "./dm-filter.js";

// =============================================================================
// Errors
// =============================================================================

export {
  AlreadyConnectedError,
  ChatConnectionError,
  // Error classes
  ChatConnectorError,
  // Error codes
  ChatErrorCode,
  InvalidTokenError,
  isAlreadyConnectedError,
  isChatConnectionError,
  // Type guards
  isChatConnectorError,
  isInvalidTokenError,
  isMissingTokenError,
  MissingTokenError,
} from "./errors.js";

// =============================================================================
// Error Handler
// =============================================================================

export {
  // Types
  type ClassifiedError,
  // Categories
  ErrorCategory,
  isAuthError,
  isRateLimitError,
  isTransientError,
  type RetryOptions,
  type RetryResult,
  safeExecute,
  safeExecuteWithReply,
  // Constants
  USER_ERROR_MESSAGES,
  type UserErrorMessageKey,
  // Functions
  withRetry,
} from "./error-handler.js";

// =============================================================================
// Status Formatting
// =============================================================================

export {
  formatCharCount,
  formatCompactNumber,
  formatCost,
  formatDuration,
  formatDurationMs,
  formatNumber,
  formatTimestamp,
  getStatusEmoji,
} from "./status-formatting.js";
