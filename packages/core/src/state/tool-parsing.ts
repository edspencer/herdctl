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
 * Extract tool results from a user message
 *
 * Returns output, error status, and the tool_use_id for matching
 * to the pending tool_use that produced this result.
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
        const textParts: string[] = [];
        for (const part of blockContent) {
          if (
            part &&
            typeof part === "object" &&
            "type" in part &&
            part.type === "text" &&
            "text" in part &&
            typeof part.text === "string"
          ) {
            textParts.push(part.text);
          }
        }
        if (textParts.length > 0) {
          results.push({ output: textParts.join("\n"), isError, toolUseId });
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
      const textParts: string[] = [];
      for (const block of obj.content) {
        if (
          block &&
          typeof block === "object" &&
          "type" in block &&
          (block as Record<string, unknown>).type === "text" &&
          "text" in block &&
          typeof (block as Record<string, unknown>).text === "string"
        ) {
          textParts.push((block as Record<string, unknown>).text as string);
        }
      }
      if (textParts.length > 0) {
        return {
          output: textParts.join("\n"),
          isError: obj.is_error === true,
          toolUseId: typeof obj.tool_use_id === "string" ? obj.tool_use_id : undefined,
        };
      }
    }
  }

  return undefined;
}
