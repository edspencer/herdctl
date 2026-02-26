/**
 * Tests for JSONL session file parser
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  extractFirstMessagePreview,
  extractLastSummary,
  extractSessionMetadata,
  extractSessionUsage,
  isSidechainSession,
  parseSessionMessages,
} from "../jsonl-parser.js";

const fixturesDir = join(import.meta.dirname, "fixtures");
const fixture = (name: string) => join(fixturesDir, name);

// =============================================================================
// parseSessionMessages
// =============================================================================

describe("parseSessionMessages", () => {
  it("parses simple-session.jsonl into correct ChatMessages", async () => {
    const messages = await parseSessionMessages(fixture("simple-session.jsonl"));

    // 2 user + 2 assistant = 4 messages
    expect(messages).toHaveLength(4);

    // All roles are user or assistant (no tool calls in this fixture)
    for (const msg of messages) {
      expect(["user", "assistant"]).toContain(msg.role);
    }

    // All messages have non-empty content
    for (const msg of messages) {
      expect(msg.content.length).toBeGreaterThan(0);
    }

    // All timestamps are ISO strings
    for (const msg of messages) {
      expect(new Date(msg.timestamp).toISOString()).toBe(msg.timestamp);
    }

    // Verify ordering: user, assistant, user, assistant
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("What is TypeScript?");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toContain("TypeScript is a strongly typed");
    expect(messages[2].role).toBe("user");
    expect(messages[2].content).toBe("How do I install it?");
    expect(messages[3].role).toBe("assistant");
    expect(messages[3].content).toContain("npm install -g typescript");
  });

  it("parses tool-calls-session.jsonl with correct tool metadata", async () => {
    const messages = await parseSessionMessages(fixture("tool-calls-session.jsonl"));

    // 1 user + 1 assistant (text) + 1 tool (Read result) + 1 assistant = 4
    expect(messages).toHaveLength(4);

    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("Let me read that file for you.");

    // Tool message
    const toolMsg = messages[2];
    expect(toolMsg.role).toBe("tool");
    expect(toolMsg.toolCall).toBeDefined();
    expect(toolMsg.toolCall!.toolName).toBe("Read");
    expect(toolMsg.toolCall!.isError).toBe(false);
    expect(toolMsg.toolCall!.output).toContain("import express from 'express'");
    expect(toolMsg.toolCall!.inputSummary).toBe("/src/index.ts");

    // Final assistant message
    expect(messages[3].role).toBe("assistant");
    expect(messages[3].content).toContain("entry point for an Express.js web server");
  });

  it("parses multi-tool-session.jsonl with multiple tool messages from one assistant response", async () => {
    const messages = await parseSessionMessages(fixture("multi-tool-session.jsonl"));

    // 1 user + 1 assistant (text) + 1 tool (Bash) + 1 tool (Read) + 1 assistant = 5
    expect(messages).toHaveLength(5);

    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");

    // First tool: Bash
    const bashTool = messages[2];
    expect(bashTool.role).toBe("tool");
    expect(bashTool.toolCall!.toolName).toBe("Bash");
    expect(bashTool.toolCall!.isError).toBe(false);
    expect(bashTool.toolCall!.output).toContain("On branch main");
    expect(bashTool.toolCall!.inputSummary).toBe("git status");

    // Second tool: Read
    const readTool = messages[3];
    expect(readTool.role).toBe("tool");
    expect(readTool.toolCall!.toolName).toBe("Read");
    expect(readTool.toolCall!.isError).toBe(false);
    expect(readTool.toolCall!.output).toContain("my-project");
    expect(readTool.toolCall!.inputSummary).toBe("/workspace/package.json");

    // Final assistant text
    expect(messages[4].role).toBe("assistant");
  });

  it("parses split-tool-blocks-session.jsonl where tool_use blocks are on separate lines with same message.id", async () => {
    // Claude Code CLI writes one JSONL line per content block, so parallel tool calls
    // produce multiple lines with the same message.id. The parser must extract tool_use
    // blocks from ALL lines before deduplicating assistant text.
    const messages = await parseSessionMessages(fixture("split-tool-blocks-session.jsonl"));

    // 1 user + 1 assistant (text) + 1 tool (Bash) + 1 tool (Read) + 1 assistant = 5
    expect(messages).toHaveLength(5);

    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("I'll check both for you.");

    // First tool: Bash — from the first assistant line
    const bashTool = messages[2];
    expect(bashTool.role).toBe("tool");
    expect(bashTool.toolCall!.toolName).toBe("Bash");
    expect(bashTool.toolCall!.inputSummary).toBe("git status");
    expect(bashTool.toolCall!.output).toContain("nothing to commit");

    // Second tool: Read — from the SECOND assistant line (same message.id)
    const readTool = messages[3];
    expect(readTool.role).toBe("tool");
    expect(readTool.toolCall!.toolName).toBe("Read");
    expect(readTool.toolCall!.inputSummary).toBe("/workspace/config.json");
    expect(readTool.toolCall!.output).toContain("8080");

    // Final assistant
    expect(messages[4].role).toBe("assistant");
  });

  it("parses content-blocks-session.jsonl with mixed text and tool_use blocks", async () => {
    const messages = await parseSessionMessages(fixture("content-blocks-session.jsonl"));

    // 1 user + 1 assistant (combined text) + 1 tool (Read) + 1 tool (Bash) + 1 assistant = 5
    expect(messages).toHaveLength(5);

    expect(messages[0].role).toBe("user");

    // Assistant message should contain combined text from both text blocks
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toContain("Let me check both for you.");
    expect(messages[1].content).toContain("I'll also check the current directory.");

    // Tool results
    const readTool = messages[2];
    expect(readTool.role).toBe("tool");
    expect(readTool.toolCall!.toolName).toBe("Read");
    expect(readTool.toolCall!.output).toContain("port");

    const bashTool = messages[3];
    expect(bashTool.role).toBe("tool");
    expect(bashTool.toolCall!.toolName).toBe("Bash");
    expect(bashTool.toolCall!.output).toBe("/workspace");

    expect(messages[4].role).toBe("assistant");
  });

  it("parses sdk-agent-session.jsonl the same way as regular sessions", async () => {
    const messages = await parseSessionMessages(fixture("sdk-agent-session.jsonl"));

    // 1 user + 1 assistant + 1 tool (Bash) + 1 assistant + 1 tool (Write) + 1 assistant = 6
    expect(messages).toHaveLength(6);

    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toContain("login form component");

    expect(messages[1].role).toBe("assistant");
    expect(messages[2].role).toBe("tool");
    expect(messages[2].toolCall!.toolName).toBe("Bash");
    expect(messages[2].toolCall!.inputSummary).toBe("ls src/components/");

    expect(messages[3].role).toBe("assistant");
    expect(messages[4].role).toBe("tool");
    expect(messages[4].toolCall!.toolName).toBe("Write");
    expect(messages[4].toolCall!.inputSummary).toBe(
      "/workspace/project/src/components/LoginForm.tsx",
    );

    expect(messages[5].role).toBe("assistant");
    expect(messages[5].content).toContain("LoginForm");
  });

  it("skips summary lines in summary-session.jsonl", async () => {
    const messages = await parseSessionMessages(fixture("summary-session.jsonl"));

    // 2 summary lines are skipped, 2 user + 2 assistant = 4
    expect(messages).toHaveLength(4);

    // All messages should be user or assistant, no summaries leaking through
    for (const msg of messages) {
      expect(["user", "assistant"]).toContain(msg.role);
    }

    // First message should be the first actual user message, not summary text
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Now let's add a health check endpoint.");
  });

  it("handles malformed-session.jsonl without throwing", async () => {
    const messages = await parseSessionMessages(fixture("malformed-session.jsonl"));

    // Line 1: valid user
    // Line 2: invalid JSON - skipped
    // Line 3: blank line - skipped
    // Line 4: valid assistant
    // Line 5: valid JSON but no type field - skipped
    // Line 6: valid user
    // Total: 2 user + 1 assistant = 3
    expect(messages).toHaveLength(3);

    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("First valid message");

    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("Response to the first message.");

    expect(messages[2].role).toBe("user");
    expect(messages[2].content).toBe("Another valid user message after the bad lines");
  });

  it("returns all messages from large-session.jsonl without error", async () => {
    const messages = await parseSessionMessages(fixture("large-session.jsonl"));

    // 53 user + 53 assistant = 106 messages
    expect(messages).toHaveLength(106);

    // Verify first and last messages
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("What is a variable?");
    expect(messages[messages.length - 1].role).toBe("assistant");
    expect(messages[messages.length - 1].content).toContain("Server-Side Rendering");
  });

  it("respects limit parameter on large-session.jsonl", async () => {
    const messages = await parseSessionMessages(fixture("large-session.jsonl"), { limit: 5 });

    expect(messages).toHaveLength(5);
  });

  it("returns empty array for nonexistent file", async () => {
    const messages = await parseSessionMessages(fixture("does-not-exist.jsonl"));

    expect(messages).toEqual([]);
  });
});

// =============================================================================
// extractSessionMetadata
// =============================================================================

describe("extractSessionMetadata", () => {
  it("extracts correct metadata from simple-session.jsonl", async () => {
    const meta = await extractSessionMetadata(fixture("simple-session.jsonl"));

    expect(meta.sessionId).toBe("session-simple-001");
    expect(meta.gitBranch).toBe("main");
    expect(meta.claudeCodeVersion).toBe("2.0.77");
    expect(meta.firstMessagePreview).toBe("What is TypeScript?");
    expect(meta.firstMessagePreview!.length).toBeGreaterThan(0);
    expect(meta.messageCount).toBe(4);
    expect(meta.firstMessageAt).toBe("2026-01-26T10:00:00.000Z");
    expect(meta.lastMessageAt).toBe("2026-01-26T10:00:20.000Z");
  });

  it("returns the correct sessionId from the fixture", async () => {
    const meta = await extractSessionMetadata(fixture("tool-calls-session.jsonl"));

    expect(meta.sessionId).toBe("session-tools-001");
  });

  it("deduplicates assistant messages by message.id for messageCount", async () => {
    // simple-session has 2 user + 2 assistant (each with unique id) = 4
    const meta = await extractSessionMetadata(fixture("simple-session.jsonl"));

    expect(meta.messageCount).toBe(4);
  });

  it("has firstMessageAt < lastMessageAt", async () => {
    const meta = await extractSessionMetadata(fixture("simple-session.jsonl"));

    expect(meta.firstMessageAt).toBeDefined();
    expect(meta.lastMessageAt).toBeDefined();

    const first = new Date(meta.firstMessageAt!).getTime();
    const last = new Date(meta.lastMessageAt!).getTime();
    expect(first).toBeLessThan(last);
  });

  it("returns sensible defaults for nonexistent file", async () => {
    const meta = await extractSessionMetadata(fixture("does-not-exist.jsonl"));

    expect(meta.sessionId).toBe("");
    expect(meta.firstMessagePreview).toBeUndefined();
    expect(meta.gitBranch).toBeUndefined();
    expect(meta.claudeCodeVersion).toBeUndefined();
    expect(meta.messageCount).toBe(0);
    expect(meta.firstMessageAt).toBeUndefined();
    expect(meta.lastMessageAt).toBeUndefined();
  });
});

// =============================================================================
// extractSessionUsage
// =============================================================================

describe("extractSessionUsage", () => {
  it("returns usage data from simple-session.jsonl", async () => {
    const usage = await extractSessionUsage(fixture("simple-session.jsonl"));

    expect(usage.hasData).toBe(true);
    expect(usage.turnCount).toBeGreaterThan(0);
    expect(usage.inputTokens).toBeGreaterThan(0);
  });

  it("turnCount equals number of unique assistant message IDs", async () => {
    const usage = await extractSessionUsage(fixture("simple-session.jsonl"));

    // msg_001 and msg_002 = 2 unique assistant IDs
    expect(usage.turnCount).toBe(2);
  });

  it("inputTokens is the last assistant message total, not cumulative", async () => {
    const usage = await extractSessionUsage(fixture("simple-session.jsonl"));

    // Last assistant (msg_002): input_tokens=180 + cache_creation=0 + cache_read=120 = 300
    expect(usage.inputTokens).toBe(300);
  });

  it("handles malformed-session.jsonl without throwing", async () => {
    const usage = await extractSessionUsage(fixture("malformed-session.jsonl"));

    // Only one valid assistant (msg_010): input_tokens=100 + 0 + 0 = 100
    expect(usage.hasData).toBe(true);
    expect(usage.turnCount).toBe(1);
    expect(usage.inputTokens).toBe(100);
  });

  it("returns zero usage for nonexistent file", async () => {
    const usage = await extractSessionUsage(fixture("does-not-exist.jsonl"));

    expect(usage.inputTokens).toBe(0);
    expect(usage.turnCount).toBe(0);
    expect(usage.hasData).toBe(false);
  });
});

// =============================================================================
// extractLastSummary
// =============================================================================

describe("extractLastSummary", () => {
  it("returns the last summary from summary-session.jsonl", async () => {
    const summary = await extractLastSummary(fixture("summary-session.jsonl"));

    // The fixture has 2 summary entries; should return the second (last) one
    expect(summary).toBe(
      "The assistant helped configure CORS and body-parser middleware. The user then asked about database integration.",
    );
  });

  it("returns undefined for simple-session.jsonl (no summaries)", async () => {
    const summary = await extractLastSummary(fixture("simple-session.jsonl"));

    expect(summary).toBeUndefined();
  });

  it("returns undefined for nonexistent file", async () => {
    const summary = await extractLastSummary(fixture("does-not-exist.jsonl"));

    expect(summary).toBeUndefined();
  });

  it("handles malformed-session.jsonl without throwing", async () => {
    const summary = await extractLastSummary(fixture("malformed-session.jsonl"));

    // No summary entries in this fixture
    expect(summary).toBeUndefined();
  });
});

// =============================================================================
// extractSessionMetadata - summary field
// =============================================================================

describe("extractSessionMetadata - summary field", () => {
  it("includes summary field from summary-session.jsonl", async () => {
    const meta = await extractSessionMetadata(fixture("summary-session.jsonl"));

    // Should have the last summary
    expect(meta.summary).toBe(
      "The assistant helped configure CORS and body-parser middleware. The user then asked about database integration.",
    );
  });

  it("returns undefined summary for sessions without summaries", async () => {
    const meta = await extractSessionMetadata(fixture("simple-session.jsonl"));

    expect(meta.summary).toBeUndefined();
  });
});

// =============================================================================
// isSidechainSession
// =============================================================================

describe("isSidechainSession", () => {
  it("returns true for sidechain session", async () => {
    expect(await isSidechainSession(fixture("sidechain-session.jsonl"))).toBe(true);
  });

  it("returns false for normal session", async () => {
    expect(await isSidechainSession(fixture("simple-session.jsonl"))).toBe(false);
  });

  it("returns false for nonexistent file", async () => {
    expect(await isSidechainSession(fixture("does-not-exist.jsonl"))).toBe(false);
  });
});

// =============================================================================
// extractSessionMetadata - isSidechain field
// =============================================================================

describe("extractSessionMetadata - isSidechain field", () => {
  it("sets isSidechain true for sidechain sessions", async () => {
    const meta = await extractSessionMetadata(fixture("sidechain-session.jsonl"));
    expect(meta.isSidechain).toBe(true);
  });

  it("sets isSidechain false for normal sessions", async () => {
    const meta = await extractSessionMetadata(fixture("simple-session.jsonl"));
    expect(meta.isSidechain).toBe(false);
  });
});

// =============================================================================
// extractFirstMessagePreview
// =============================================================================

describe("extractFirstMessagePreview", () => {
  it("returns first user message text from simple session", async () => {
    const preview = await extractFirstMessagePreview(fixture("simple-session.jsonl"));
    expect(preview).toBe("What is TypeScript?");
  });

  it("returns undefined for nonexistent file", async () => {
    const preview = await extractFirstMessagePreview(fixture("does-not-exist.jsonl"));
    expect(preview).toBeUndefined();
  });

  it("skips tool result messages and returns first text message", async () => {
    // content-blocks-session has tool_use in assistant, tool_result in user
    const preview = await extractFirstMessagePreview(fixture("content-blocks-session.jsonl"));
    expect(preview).toBeDefined();
    expect(typeof preview).toBe("string");
    expect(preview!.length).toBeGreaterThan(0);
  });

  it("returns preview from summary session (user message before summaries)", async () => {
    const preview = await extractFirstMessagePreview(fixture("summary-session.jsonl"));
    expect(preview).toBeDefined();
    expect(typeof preview).toBe("string");
  });
});
