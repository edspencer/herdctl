# WEA-49: Convert Agent Markdown Output to Slack mrkdwn

## Problem

Agent output uses standard GitHub-flavored markdown, but Slack uses its own "mrkdwn" format. Messages show raw markdown tags (`**bold**`, `[text](url)`, `# Header`) instead of rendered formatting.

## Prior State

- `markdownToMrkdwn()` existed in `packages/slack/src/formatting.ts` with tests
- It handled only **bold** (`**text**` → `*text*`) and **links** (`[text](url)` → `<url|text>`)
- It correctly skipped content inside code blocks (`` ` `` and ` ``` `)
- It was **never called** anywhere in the message pipeline — only tested and exported
- Agent system prompt told the agent to "Use Slack formatting (`*bold*`, `` `code` ``)" — mixing Slack-native formatting with markdown from the LLM

## Message Flow

```
Agent SDK → onMessage(assistant) → extractMessageContent() → StreamingResponder → reply() → say({text})
```

No conversion happened at any step. Raw markdown went straight to Slack.

## What We Tried

### Attempt 1: Hand-rolled regex conversions

Extended the existing `markdownToMrkdwn()` with regex-based conversions using the `convertOutsideCodeBlocks()` helper:

| Markdown | Slack mrkdwn | Regex |
|----------|-------------|-------|
| `**bold**` | `*bold*` | `/\*\*(.+?)\*\*/g` |
| `[text](url)` | `<url\|text>` | `/\[([^\]]+)\]\(([^)]+)\)/g` |
| `# Header` | `*Header*` | `/^#{1,6}\s+(.+)$/gm` |
| `~~strike~~` | `~strike~` | `/~~(.+?)~~/g` |
| `![alt](url)` | `<url\|alt>` | `/!\[([^\]]*)\]\(([^)]+)\)/g` |
| `---` / `***` | `———` | `/^(?:[-*_]){3,}[ \t]*$/gm` |

**Result:** Basic cases worked, but real agent output broke. The regex couldn't handle edge cases like `* **Bold text**` (list item with bold), emojis adjacent to bold markers, or nested formatting. Example failure: `* **Churches & Chapels**` rendered as `* *Churches & Chapels**` in Slack — the regex consumed one `*` from the list bullet and one from the bold marker, leaving a malformed result.

### Attempt 2: slackify-markdown library (AST-based)

Replaced hand-rolled regexes with [slackify-markdown](https://github.com/jsarafajr/slackify-markdown) (v5), which uses Unified/Remark for proper AST parsing.

**Result:** Much better — proper list bullet conversion (`*` → `•`), correct bold/italic handling, code block preservation. But two issues surfaced:

1. **Zero-width spaces:** The library inserts `\u200B` around formatting markers (e.g., `\u200B*bold*\u200B`) to prevent collision. Slack's mrkdwn parser doesn't understand these and shows raw `*` characters instead of rendering bold. **Fix:** Strip all `\u200B` from output.

2. **Horizontal rules:** The library converts `---` to `***`. Slack's mrkdwn has no horizontal rule support, so `***` renders as literal asterisks (or worse, gets misinterpreted as a bold marker). **Fix:** Post-process `***` (on its own line) into `⸻` (two-em dash, U+2E3B).

### Attempt 3: System prompt conflict

Even after fixing the library output, Slack still showed mangled formatting like `* ​The Crown Jewel​*`. Root cause: the agent's system prompt said "Use Slack formatting (`*bold*`)", so the agent was already outputting Slack-style `*bold*` (single asterisks). The library then treated `*text*` as markdown italic and mangled it.

**Fix:** Updated the system prompt to tell the agent to use standard markdown, since the conversion pipeline now handles the translation automatically.

## Final Implementation

### `markdownToMrkdwn()` in `packages/slack/src/formatting.ts`

Thin wrapper around `slackify-markdown` with post-processing:

```typescript
import { slackifyMarkdown } from "slackify-markdown";

export function markdownToMrkdwn(text: string): string {
  if (!text) return text;
  return (
    slackifyMarkdown(text)
      .replace(/\u200B/g, "")       // Strip zero-width spaces
      .replace(/^\*\*\*$/gm, "⸻")  // Replace *** horizontal rules
      .trimEnd()
  );
}
```

### Wiring: `reply()` in `packages/slack/src/slack-connector.ts`

```typescript
import { markdownToMrkdwn } from "./formatting.js";

const reply = async (content: string): Promise<void> => {
  await say({ text: markdownToMrkdwn(content) });
  this.messagesSent++;
};
```

This is the single integration point — all outbound agent messages flow through `reply()`.

### Agent system prompt

Changed from:
```
Use Slack formatting (bold with *text*, code with `backticks`)
```

To:
```
Use standard markdown formatting (your output is automatically converted to Slack format)
```

## Conversion Reference

What `slackify-markdown` handles (after our post-processing):

| Markdown | Slack mrkdwn | Notes |
|----------|-------------|-------|
| `**bold**` | `*bold*` | |
| `*italic*` | `_italic_` | |
| `_italic_` | `_italic_` | Same in both |
| `~~strike~~` | `~strike~` | |
| `[text](url)` | `<url\|text>` | |
| `![alt](url)` | `<url\|alt>` | Image → link |
| `# Header` | `*Header*` | All levels H1–H6 |
| `` `code` `` | `` `code` `` | Same in both |
| ` ```block``` ` | ` ```block``` ` | Same in both |
| `> quote` | `> quote` | Same in both |
| `* item` | `• item` | Bullet conversion |
| `1. item` | `1. item` | Preserved |
| `---` / `***` | `⸻` | Post-processed |
| `&` | `&amp;` | Slack expects HTML entities |

## Files Modified

| File | Change |
|------|--------|
| `packages/slack/src/formatting.ts` | Replaced regex conversion with slackify-markdown + post-processing |
| `packages/slack/src/slack-connector.ts` | Import and call `markdownToMrkdwn()` in `reply()` |
| `packages/slack/src/__tests__/formatting.test.ts` | Updated tests for library-based conversion |
| `packages/slack/src/__tests__/slack-connector.test.ts` | Added test verifying reply converts content |
| `packages/slack/package.json` | Added `slackify-markdown` dependency |
| `examples/slack-chat-bot/agents/assistant.yaml` | Updated system prompt to use standard markdown |

## Lessons Learned

1. **Don't hand-roll markdown parsers.** Regex-based markdown conversion breaks on real-world LLM output — edge cases with emojis, nested formatting, and list items with inline styles are hard to get right. Use an AST-based parser.

2. **Libraries need post-processing.** `slackify-markdown` is the best available option but still needs fixes for Slack compatibility (zero-width spaces, horizontal rules). Expect to wrap libraries, not just call them.

3. **System prompt and conversion pipeline must agree.** If the conversion expects standard markdown input, the agent must output standard markdown. Telling the agent to "use Slack formatting" then running a markdown→mrkdwn converter creates a double-conversion problem.

4. **Test with real agent output, not synthetic examples.** The regex approach passed all unit tests but failed on real responses because LLM output is messier than test fixtures (emojis between markers, inconsistent list styles, etc.).

## Out of Scope

- Message splitting logic (already works, runs before conversion)
- Tool output formatting (WEA-52)
- Discord markdown handling (Discord supports standard markdown natively)
- Slack Block Kit rendering (would enable richer formatting but is a larger effort)
