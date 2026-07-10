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

  it("keeps the text of an assistant turn whose thinking + text blocks share one message.id", async () => {
    // Extended-thinking responses are written as separate JSONL lines sharing one
    // message.id: a `thinking` block line (no text), then the `text` block line.
    // The parser must not let the no-text thinking line consume the ID and drop
    // the following text line — otherwise the assistant's actual answer vanishes
    // when a chat is reloaded from history.
    const messages = await parseSessionMessages(fixture("thinking-then-text-session.jsonl"));

    // 1 user + 1 assistant (the text; the thinking-only line emits nothing) = 2
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe(
      "We use the NO (Normally Open) terminal so the valve is de-energized and bypasses by default when the tank is hot.",
    );
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

  it("skips injected isMeta user lines in meta-session.jsonl", async () => {
    const messages = await parseSessionMessages(fixture("meta-session.jsonl"));

    // 1 real user + 1 injected (isMeta) user + 1 assistant → the isMeta line is
    // dropped, leaving 1 user + 1 assistant = 2.
    expect(messages).toHaveLength(2);

    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("try again");
    expect(messages[1].role).toBe("assistant");

    // The injected skill body must not leak in as a user (or any) message.
    for (const msg of messages) {
      expect(msg.content).not.toContain("Building LLM-Powered Applications");
    }
  });

  it("skips synthetic '<synthetic>' assistant placeholder turns after a /compact", async () => {
    const messages = await parseSessionMessages(fixture("compact-synthetic-session.jsonl"));

    // system(compact_boundary) + isMeta continuation + synthetic assistant are
    // all dropped, leaving 1 real user + 1 real assistant = 2.
    expect(messages).toHaveLength(2);

    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("What did we decide about the parser?");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toContain("skip synthetic placeholder turns");

    // The placeholder must not render as an assistant bubble.
    for (const msg of messages) {
      expect(msg.content).not.toContain("No response requested.");
    }
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
// parseSessionMessages - stable per-message uuid
// =============================================================================

describe("parseSessionMessages - uuid", () => {
  it("maps user and assistant messages to their source line uuid", async () => {
    const messages = await parseSessionMessages(fixture("simple-session.jsonl"));

    // Each ChatMessage's uuid matches the `uuid` on its originating JSONL line.
    expect(messages.map((m) => m.uuid)).toEqual([
      "uuid-simple-001", // user  "What is TypeScript?"
      "uuid-simple-002", // assistant reply
      "uuid-simple-003", // user  "How do I install it?"
      "uuid-simple-004", // assistant reply
    ]);
  });

  it("anchors a paired tool message to the originating tool_use entry's uuid", async () => {
    // uuid-session.jsonl deliberately splits the assistant text and the tool_use
    // onto separate lines (as Claude Code does), and the tool_result onto a third
    // line — so the three candidate uuids are all distinct and the assertion is
    // unambiguous about which one the tool message adopts.
    const messages = await parseSessionMessages(fixture("uuid-session.jsonl"));

    // user → assistant (text) → tool (Bash result) → assistant (final)
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);

    expect(messages[0].uuid).toBe("uuid-uuid-user-1");
    expect(messages[1].uuid).toBe("uuid-uuid-asst-text");

    // The tool message adopts the tool_use entry's uuid — NOT the tool_result
    // user line's uuid, and NOT the preceding assistant-text line's uuid.
    expect(messages[2].role).toBe("tool");
    expect(messages[2].uuid).toBe("uuid-uuid-asst-tooluse");
    expect(messages[2].uuid).not.toBe("uuid-uuid-user-toolresult");
    expect(messages[2].uuid).not.toBe("uuid-uuid-asst-text");

    expect(messages[3].uuid).toBe("uuid-uuid-asst-final");
  });

  it("gives every paired tool message the uuid of its own tool_use origin", async () => {
    // multi-tool-session has two tool_use blocks in one assistant entry, but each
    // result is still paired back to that originating entry deterministically.
    const messages = await parseSessionMessages(fixture("multi-tool-session.jsonl"));

    const toolMessages = messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(2);
    for (const msg of toolMessages) {
      // Both originate from the same assistant entry in this fixture.
      expect(msg.uuid).toBe("uuid-multi-002");
    }
  });

  it("produces identical uuids across repeated parses of the same file", async () => {
    const first = await parseSessionMessages(fixture("uuid-session.jsonl"));
    const second = await parseSessionMessages(fixture("uuid-session.jsonl"));

    expect(first.map((m) => m.uuid)).toEqual(second.map((m) => m.uuid));
    // And none of them is undefined for this fully-populated fixture.
    for (const msg of first) {
      expect(msg.uuid).toBeTruthy();
    }
  });

  it("leaves uuid undefined when the source line carries no uuid", async () => {
    // no-uuid-session.jsonl's lines omit the `uuid` field entirely.
    const messages = await parseSessionMessages(fixture("no-uuid-session.jsonl"));

    expect(messages).toHaveLength(2);
    for (const msg of messages) {
      expect(msg.uuid).toBeUndefined();
    }
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

  it("excludes injected isMeta user lines from messageCount", async () => {
    // meta-session.jsonl: 1 real user + 1 isMeta user + 1 assistant. The isMeta
    // line must not be counted, leaving 1 user + 1 assistant = 2.
    const meta = await extractSessionMetadata(fixture("meta-session.jsonl"));

    expect(meta.messageCount).toBe(2);
    expect(meta.firstMessagePreview).toBe("try again");
  });

  it("does not let a leading isMeta line seed the preview, branch, or time bounds", async () => {
    // meta-first-session.jsonl leads with an injected skill body (isMeta) before
    // the real user message. The preview/first-message fields must come from the
    // real user turn, not the injected content.
    const meta = await extractSessionMetadata(fixture("meta-first-session.jsonl"));

    // 1 real user + 1 assistant — the isMeta skill body is not counted.
    expect(meta.messageCount).toBe(2);

    // Preview is the real user's message, not the skill body.
    expect(meta.firstMessagePreview).toBe("Help me refactor this parser.");
    expect(meta.firstMessagePreview).not.toContain("Building LLM-Powered Applications");

    // Timestamp bounds start at the real user message, not the injected line.
    expect(meta.firstMessageAt).toBe("2026-02-01T09:00:05.000Z");
    expect(meta.lastMessageAt).toBe("2026-02-01T09:00:10.000Z");
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
