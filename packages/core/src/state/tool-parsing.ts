/**
 * Tool call/result parsing utilities
 *
 * Extracts tool_use and tool_result blocks from Claude SDK messages.
 * These were originally private methods on the Discord manager but are
 * shared across Discord, Slack, and Web connectors.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * A parsed tool_use block from an assistant message
 */
export interface ToolUseBlock {
  /** Tool use ID for pairing with results */
  id?: string;
  /** Tool name (e.g., "Bash", "Read", "Write") */
  name: string;
  /** Tool input object */
  input?: unknown;
}

/**
 * A parsed tool_result from a user message
 */
export interface ToolResult {
  /** Tool output text */
  output: string;
  /** Whether the tool returned an error */
  isError: boolean;
  /** ID of the tool_use this result corresponds to */
  toolUseId?: string;
  /**
   * Non-text image content blocks returned by the tool, preserved so a
   * consuming UI can render them inline (e.g. a Playwright
   * `browser_take_screenshot` result). Absent when the result carried no
   * image blocks. The text-only {@link output} is always populated for
   * consumers that don't handle images.
   */
  images?: ExtractedImage[];
}

/**
 * A non-text image content block, normalized out of an Anthropic-style
 * `{ type: "image", source: … }` block.
 *
 * The two `source` shapes the SDK/CLI emit are collapsed into one structure:
 * base64-inlined bytes (`kind: "base64"`) or a direct URL (`kind: "url"`). Use
 * {@link imageToDataUrl} to turn one into a browser-renderable `src`.
 */
export interface ExtractedImage {
  /** How the image bytes are carried. */
  kind: "base64" | "url";
  /** MIME type when known (e.g. "image/png"). */
  mediaType?: string;
  /** Base64-encoded image bytes; present when `kind === "base64"`. */
  data?: string;
  /** Direct image URL; present when `kind === "url"`. */
  url?: string;
}

/**
 * Emoji mapping for common tool names
 */
export const TOOL_EMOJIS: Record<string, string> = {
  Bash: "\u{1F4BB}", // laptop
  bash: "\u{1F4BB}",
  Read: "\u{1F4C4}", // page
  Write: "\u{270F}\u{FE0F}", // pencil
  Edit: "\u{270F}\u{FE0F}",
  Glob: "\u{1F50D}", // magnifying glass
  Grep: "\u{1F50D}",
  WebFetch: "\u{1F310}", // globe
  WebSearch: "\u{1F310}",
};

// =============================================================================
// Extraction Functions
// =============================================================================

/**
 * Extract tool_use blocks from an assistant message's content blocks
 *
 * Returns id, name, and input for each tool_use block so callers can
 * track pending calls and pair them with results.
 *
 * @param message - SDK message object (assistant type)
 * @returns Array of parsed tool use blocks
 */
export function extractToolUseBlocks(message: {
  type: string;
  message?: { content?: unknown };
}): ToolUseBlock[] {
  const apiMessage = message.message as { content?: unknown } | undefined;
  const content = apiMessage?.content;

  if (!Array.isArray(content)) return [];

  const blocks: ToolUseBlock[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      "type" in block &&
      block.type === "tool_use" &&
      "name" in block &&
      typeof block.name === "string"
    ) {
      blocks.push({
        id: "id" in block && typeof block.id === "string" ? block.id : undefined,
        name: block.name,
        input: "input" in block ? block.input : undefined,
      });
    }
  }
  return blocks;
}

/**
 * Get a human-readable summary of tool input
 *
 * Produces a short description based on the tool name and its input,
 * e.g. the command for Bash, the file path for Read/Write, etc.
 *
 * @param name - Tool name
 * @param input - Tool input object
 * @returns Human-readable summary, or undefined if no summary available
 */
export function getToolInputSummary(name: string, input?: unknown): string | undefined {
  const inputObj = input as Record<string, unknown> | undefined;

  if (name === "Bash" || name === "bash") {
    const command = inputObj?.command;
    if (typeof command === "string" && command.length > 0) {
      return command.length > 200 ? `${command.substring(0, 200)}...` : command;
    }
  }

  if (name === "Read" || name === "Write" || name === "Edit") {
    const path = inputObj?.file_path ?? inputObj?.path;
    if (typeof path === "string") return path;
  }

  if (name === "Glob" || name === "Grep") {
    const pattern = inputObj?.pattern;
    if (typeof pattern === "string") return pattern;
  }

  if (name === "WebFetch" || name === "WebSearch") {
    const url = inputObj?.url;
    const query = inputObj?.query;
    if (typeof url === "string") return url;
    if (typeof query === "string") return query;
  }

  return undefined;
}

/**
 * Normalize an Anthropic-style `{ type: "image", source: … }` content block
 * into an {@link ExtractedImage}, or return `undefined` if the block is not a
 * well-formed image block.
 *
 * Accepts both `source` shapes emitted by the SDK/CLI:
 * - `{ type: "base64", media_type, data }`
 * - `{ type: "url", url }`
 *
 * `media_type` (Anthropic's snake_case) and a camelCase `mediaType` fallback are
 * both read so the helper is robust across transports.
 *
 * @param block - A candidate content block
 * @returns The normalized image, or `undefined` if not an image block
 */
export function normalizeImageBlock(block: unknown): ExtractedImage | undefined {
  if (!block || typeof block !== "object" || !("type" in block)) return undefined;
  if ((block as { type?: unknown }).type !== "image") return undefined;

  const source = (block as { source?: unknown }).source;
  if (!source || typeof source !== "object") return undefined;
  const src = source as Record<string, unknown>;

  const mediaType =
    typeof src.media_type === "string"
      ? src.media_type
      : typeof src.mediaType === "string"
        ? src.mediaType
        : undefined;

  if (src.type === "base64" && typeof src.data === "string" && src.data.length > 0) {
    return { kind: "base64", mediaType, data: src.data };
  }
  if (src.type === "url" && typeof src.url === "string" && src.url.length > 0) {
    return { kind: "url", mediaType, url: src.url };
  }
  return undefined;
}

