#!/usr/bin/env node
/**
 * Docker SDK Wrapper
 *
 * This script runs inside Docker containers to execute the Claude Agent SDK.
 * It reads options from an environment variable and streams SDK messages to stdout as JSONL.
 *
 * Usage:
 *   HERDCTL_SDK_OPTIONS='{"prompt":"...","sdkOptions":{...}}' node docker-sdk-wrapper.js
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

async function main() {
  try {
    // Debug: Log environment
    console.error("[docker-sdk-wrapper] Starting wrapper...");
    console.error("[docker-sdk-wrapper] PATH:", process.env.PATH);
    console.error("[docker-sdk-wrapper] CWD:", process.cwd());
    console.error("[docker-sdk-wrapper] node version:", process.version);

    // Read options from environment variable
    const optionsJson = process.env.HERDCTL_SDK_OPTIONS;
    if (!optionsJson) {
      throw new Error("HERDCTL_SDK_OPTIONS environment variable not set");
    }

    console.error("[docker-sdk-wrapper] Options received");
    const options = JSON.parse(optionsJson);
    console.error("[docker-sdk-wrapper] Calling SDK query()...");

    // Execute SDK query
    const messages = query({
      prompt: options.prompt,
      options: options.sdkOptions,
    });

    console.error("[docker-sdk-wrapper] Streaming messages...");
    // Stream messages as JSONL to stdout (same format as CLI runtime)
    for await (const message of messages) {
      console.log(JSON.stringify(message));
    }

    console.error("[docker-sdk-wrapper] Completed successfully");
  } catch (error) {
    // Write error to stderr with full stack
    console.error("[docker-sdk-wrapper] Error:", error.message);
    console.error("[docker-sdk-wrapper] Stack:", error.stack);
    process.exit(1);
  }
}

main();
