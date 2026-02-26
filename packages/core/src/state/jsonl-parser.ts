/**
 * JSONL session file parser
 *
 * Parses Claude Code `.jsonl` session files into structured ChatMessage arrays
 * for the web frontend. Supports streaming parsing for memory efficiency,
 * message deduplication, tool call/result pairing, and metadata extraction.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import {
  extractToolResults,
  extractToolUseBlocks,
  getToolInputSummary,
  type ToolResult,
  type ToolUseBlock,
} from "./tool-parsing.js";

// =============================================================================
// Types
// =============================================================================

/**
 * A parsed chat message from a JSONL session file
 */
export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: string; // ISO 8601
  toolCall?: ChatToolCall;
}

/**
 * Tool call metadata attached to a tool-role ChatMessage
 */
export interface ChatToolCall {
  toolName: string;
  inputSummary?: string;
  output: string;
  isError: boolean;
  durationMs?: number;
}

/**
 * Summary metadata extracted from a session file
 */
export interface SessionMetadata {
  sessionId: string;
  firstMessagePreview: string | undefined;
  gitBranch: string | undefined;
  claudeCodeVersion: string | undefined;
  messageCount: number;
  firstMessageAt: string | undefined;
  lastMessageAt: string | undefined;
  /** Auto-generated session summary from Claude Code (extracted from type: "summary" entries) */
  summary: string | undefined;
  /** Whether this session is a sidechain (sub-agent) session */
  isSidechain: boolean;
}

/**
 * Token usage summary extracted from a session file
 */
export interface SessionUsage {
  inputTokens: number;
  turnCount: number;
  hasData: boolean;
}

// =============================================================================
// Internal types
// =============================================================================

/**
 * Pending tool use awaiting its result
 */
interface PendingToolUse {
  name: string;
  input?: unknown;
  timestamp: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract text content from a message's content field.
 *
 * Content can be a plain string or an array of content blocks.
 * For arrays, text blocks are filtered and joined with newlines.
 */
function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const textParts: string[] = [];
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        "type" in block &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        textParts.push(block.text);
      }
    }
    return textParts.join("\n");
  }

  return "";
}

/**
 * Check whether a message's content contains tool_result blocks
 */
function hasToolResultBlocks(content: unknown): boolean {
  if (!Array.isArray(content)) return false;

  return content.some(
    (block) =>
      block && typeof block === "object" && "type" in block && block.type === "tool_result",
  );
}

/**
 * Create a readline interface that streams a JSONL file line by line.
 *
 * Returns null if the file cannot be opened (e.g., ENOENT).
 */
function createLineReader(filePath: string): Promise<ReturnType<typeof createInterface> | null> {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { encoding: "utf-8" });

    stream.on("error", () => {
      resolve(null);
    });

    stream.on("open", () => {
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      resolve(rl);
    });
  });
}

// =============================================================================
// parseSessionMessages
// =============================================================================

/**
 * Parse a JSONL session file into an array of ChatMessages.
 *
 * Streams the file line by line for memory efficiency. Handles:
 * - Plain user text messages
 * - Assistant text messages (deduplicated by message.id)
 * - Tool use blocks from assistant messages (stored as pending)
 * - Tool result blocks from user messages (paired with pending tool uses)
 *
 * @param sessionFilePath - Absolute path to the .jsonl file
 * @param options - Optional settings (limit caps total messages returned)
 * @returns Array of ChatMessages in chronological order
 */