/**
 * Type guard: whether a content block is a well-formed image block.
 *
 * @param block - Content block to check
 * @returns true if {@link normalizeImageBlock} can parse it
 */
export function isImageContentBlock(block: unknown): boolean {
  return normalizeImageBlock(block) !== undefined;
}

/**
 * Turn an {@link ExtractedImage} into a browser-renderable `src`.
 *
 * Returns the URL directly for `kind: "url"`, or a `data:` URI for
 * `kind: "base64"` (defaulting the MIME type to `image/png` when unknown).
 *
 * @param image - The normalized image
 * @returns A string usable as an `<img src>`, or `undefined` if empty
 */
export function imageToDataUrl(image: ExtractedImage): string | undefined {
  if (image.kind === "url") return image.url;
  if (image.kind === "base64" && image.data) {
    return `data:${image.mediaType ?? "image/png"};base64,${image.data}`;
  }
  return undefined;
}

/**
 * Split an array of content blocks into text parts and normalized image blocks.
 *
 * Shared by the tool-result parsers so both the nested `content[]` and the
 * top-level `tool_use_result` shapes preserve images identically. Unknown block
 * types are ignored (their text/image payloads, if any, don't match).
 *
 * @param content - Array of content blocks
 * @returns Collected text parts and images
 */
function collectContentBlocks(content: unknown[]): {
  text: string[];
  images: ExtractedImage[];
} {
  const text: string[] = [];
  const images: ExtractedImage[] = [];

  for (const part of content) {
    if (!part || typeof part !== "object" || !("type" in part)) continue;
    const type = (part as { type?: unknown }).type;

    if (
      type === "text" &&
      "text" in part &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      text.push((part as { text: string }).text);
      continue;
    }

    const image = normalizeImageBlock(part);
    if (image) images.push(image);
  }

  return { text, images };
}

/**
 * Extract tool results from a user message
 *
 * Returns output, error status, and the tool_use_id for matching
 * to the pending tool_use that produced this result. Non-text image blocks in
 * the result content are preserved on {@link ToolResult.images} so a consuming
 * UI can render them; the text-only {@link ToolResult.output} is always set.
 *
 * @param message - SDK message object (user type with tool results)
 * @returns Array of parsed tool results
 */
export function extractToolResults(message: {
  type: string;
  message?: { content?: unknown };
  tool_use_result?: unknown;
}): ToolResult[] {
  const results: ToolResult[] = [];

  // Check for top-level tool_use_result (direct SDK format)
  if (message.tool_use_result !== undefined) {
    const extracted = extractToolResultContent(message.tool_use_result);
    if (extracted) {
      results.push(extracted);
    }
    return results;
  }

  // Check for content blocks in nested message
  const apiMessage = message.message as { content?: unknown } | undefined;
  const content = apiMessage?.content;

  if (!Array.isArray(content)) return results;

  for (const block of content) {
    if (!block || typeof block !== "object" || !("type" in block)) continue;

    if (block.type === "tool_result") {
      const toolResultBlock = block as {
        content?: unknown;
        is_error?: boolean;
        tool_use_id?: string;
      };
      const isError = toolResultBlock.is_error === true;
      const toolUseId =
        typeof toolResultBlock.tool_use_id === "string" ? toolResultBlock.tool_use_id : undefined;

      // Content can be a string or an array of content blocks
      const blockContent = toolResultBlock.content;
      if (typeof blockContent === "string" && blockContent.length > 0) {
        results.push({ output: blockContent, isError, toolUseId });
      } else if (Array.isArray(blockContent)) {
        const { text, images } = collectContentBlocks(blockContent);
        // Push when there is text OR images: an image-only tool result (e.g. a
        // screenshot) has empty text but must still surface its image blocks.
        if (text.length > 0 || images.length > 0) {
          results.push({
            output: text.join("\n"),
            isError,
            toolUseId,
            ...(images.length > 0 ? { images } : {}),
          });
        }
      }
    }
  }

  return results;
}

/**
 * Extract content from a top-level tool_use_result value
 *
 * Handles the various formats that a tool result value can take:
 * - Plain string
 * - Object with `content` string
 * - Object with `content` array of text blocks
 *
 * @param result - Raw tool_use_result value from SDK
 * @returns Parsed tool result, or undefined if content could not be extracted
 */
export function extractToolResultContent(result: unknown): ToolResult | undefined {
  if (typeof result === "string" && result.length > 0) {
    return { output: result, isError: false };
  }

  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;

    // Check for content field
    if (typeof obj.content === "string" && obj.content.length > 0) {
      return {
        output: obj.content,
        isError: obj.is_error === true,
        toolUseId: typeof obj.tool_use_id === "string" ? obj.tool_use_id : undefined,
      };
    }

    // Check for content blocks array
    if (Array.isArray(obj.content)) {
      const { text, images } = collectContentBlocks(obj.content);
      // Push when there is text OR images: an image-only result must still
      // surface its image blocks even though its text output is empty.
      if (text.length > 0 || images.length > 0) {
        return {
          output: text.join("\n"),
          isError: obj.is_error === true,
          toolUseId: typeof obj.tool_use_id === "string" ? obj.tool_use_id : undefined,
          ...(images.length > 0 ? { images } : {}),
        };
      }
    }
  }

  return undefined;
}
