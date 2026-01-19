import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, realpath, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getJobOutputPath,
  appendJobOutput,
  appendJobOutputBatch,
  readJobOutput,
  readJobOutputAll,
  type JobOutputLogger,
} from "../job-output.js";
import {
  type JobOutputMessage,
  type JobOutputInput,
} from "../schemas/job-output.js";
import { StateFileError } from "../errors.js";

// Helper to create a temp directory
async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-output-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(baseDir, { recursive: true });
  // Resolve to real path to handle macOS /var -> /private/var symlink
  return await realpath(baseDir);
}

// Helper to create a mock logger
function createMockLogger(): JobOutputLogger & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    warn: (message: string) => warnings.push(message),
  };
}

// Helper to read raw JSONL file
async function readRawJsonl(filePath: string): Promise<string[]> {
  const content = await readFile(filePath, "utf-8");
  return content.split("\n").filter((line) => line.trim() !== "");
}

// Helper to write raw JSONL content
async function writeRawJsonl(
  filePath: string,
  lines: string[]
): Promise<void> {
  await writeFile(filePath, lines.join("\n") + "\n", "utf-8");
}

describe("getJobOutputPath", () => {
  it("returns correct path for job ID", () => {
    const path = getJobOutputPath("/path/to/jobs", "job-2024-01-15-abc123");
    expect(path).toBe("/path/to/jobs/job-2024-01-15-abc123.jsonl");
  });

  it("handles various job ID formats", () => {
    const path = getJobOutputPath("/jobs", "job-2025-12-31-xyz999");
    expect(path).toBe("/jobs/job-2025-12-31-xyz999.jsonl");
  });
});

describe("appendJobOutput", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates file and appends system message", async () => {
    const jobId = "job-2024-01-15-test01";

    await appendJobOutput(tempDir, jobId, {
      type: "system",
      content: "System initialized",
    });

    const outputPath = getJobOutputPath(tempDir, jobId);
    const lines = await readRawJsonl(outputPath);

    expect(lines).toHaveLength(1);
    const message = JSON.parse(lines[0]) as JobOutputMessage;
    expect(message.type).toBe("system");
    expect(message.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    if (message.type === "system") {
      expect(message.content).toBe("System initialized");
    }
  });

  it("appends assistant message with content", async () => {
    const jobId = "job-2024-01-15-test02";

    await appendJobOutput(tempDir, jobId, {
      type: "assistant",
      content: "Hello, world!",
      partial: false,
    });

    const messages = await readJobOutputAll(tempDir, jobId);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("assistant");
    if (messages[0].type === "assistant") {
      expect(messages[0].content).toBe("Hello, world!");
      expect(messages[0].partial).toBe(false);
    }
  });

  it("appends tool_use message with input", async () => {
    const jobId = "job-2024-01-15-test03";

    await appendJobOutput(tempDir, jobId, {
      type: "tool_use",
      tool_name: "read_file",
      tool_use_id: "tool-123",
      input: { path: "/etc/hosts" },
    });

    const messages = await readJobOutputAll(tempDir, jobId);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("tool_use");
    if (messages[0].type === "tool_use") {
      expect(messages[0].tool_name).toBe("read_file");
      expect(messages[0].tool_use_id).toBe("tool-123");
      expect(messages[0].input).toEqual({ path: "/etc/hosts" });
    }
  });

  it("appends tool_result message", async () => {
    const jobId = "job-2024-01-15-test04";

    await appendJobOutput(tempDir, jobId, {
      type: "tool_result",
      tool_use_id: "tool-123",
      result: "127.0.0.1 localhost",
      success: true,
    });

    const messages = await readJobOutputAll(tempDir, jobId);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("tool_result");
    if (messages[0].type === "tool_result") {
      expect(messages[0].tool_use_id).toBe("tool-123");
      expect(messages[0].result).toBe("127.0.0.1 localhost");
      expect(messages[0].success).toBe(true);
    }
  });

  it("appends error message", async () => {
    const jobId = "job-2024-01-15-test05";

    await appendJobOutput(tempDir, jobId, {
      type: "error",
      message: "Something went wrong",
      code: "ERR_TIMEOUT",
    });

    const messages = await readJobOutputAll(tempDir, jobId);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("error");
    if (messages[0].type === "error") {
      expect(messages[0].message).toBe("Something went wrong");
      expect(messages[0].code).toBe("ERR_TIMEOUT");
    }
  });

  it("appends multiple messages to same file", async () => {
    const jobId = "job-2024-01-15-test06";

    await appendJobOutput(tempDir, jobId, {
      type: "system",
      content: "Start",
    });
    await appendJobOutput(tempDir, jobId, {
      type: "assistant",
      content: "Processing...",
    });
    await appendJobOutput(tempDir, jobId, {
      type: "assistant",
      content: "Done!",
    });

    const messages = await readJobOutputAll(tempDir, jobId);
    expect(messages).toHaveLength(3);
    expect(messages[0].type).toBe("system");
    expect(messages[1].type).toBe("assistant");
    expect(messages[2].type).toBe("assistant");
  });

  it("adds timestamp automatically", async () => {
    const jobId = "job-2024-01-15-test07";
    const before = new Date();

    await appendJobOutput(tempDir, jobId, {
      type: "assistant",
      content: "Test",
    });

    const after = new Date();
    const messages = await readJobOutputAll(tempDir, jobId);

    const timestamp = new Date(messages[0].timestamp);
    expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it("throws StateFileError for invalid message type", async () => {
    const jobId = "job-2024-01-15-test08";

    await expect(
      appendJobOutput(tempDir, jobId, {
        type: "invalid" as "system",
        content: "Test",
      })
    ).rejects.toThrow(StateFileError);
  });

  it("throws StateFileError for message without type", async () => {
    const jobId = "job-2024-01-15-test09";

    await expect(
      appendJobOutput(tempDir, jobId, {} as JobOutputInput)
    ).rejects.toThrow(StateFileError);
  });

  it("throws StateFileError when directory does not exist", async () => {
    const nonExistentDir = join(tempDir, "does-not-exist");

    await expect(
      appendJobOutput(nonExistentDir, "job-2024-01-15-nodir1", {
        type: "system",
        content: "Test",
      })
    ).rejects.toThrow(StateFileError);
  });

  it("writes immediately without buffering", async () => {
    const jobId = "job-2024-01-15-test10";
    const outputPath = getJobOutputPath(tempDir, jobId);

    // Write first message
    await appendJobOutput(tempDir, jobId, {
      type: "assistant",
      content: "First",
    });

    // Read immediately - should be there
    const lines1 = await readRawJsonl(outputPath);
    expect(lines1).toHaveLength(1);

    // Write second message
    await appendJobOutput(tempDir, jobId, {
      type: "assistant",
      content: "Second",
    });

    // Read immediately - both should be there
    const lines2 = await readRawJsonl(outputPath);
    expect(lines2).toHaveLength(2);
  });
});

