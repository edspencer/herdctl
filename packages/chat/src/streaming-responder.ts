/**
 * Streaming Responder for chat platforms
 *
 * Handles incremental message delivery to chat platforms with:
 * - Message buffering
 * - Rate limiting between sends
 * - Automatic message splitting for platform limits
 */

import { splitMessage } from "./message-splitting.js";
import type { ChatConnectorLogger } from "./types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for StreamingResponder
 */
export interface StreamingResponderOptions {
  /** Function to send a reply to the chat platform */
  reply: (content: string) => Promise<void>;

  /** Logger for debug output */
  logger: ChatConnectorLogger;

  /** Agent name for logging context */
  agentName: string;

  /**
   * Maximum message length for the platform
   * Discord: 2000, Slack: 4000
   */
  maxMessageLength: number;

  /**
   * Minimum time between messages in ms (default: 1000)
   * Helps avoid rate limiting
   */
  minMessageInterval?: number;

  /**
   * Maximum buffer size before forcing a send (default: platform max - 500)
   * Discord: 1500, Slack: 3500
   */
  maxBufferSize?: number;

  /**
   * Platform name for logging (default: "chat")
   */
  platformName?: string;
}

// =============================================================================
// StreamingResponder Class
// =============================================================================

/**
 * StreamingResponder handles incremental message delivery to chat platforms
 *
 * Instead of collecting all output and sending at the end, this class:
 * - Buffers incoming content
 * - Sends messages as complete chunks arrive
 * - Respects rate limits by enforcing minimum intervals between sends
 * - Handles message splitting for content exceeding platform limits
 *
 * @example
 * ```typescript
 * const streamer = new StreamingResponder({
 *   reply: (content) => channel.send(content),
 *   logger: myLogger,
 *   agentName: 'my-agent',
 *   maxMessageLength: 2000,  // Discord
 *   maxBufferSize: 1500,
 * });
 *
 * // Add content as it arrives
 * await streamer.addContent("Hello ");
 * await streamer.addContent("world!");
 *
 * // Flush any remaining content when done
 * await streamer.flush();
 * ```
 */
export class StreamingResponder {
  private buffer: string = "";
  private lastSendTime: number = 0;
  private messagesSent: number = 0;

  private readonly reply: (content: string) => Promise<void>;
  private readonly logger: ChatConnectorLogger;
  private readonly agentName: string;
  private readonly maxMessageLength: number;
  private readonly minMessageInterval: number;
  private readonly maxBufferSize: number;
  private readonly platformName: string;

  constructor(options: StreamingResponderOptions) {
    this.reply = options.reply;
    this.logger = options.logger;
    this.agentName = options.agentName;
    this.maxMessageLength = options.maxMessageLength;
    this.minMessageInterval = options.minMessageInterval ?? 1000;
    this.maxBufferSize = options.maxBufferSize ?? options.maxMessageLength - 500;
    this.platformName = options.platformName ?? "chat";
  }

  /**
   * Add content to the buffer
   *
   * Content is accumulated until flush() is called or buffer exceeds maxBufferSize.
   *
   * @param content - Text content to add
   */
  addContent(content: string): void {
    if (!content) {
      return;
    }
    this.buffer += content;
  }

  /**
   * Add a complete message and send it immediately (with rate limiting)
   *
   * Use this for complete assistant message turns from the SDK.
   * Each assistant message is a complete response that should be sent.
   *
   * @param content - Complete message content to send
   */
  async addMessageAndSend(content: string): Promise<void> {
    if (!content || content.trim().length === 0) {
      return;
    }

    // Add to any existing buffer (in case there's leftover content)
    this.buffer += content;

    // Send everything in the buffer
    await this.sendAll();
  }

  /**
   * Flush any remaining content in the buffer
   *
   * Should be called when message processing is complete to ensure
   * all content is sent.
   */
  async flush(): Promise<void> {
    await this.sendAll();
  }

  /**
   * Check if any messages have been sent
   *
   * @returns true if at least one message has been sent
   */
  hasSentAnything(): boolean {
    return this.messagesSent > 0;
  }

  /**
   * Alias for hasSentAnything() for backward compatibility
   */
  hasSentMessages(): boolean {
    return this.hasSentAnything();
  }

  /**
   * Get the number of messages sent
   */
  getMessagesSent(): number {
    return this.messagesSent;
  }

  /**
   * Get the current buffer content (for debugging)
   */
  getBufferContent(): string {
    return this.buffer;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Send all buffered content immediately (with rate limiting)
   */
  private async sendAll(): Promise<void> {
    if (this.buffer.trim().length === 0) {
      return;
    }

    const content = this.buffer.trim();
    this.buffer = "";

    // Respect rate limiting - wait if needed
    const now = Date.now();
    const timeSinceLastSend = now - this.lastSendTime;
    if (timeSinceLastSend < this.minMessageInterval && this.lastSendTime > 0) {
      const waitTime = this.minMessageInterval - timeSinceLastSend;
      await this.sleep(waitTime);
    }

    // Split if needed for platform limits
    const { chunks } = splitMessage(content, { maxLength: this.maxMessageLength });

    for (const chunk of chunks) {
      try {
        await this.reply(chunk);
        this.messagesSent++;
        this.lastSendTime = Date.now();
        this.logger.debug(`Streamed ${this.platformName} message`, {
          agentName: this.agentName,
          chunkLength: chunk.length,
          totalSent: this.messagesSent,
        });

        // Small delay between multiple chunks from same content
        if (chunks.length > 1) {
          await this.sleep(500);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to send ${this.platformName} message`, {
          agentName: this.agentName,
          error: errorMessage,
        });
        throw error;
      }
    }
  }

  /**
   * Sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
