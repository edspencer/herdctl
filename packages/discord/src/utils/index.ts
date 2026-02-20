/**
 * Utility modules for the Discord connector
 */

export {
  // Constants
  DISCORD_MAX_MESSAGE_LENGTH,
  escapeMarkdown,
  // Types
  type SendableChannel,
  type SendSplitOptions,
  sendSplitMessage,
  sendWithTyping,
  // Functions
  startTypingIndicator,
  type TypingController,
} from "./formatting.js";