describe("appendJobOutputBatch", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("appends multiple messages at once", async () => {
    const jobId = "job-2024-01-15-batch1";

    await appendJobOutputBatch(tempDir, jobId, [
      { type: "tool_use", tool_name: "read_file", input: { path: "/tmp/test" } },
      { type: "tool_result", result: "file contents", success: true },
    ]);

    const messages = await readJobOutputAll(tempDir, jobId);
    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe("tool_use");
    expect(messages[1].type).toBe("tool_result");
  });

  it("applies same timestamp to all messages in batch", async () => {
    const jobId = "job-2024-01-15-batch2";

    await appendJobOutputBatch(tempDir, jobId, [
      { type: "assistant", content: "One" },
      { type: "assistant", content: "Two" },
      { type: "assistant", content: "Three" },
    ]);

    const messages = await readJobOutputAll(tempDir, jobId);
    expect(messages[0].timestamp).toBe(messages[1].timestamp);
    expect(messages[1].timestamp).toBe(messages[2].timestamp);
  });

  it("validates all messages before writing any", async () => {
    const jobId = "job-2024-01-15-batch3";

    await expect(
      appendJobOutputBatch(tempDir, jobId, [
        { type: "assistant", content: "Valid" },
        { type: "invalid" as "system" }, // Invalid
        { type: "assistant", content: "Also valid" },
      ])
    ).rejects.toThrow(StateFileError);

    // File should not exist since validation failed
    const messages = await readJobOutputAll(tempDir, jobId);
    expect(messages).toHaveLength(0);
  });

  it("handles empty array", async () => {
    const jobId = "job-2024-01-15-batch4";

    await appendJobOutputBatch(tempDir, jobId, []);

    const messages = await readJobOutputAll(tempDir, jobId);
    expect(messages).toHaveLength(0);
  });

  it("reports correct index for invalid message", async () => {
    const jobId = "job-2024-01-15-batch5";

    await expect(
      appendJobOutputBatch(tempDir, jobId, [
        { type: "assistant", content: "Valid" },
        { type: "assistant", content: "Also valid" },
        {} as JobOutputInput, // Invalid at index 2
      ])
    ).rejects.toThrow(/index 2/);
  });
});