export async function parseSessionMessages(
  sessionFilePath: string,
  options?: { limit?: number },
): Promise<ChatMessage[]> {
  const rl = await createLineReader(sessionFilePath);
  if (!rl) return [];

  const messages: ChatMessage[] = [];
  const seenAssistantIds = new Set<string>();
  const pendingToolUses = new Map<string, PendingToolUse>();
  const limit = options?.limit;

  for await (const line of rl) {
    // Respect message limit
    if (limit !== undefined && messages.length >= limit) break;

    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue; // Skip malformed lines
    }

    const type = parsed.type;
    if (type !== "user" && type !== "assistant") continue;

    const message = parsed.message as Record<string, unknown> | undefined;
    if (!message) continue;

    const timestamp =
      typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString();

    // ── User messages ──────────────────────────────────────────────────
    if (type === "user") {
      const content = message.content;

      // Tool result message
      if (hasToolResultBlocks(content)) {
        const toolResults: ToolResult[] = extractToolResults(
          parsed as { type: string; message?: { content?: unknown }; tool_use_result?: unknown },
        );

        for (const result of toolResults) {
          if (limit !== undefined && messages.length >= limit) break;

          const pending = result.toolUseId ? pendingToolUses.get(result.toolUseId) : undefined;

          const toolName = pending?.name ?? "unknown";
          const inputSummary = pending
            ? getToolInputSummary(pending.name, pending.input)
            : undefined;

          // Calculate duration if we have timestamps
          let durationMs: number | undefined;
          if (pending) {
            const startMs = new Date(pending.timestamp).getTime();
            const endMs = new Date(timestamp).getTime();
            if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs >= startMs) {
              durationMs = endMs - startMs;
            }
          }

          messages.push({
            role: "tool",
            content: result.output,
            timestamp,
            toolCall: {
              toolName,
              inputSummary,
              output: result.output,
              isError: result.isError,
              durationMs,
            },
          });

          // Clean up matched pending tool use
          if (result.toolUseId) {
            pendingToolUses.delete(result.toolUseId);
          }
        }

        continue;
      }

      // Plain text user message
      const text = extractTextContent(content);
      if (text.length > 0) {
        messages.push({ role: "user", content: text, timestamp });
      }

      continue;
    }

    // ── Assistant messages ──────────────────────────────────────────────
    if (type === "assistant") {
      const content = message.content;

      // Always extract tool_use blocks before deduplication.
      // Claude Code writes one JSONL line per content block within a single
      // API response, so multiple lines share the same message.id. We must
      // capture tool_use IDs from every line so tool results can be paired.
      if (Array.isArray(content)) {
        const toolUseBlocks: ToolUseBlock[] = extractToolUseBlocks(
          parsed as { type: string; message?: { content?: unknown } },
        );

        for (const block of toolUseBlocks) {
          if (block.id) {
            pendingToolUses.set(block.id, {
              name: block.name,
              input: block.input,
              timestamp,
            });
          }
        }
      }

      // Deduplicate text content by message ID
      const messageId = typeof message.id === "string" ? message.id : undefined;
      if (messageId) {
        if (seenAssistantIds.has(messageId)) continue;
        seenAssistantIds.add(messageId);
      }

      // Simple string content
      if (typeof content === "string") {
        if (content.length > 0) {
          messages.push({ role: "assistant", content, timestamp });
        }
        continue;
      }

      // Array of content blocks — extract text (tool_use already handled above)
      if (Array.isArray(content)) {
        const text = extractTextContent(content);

        if (text.length > 0 && (limit === undefined || messages.length < limit)) {
          messages.push({ role: "assistant", content: text, timestamp });
        }
      }
    }
  }

  return messages;
}

// =============================================================================
// extractSessionMetadata
// =============================================================================

/**
 * Extract summary metadata from a JSONL session file.
 *
 * Streams the entire file to count messages and find timestamp bounds,
 * but captures metadata fields from only the first relevant messages.
 *
 * @param sessionFilePath - Absolute path to the .jsonl file
 * @returns Session metadata with counts and previews
 */
export async function extractSessionMetadata(sessionFilePath: string): Promise<SessionMetadata> {
  const rl = await createLineReader(sessionFilePath);

  const metadata: SessionMetadata = {
    sessionId: "",
    firstMessagePreview: undefined,
    gitBranch: undefined,
    claudeCodeVersion: undefined,
    messageCount: 0,
    firstMessageAt: undefined,
    lastMessageAt: undefined,
    summary: undefined,
    isSidechain: false,
  };

  if (!rl) return metadata;

  const seenAssistantIds = new Set<string>();
  let foundFirstUser = false;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = parsed.type;

    // Track summary entries (type: "summary" with top-level summary field)
    if (type === "summary" && typeof parsed.summary === "string") {
      metadata.summary = parsed.summary;
      continue;
    }

    if (type !== "user" && type !== "assistant") continue;

    const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : undefined;

    // Track sessionId from first line that has it
    if (metadata.sessionId === "" && typeof parsed.sessionId === "string") {
      metadata.sessionId = parsed.sessionId;
    }

    // Track timestamp bounds
    if (timestamp) {
      if (metadata.firstMessageAt === undefined) {
        metadata.firstMessageAt = timestamp;
      }
      metadata.lastMessageAt = timestamp;
    }

    if (type === "user") {
      // Extract first-user-message-specific fields
      if (!foundFirstUser) {
        foundFirstUser = true;

        if (parsed.isSidechain === true) {
          metadata.isSidechain = true;
        }
        if (typeof parsed.gitBranch === "string") {
          metadata.gitBranch = parsed.gitBranch;
        }
        if (typeof parsed.version === "string") {
          metadata.claudeCodeVersion = parsed.version;
        }

        const message = parsed.message as Record<string, unknown> | undefined;
        if (message) {
          const content = message.content;
          // Only extract preview from plain text messages, not tool results
          if (!hasToolResultBlocks(content)) {
            const text = extractTextContent(content);
            if (text.length > 0) {
              metadata.firstMessagePreview =
                text.length > 100 ? `${text.substring(0, 100)}...` : text;
            }
          }
        }
      }

      metadata.messageCount++;
      continue;
    }

    if (type === "assistant") {
      const message = parsed.message as Record<string, unknown> | undefined;
      const messageId = message && typeof message.id === "string" ? message.id : undefined;

      // Deduplicate assistant messages by ID
      if (messageId) {
        if (seenAssistantIds.has(messageId)) continue;
        seenAssistantIds.add(messageId);
      }

      metadata.messageCount++;
    }
  }

  return metadata;
}

