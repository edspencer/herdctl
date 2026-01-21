/**
 * Utility modules for the Discord connector
 */

export {
  // Constants
  DISCORD_MAX_MESSAGE_LENGTH,
  DEFAULT_MESSAGE_DELAY_MS,
  MIN_CHUNK_SIZE,
  // Functions
  findSplitPoint,
  splitMessage,
  needsSplit,
  startTypingIndicator,
  sendSplitMessage,
  sendWithTyping,
  truncateMessage,
  formatCodeBlock,
  escapeMarkdown,
  // Types
  type SendableChannel,
  type MessageSplitOptions,
  type SendSplitOptions,
  type SplitResult,
  type TypingController,
} from "./formatting.js";