describe("readJobOutput", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("yields nothing for non-existent file", async () => {
    const messages: JobOutputMessage[] = [];
    for await (const msg of readJobOutput(tempDir, "job-2024-01-15-nofile")) {
      messages.push(msg);
    }
    expect(messages).toHaveLength(0);
  });

  it("yields nothing for empty file", async () => {
    const jobId = "job-2024-01-15-empty1";
    const outputPath = getJobOutputPath(tempDir, jobId);
    await writeFile(outputPath, "", "utf-8");

    const messages: JobOutputMessage[] = [];
    for await (const msg of readJobOutput(tempDir, jobId)) {
      messages.push(msg);
    }
    expect(messages).toHaveLength(0);
  });

  it("yields messages in order", async () => {
    const jobId = "job-2024-01-15-order1";

    await appendJobOutput(tempDir, jobId, { type: "system", content: "First" });
    await appendJobOutput(tempDir, jobId, {
      type: "assistant",
      content: "Second",
    });
    await appendJobOutput(tempDir, jobId, {
      type: "assistant",
      content: "Third",
    });

    const messages: JobOutputMessage[] = [];
    for await (const msg of readJobOutput(tempDir, jobId)) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(3);
    if (messages[0].type === "system") {
      expect(messages[0].content).toBe("First");
    }
  });

  it("skips empty lines", async () => {
    const jobId = "job-2024-01-15-empty2";
    const outputPath = getJobOutputPath(tempDir, jobId);

    await writeRawJsonl(outputPath, [
      JSON.stringify({ type: "system", timestamp: "2024-01-15T10:00:00Z" }),
      "",
      "  ",
      JSON.stringify({
        type: "assistant",
        content: "Hi",
        timestamp: "2024-01-15T10:00:01Z",
      }),
    ]);

    const messages = await readJobOutputAll(tempDir, jobId);
    expect(messages).toHaveLength(2);
  });

  it("throws StateFileError for invalid JSON by default", async () => {
    const jobId = "job-2024-01-15-invalid1";
    const outputPath = getJobOutputPath(tempDir, jobId);

    await writeRawJsonl(outputPath, [
      JSON.stringify({ type: "system", timestamp: "2024-01-15T10:00:00Z" }),
      "not valid json",
      JSON.stringify({
        type: "assistant",
        content: "Hi",
        timestamp: "2024-01-15T10:00:01Z",
      }),
    ]);

    await expect(async () => {
      for await (const _msg of readJobOutput(tempDir, jobId)) {
        // consume
      }
    }).rejects.toThrow(StateFileError);
  });

  it("skips invalid JSON when skipInvalidLines is true", async () => {
    const logger = createMockLogger();
    const jobId = "job-2024-01-15-skip1";
    const outputPath = getJobOutputPath(tempDir, jobId);

    await writeRawJsonl(outputPath, [
      JSON.stringify({ type: "system", timestamp: "2024-01-15T10:00:00Z" }),
      "not valid json",
      JSON.stringify({
        type: "assistant",
        content: "Hi",
        timestamp: "2024-01-15T10:00:01Z",
      }),
    ]);

    const messages: JobOutputMessage[] = [];
    for await (const msg of readJobOutput(tempDir, jobId, {
      skipInvalidLines: true,
      logger,
    })) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(2);
    expect(logger.warnings.length).toBeGreaterThan(0);
  });

  it("throws StateFileError for invalid schema by default", async () => {
    const jobId = "job-2024-01-15-schema1";
    const outputPath = getJobOutputPath(tempDir, jobId);

    await writeRawJsonl(outputPath, [
      JSON.stringify({ type: "system", timestamp: "2024-01-15T10:00:00Z" }),
      JSON.stringify({ type: "invalid_type", timestamp: "2024-01-15T10:00:01Z" }),
    ]);

    await expect(async () => {
      for await (const _msg of readJobOutput(tempDir, jobId)) {
        // consume
      }
    }).rejects.toThrow(StateFileError);
  });

  it("skips invalid schema when skipInvalidLines is true", async () => {
    const logger = createMockLogger();
    const jobId = "job-2024-01-15-schema2";
    const outputPath = getJobOutputPath(tempDir, jobId);

    await writeRawJsonl(outputPath, [
      JSON.stringify({ type: "system", timestamp: "2024-01-15T10:00:00Z" }),
      JSON.stringify({ type: "invalid_type", timestamp: "2024-01-15T10:00:01Z" }),
      JSON.stringify({
        type: "assistant",
        content: "Valid",
        timestamp: "2024-01-15T10:00:02Z",
      }),
    ]);

    const messages: JobOutputMessage[] = [];
    for await (const msg of readJobOutput(tempDir, jobId, {
      skipInvalidLines: true,
      logger,
    })) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(2);
    expect(logger.warnings.length).toBeGreaterThan(0);
  });

  it("handles large files efficiently with streaming", async () => {
    const jobId = "job-2024-01-15-large1";

    // Write many messages
    const count = 1000;
    for (let i = 0; i < count; i++) {
      await appendJobOutput(tempDir, jobId, {
        type: "assistant",
        content: `Message ${i}`,
      });
    }

    // Read with streaming - should not load all into memory at once
    let readCount = 0;
    for await (const _msg of readJobOutput(tempDir, jobId)) {
      readCount++;
    }

    expect(readCount).toBe(count);
  });
});

