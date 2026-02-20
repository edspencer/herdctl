#!/usr/bin/env node

// After-run hook: reads HookContext from stdin and appends a conversation
// entry to agents/engineer/conversations.md if the agent wrote metadata.

const fs = require("fs");
const path = require("path");

const CONVERSATIONS_FILE = path.resolve(
  __dirname,
  "..",
  "conversations.md"
);

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const ctx = JSON.parse(input);
    const meta = ctx.metadata || {};

    // Only log if the agent wrote conversation metadata
    if (!meta.conversation_title) {
      process.exit(0);
    }

    const date = new Date().toISOString().split("T")[0];
    const type = ctx.trigger || "chat";

    const entry = [
      "",
      `### ${meta.conversation_title}`,
      `**Date:** ${date} | **Type:** ${type}`,
      meta.conversation_summary || "No summary provided.",
      `**Outcome:** ${meta.conversation_outcome || "Not specified"}`,
      "",
    ].join("\n");

    fs.appendFileSync(CONVERSATIONS_FILE, entry);
  } catch {
    // Don't fail the hook on parse errors or missing fields
    process.exit(0);
  }
});
