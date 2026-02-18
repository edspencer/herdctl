/**
 * Utility modules for the Discord connector
 */

export {
  // Constants
  DISCORD_MAX_MESSAGE_LENGTH,
  // Functions
  startTypingIndicator,
  sendSplitMessage,
  sendWithTyping,
  escapeMarkdown,
  // Types
  type SendableChannel,
  type SendSplitOptions,
  type TypingController,
} from "./formatting.js";