describe("readJobOutputAll", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty array for non-existent file", async () => {
    const messages = await readJobOutputAll(tempDir, "job-2024-01-15-nope");
    expect(messages).toEqual([]);
  });

  it("returns all messages as array", async () => {
    const jobId = "job-2024-01-15-all01";

    await appendJobOutputBatch(tempDir, jobId, [
      { type: "system", content: "Init" },
      { type: "assistant", content: "Hello" },
      { type: "tool_use", tool_name: "bash", input: { command: "ls" } },
      { type: "tool_result", result: "file1\nfile2", success: true },
      { type: "assistant", content: "Done" },
    ]);

    const messages = await readJobOutputAll(tempDir, jobId);

    expect(messages).toHaveLength(5);
    expect(messages[0].type).toBe("system");
    expect(messages[1].type).toBe("assistant");
    expect(messages[2].type).toBe("tool_use");
    expect(messages[3].type).toBe("tool_result");
    expect(messages[4].type).toBe("assistant");
  });

  it("passes options to readJobOutput", async () => {
    const logger = createMockLogger();
    const jobId = "job-2024-01-15-opts1";
    const outputPath = getJobOutputPath(tempDir, jobId);

    await writeRawJsonl(outputPath, [
      JSON.stringify({ type: "system", timestamp: "2024-01-15T10:00:00Z" }),
      "invalid",
      JSON.stringify({
        type: "assistant",
        content: "Valid",
        timestamp: "2024-01-15T10:00:01Z",
      }),
    ]);

    const messages = await readJobOutputAll(tempDir, jobId, {
      skipInvalidLines: true,
      logger,
    });

    expect(messages).toHaveLength(2);
    expect(logger.warnings.length).toBeGreaterThan(0);
  });
});

describe("concurrent operations", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("handles concurrent appends to same file", async () => {
    const jobId = "job-2024-01-15-conc01";

    // Concurrent appends
    const appends = [];
    for (let i = 0; i < 50; i++) {
      appends.push(
        appendJobOutput(tempDir, jobId, {
          type: "assistant",
          content: `Message ${i}`,
        })
      );
    }

    await Promise.all(appends);

    const messages = await readJobOutputAll(tempDir, jobId);
    expect(messages).toHaveLength(50);
  });

  it("handles concurrent reads of same file", async () => {
    const jobId = "job-2024-01-15-conc02";

    // Write some messages
    await appendJobOutputBatch(tempDir, jobId, [
      { type: "system", content: "Init" },
      { type: "assistant", content: "Hello" },
      { type: "assistant", content: "World" },
    ]);

    // Concurrent reads
    const reads = [];
    for (let i = 0; i < 20; i++) {
      reads.push(readJobOutputAll(tempDir, jobId));
    }

    const results = await Promise.all(reads);

    for (const messages of results) {
      expect(messages).toHaveLength(3);
    }
  });

  it("handles concurrent read and write", async () => {
    const jobId = "job-2024-01-15-conc03";

    // Write initial messages
    await appendJobOutputBatch(tempDir, jobId, [
      { type: "system", content: "Init" },
    ]);

    // Concurrent read and write
    const writePromise = (async () => {
      for (let i = 0; i < 10; i++) {
        await appendJobOutput(tempDir, jobId, {
          type: "assistant",
          content: `New ${i}`,
        });
      }
    })();

    const readPromise = readJobOutputAll(tempDir, jobId, {
      skipInvalidLines: true,
    });

    await Promise.all([writePromise, readPromise]);

    // Final read should have all messages
    const finalMessages = await readJobOutputAll(tempDir, jobId);
    expect(finalMessages.length).toBeGreaterThanOrEqual(1);
    expect(finalMessages.length).toBeLessThanOrEqual(11);
  });
});