// =============================================================================
// extractSessionUsage
// =============================================================================

/**
 * Extract token usage data from a JSONL session file.
 *
 * Streams the file and tracks the last seen inputTokens value from
 * assistant messages. The most recent value represents the current
 * context window fill level (not cumulative across turns).
 *
 * @param sessionFilePath - Absolute path to the .jsonl file
 * @returns Usage summary with input tokens, turn count, and data availability flag
 */
export async function extractSessionUsage(sessionFilePath: string): Promise<SessionUsage> {
  const rl = await createLineReader(sessionFilePath);

  if (!rl) {
    return { inputTokens: 0, turnCount: 0, hasData: false };
  }

  const seenIds = new Set<string>();
  let lastInputTokens = 0;
  let hasData = false;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (parsed.type !== "assistant") continue;

    const message = parsed.message as Record<string, unknown> | undefined;
    if (!message) continue;

    // Deduplicate by message ID
    const messageId = typeof message.id === "string" ? message.id : undefined;
    if (messageId) {
      if (seenIds.has(messageId)) continue;
      seenIds.add(messageId);
    }

    // Extract usage
    const usage = message.usage as Record<string, unknown> | undefined;
    if (!usage) continue;

    hasData = true;

    const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
    const cacheCreation =
      typeof usage.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : 0;
    const cacheRead =
      typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0;

    lastInputTokens = inputTokens + cacheCreation + cacheRead;
  }

  return {
    inputTokens: lastInputTokens,
    turnCount: seenIds.size,
    hasData,
  };
}

// =============================================================================
// isSidechainSession
// =============================================================================

/**
 * Check if a session file represents a sidechain (sub-agent) session.
 *
 * Claude Code sets `isSidechain: true` on the first JSONL entry when:
 * - The session is a Task tool sub-agent (most common — prompt-cache warmups)
 * - The `--resume` flag was used to start the session
 *
 * These sessions are typically noise (a single "Warmup" message + response)
 * and are filtered out of UI-facing session discovery to avoid clutter.
 *
 * Reads only the first line of the JSONL file for efficiency — O(1) per file.
 *
 * @param sessionFilePath - Absolute path to the .jsonl file
 * @returns true if the session is a sidechain session
 */
export async function isSidechainSession(sessionFilePath: string): Promise<boolean> {
  const rl = await createLineReader(sessionFilePath);
  if (!rl) return false;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      rl.close();
      return parsed.isSidechain === true;
    } catch {
      rl.close();
      return false;
    }
  }

  return false;
}

// =============================================================================
// extractLastSummary
// =============================================================================

/**
 * Extract only the last summary from a JSONL session file.
 *
 * This is a lightweight alternative to extractSessionMetadata when only the
 * auto-generated session name is needed. It streams the file and returns the
 * last `summary` value from entries with `type: "summary"`.
 *
 * @param sessionFilePath - Absolute path to the .jsonl file
 * @returns The last summary string, or undefined if none found
 */
export async function extractLastSummary(sessionFilePath: string): Promise<string | undefined> {
  const rl = await createLineReader(sessionFilePath);
  if (!rl) return undefined;

  let lastSummary: string | undefined;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    // Only process summary entries
    if (parsed.type === "summary" && typeof parsed.summary === "string") {
      lastSummary = parsed.summary;
    }
  }

  return lastSummary;
}

// =============================================================================
// extractFirstMessagePreview
// =============================================================================

/**
 * Extract the first user message text from a JSONL session file.
 *
 * Streams the file and returns the text content of the first `type: "user"`
 * entry that is not a tool result. Truncates to 100 characters. Closes the
 * reader immediately after finding the first match, so this is O(few lines).
 *
 * @param sessionFilePath - Absolute path to the .jsonl file
 * @returns The first user message preview, or undefined if none found
 */
export async function extractFirstMessagePreview(
  sessionFilePath: string,
): Promise<string | undefined> {
  const rl = await createLineReader(sessionFilePath);
  if (!rl) return undefined;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (parsed.type !== "user") continue;

    const message = parsed.message as Record<string, unknown> | undefined;
    if (!message) continue;

    const content = message.content;

    // Skip tool result messages
    if (hasToolResultBlocks(content)) continue;

    const text = extractTextContent(content);
    if (text.length > 0) {
      rl.close();
      return text.length > 100 ? `${text.substring(0, 100)}...` : text;
    }
  }

  return undefined;
}