describe("SDK message type coverage", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("handles system message with subtype", async () => {
    const jobId = "job-2024-01-15-sdk01";

    await appendJobOutput(tempDir, jobId, {
      type: "system",
      content: "Session started",
      subtype: "session_start",
    });

    const messages = await readJobOutputAll(tempDir, jobId);
    expect(messages[0].type).toBe("system");
    if (messages[0].type === "system") {
      expect(messages[0].subtype).toBe("session_start");
    }
  });

  it("handles assistant message with usage info", async () => {
    const jobId = "job-2024-01-15-sdk02";

    await appendJobOutput(tempDir, jobId, {
      type: "assistant",
      content: "Response text",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
      },
    });

    const messages = await readJobOutputAll(tempDir, jobId);
    if (messages[0].type === "assistant") {
      expect(messages[0].usage?.input_tokens).toBe(100);
      expect(messages[0].usage?.output_tokens).toBe(50);
    }
  });

  it("handles tool_use with complex input", async () => {
    const jobId = "job-2024-01-15-sdk03";

    await appendJobOutput(tempDir, jobId, {
      type: "tool_use",
      tool_name: "edit_file",
      tool_use_id: "tool-456",
      input: {
        path: "/src/index.ts",
        changes: [
          { line: 10, action: "replace", content: "new content" },
          { line: 20, action: "delete" },
        ],
      },
    });

    const messages = await readJobOutputAll(tempDir, jobId);
    if (messages[0].type === "tool_use") {
      expect(messages[0].input).toEqual({
        path: "/src/index.ts",
        changes: [
          { line: 10, action: "replace", content: "new content" },
          { line: 20, action: "delete" },
        ],
      });
    }
  });

  it("handles tool_result with error", async () => {
    const jobId = "job-2024-01-15-sdk04";

    await appendJobOutput(tempDir, jobId, {
      type: "tool_result",
      tool_use_id: "tool-789",
      success: false,
      error: "File not found: /nonexistent",
    });

    const messages = await readJobOutputAll(tempDir, jobId);
    if (messages[0].type === "tool_result") {
      expect(messages[0].success).toBe(false);
      expect(messages[0].error).toBe("File not found: /nonexistent");
    }
  });

  it("handles error message with stack trace", async () => {
    const jobId = "job-2024-01-15-sdk05";

    await appendJobOutput(tempDir, jobId, {
      type: "error",
      message: "Unexpected error",
      code: "ERR_UNKNOWN",
      stack: "Error: Unexpected error\n  at foo.ts:10\n  at bar.ts:20",
    });

    const messages = await readJobOutputAll(tempDir, jobId);
    if (messages[0].type === "error") {
      expect(messages[0].message).toBe("Unexpected error");
      expect(messages[0].code).toBe("ERR_UNKNOWN");
      expect(messages[0].stack).toContain("at foo.ts:10");
    }
  });
});

describe("edge cases", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("handles message with special characters", async () => {
    const jobId = "job-2024-01-15-edge01";

    await appendJobOutput(tempDir, jobId, {
      type: "assistant",
      content: 'Content with "quotes", \\backslashes\\, and\nnewlines',
    });

    const messages = await readJobOutputAll(tempDir, jobId);
    if (messages[0].type === "assistant") {
      expect(messages[0].content).toBe(
        'Content with "quotes", \\backslashes\\, and\nnewlines'
      );
    }
  });

  it("handles message with unicode", async () => {
    const jobId = "job-2024-01-15-edge02";

    await appendJobOutput(tempDir, jobId, {
      type: "assistant",
      content: "Hello 世界! 🌍 Γεια σου κόσμε",
    });

    const messages = await readJobOutputAll(tempDir, jobId);
    if (messages[0].type === "assistant") {
      expect(messages[0].content).toBe("Hello 世界! 🌍 Γεια σου κόσμε");
    }
  });

  it("handles very long content", async () => {
    const jobId = "job-2024-01-15-edge03";
    const longContent = "x".repeat(100000);

    await appendJobOutput(tempDir, jobId, {
      type: "assistant",
      content: longContent,
    });

    const messages = await readJobOutputAll(tempDir, jobId);
    if (messages[0].type === "assistant") {
      expect(messages[0].content).toHaveLength(100000);
    }
  });

  it("handles null/undefined optional fields", async () => {
    const jobId = "job-2024-01-15-edge04";

    await appendJobOutput(tempDir, jobId, {
      type: "assistant",
      // No content, partial, or usage
    });

    const messages = await readJobOutputAll(tempDir, jobId);
    expect(messages[0].type).toBe("assistant");
  });
});
