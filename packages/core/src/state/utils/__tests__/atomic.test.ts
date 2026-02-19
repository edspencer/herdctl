import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  AtomicWriteError,
  appendJsonl,
  atomicWriteFile,
  atomicWriteJson,
  atomicWriteYaml,
  generateTempPath,
  renameWithRetry,
} from "../atomic.js";

// Helper to create a temp directory
async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-atomic-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(baseDir, { recursive: true });
  // Resolve to real path to handle macOS /var -> /private/var symlink
  return await realpath(baseDir);
}

describe("generateTempPath", () => {
  it("generates temp path in the same directory as target", () => {
    const targetPath = "/some/dir/file.yaml";
    const tempPath = generateTempPath(targetPath);

    expect(dirname(tempPath)).toBe("/some/dir");
  });

  it("uses .<filename>.tmp.<random> pattern", () => {
    const targetPath = "/some/dir/state.yaml";
    const tempPath = generateTempPath(targetPath);
    const tempFilename = basename(tempPath);

    expect(tempFilename).toMatch(/^\.state\.yaml\.tmp\.[a-f0-9]{16}$/);
  });

  it("generates unique temp paths on each call", () => {
    const targetPath = "/some/dir/file.yaml";
    const tempPath1 = generateTempPath(targetPath);
    const tempPath2 = generateTempPath(targetPath);

    expect(tempPath1).not.toBe(tempPath2);
  });

  it("handles filenames with multiple dots", () => {
    const targetPath = "/some/dir/file.backup.yaml";
    const tempPath = generateTempPath(targetPath);
    const tempFilename = basename(tempPath);

    expect(tempFilename).toMatch(/^\.file\.backup\.yaml\.tmp\.[a-f0-9]{16}$/);
  });

  it("handles filenames without extensions", () => {
    const targetPath = "/some/dir/Makefile";
    const tempPath = generateTempPath(targetPath);
    const tempFilename = basename(tempPath);

    expect(tempFilename).toMatch(/^\.Makefile\.tmp\.[a-f0-9]{16}$/);
  });
});

describe("AtomicWriteError", () => {
  it("creates error with correct properties", () => {
    const cause = new Error("Original error");
    const error = new AtomicWriteError(
      "Failed to write",
      "/path/to/file.yaml",
      "/path/to/.file.yaml.tmp.abc123",
      cause,
    );

    expect(error.name).toBe("AtomicWriteError");
    expect(error.message).toBe("Failed to write");
    expect(error.path).toBe("/path/to/file.yaml");
    expect(error.tempPath).toBe("/path/to/.file.yaml.tmp.abc123");
    expect(error.cause).toBe(cause);
  });

  it("creates error without temp path", () => {
    const error = new AtomicWriteError("Failed to write", "/path/to/file.yaml");

    expect(error.tempPath).toBeUndefined();
    expect(error.cause).toBeUndefined();
  });
});

describe("atomicWriteFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes content to a new file", async () => {
    const filePath = join(tempDir, "test.txt");
    const content = "Hello, World!";

    await atomicWriteFile(filePath, content);

    const result = await readFile(filePath, "utf-8");
    expect(result).toBe(content);
  });

  it("overwrites existing file content", async () => {
    const filePath = join(tempDir, "test.txt");
    await writeFile(filePath, "old content", "utf-8");

    await atomicWriteFile(filePath, "new content");

    const result = await readFile(filePath, "utf-8");
    expect(result).toBe("new content");
  });

  it("cleans up temp file on successful write", async () => {
    const filePath = join(tempDir, "test.txt");
    await atomicWriteFile(filePath, "content");

    // List all files in temp dir
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(tempDir);

    // Should only have the target file, no temp files
    expect(files).toEqual(["test.txt"]);
  });

  it("writes with specified encoding", async () => {
    const filePath = join(tempDir, "test.txt");
    const content = "Unicode: \u4e2d\u6587";

    await atomicWriteFile(filePath, content, "utf-8");

    const result = await readFile(filePath, "utf-8");
    expect(result).toBe(content);
  });

  it("throws AtomicWriteError when directory does not exist", async () => {
    const filePath = join(tempDir, "nonexistent", "test.txt");

    await expect(atomicWriteFile(filePath, "content")).rejects.toThrow(AtomicWriteError);
  });

  it("preserves original file on write failure", async () => {
    const filePath = join(tempDir, "test.txt");
    const originalContent = "original content";
    await writeFile(filePath, originalContent, "utf-8");

    // Try to write to a location that will fail
    const badPath = join(tempDir, "nonexistent", "test.txt");
    await expect(atomicWriteFile(badPath, "new content")).rejects.toThrow();

    // Original file should be unchanged
    const result = await readFile(filePath, "utf-8");
    expect(result).toBe(originalContent);
  });

  it("cleans up temp file on failure when directory does not exist", async () => {
    // Try to write to a path where the directory doesn't exist
    // This will fail at the writeFile stage, and we verify no temp files are left
    const badPath = join(tempDir, "nonexistent", "subdir", "test.txt");

    await expect(atomicWriteFile(badPath, "content")).rejects.toThrow(AtomicWriteError);

    // The temp file would be in the nonexistent directory, so there's nothing to clean up
    // This tests that the error is properly thrown and the function handles the case
    // where the temp file couldn't even be created
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(tempDir);
    // Should be empty - no orphaned temp files in the parent
    expect(files.filter((f) => f.includes(".tmp."))).toHaveLength(0);
  });

  it("handles large file content", async () => {
    const filePath = join(tempDir, "large.txt");
    // Create 1MB of content
    const content = "x".repeat(1024 * 1024);

    await atomicWriteFile(filePath, content);

    const result = await readFile(filePath, "utf-8");
    expect(result.length).toBe(content.length);
  });

  it("handles empty content", async () => {
    const filePath = join(tempDir, "empty.txt");

    await atomicWriteFile(filePath, "");

    const result = await readFile(filePath, "utf-8");
    expect(result).toBe("");
  });

  it("handles content with newlines", async () => {
    const filePath = join(tempDir, "multiline.txt");
    const content = "line1\nline2\nline3\n";

    await atomicWriteFile(filePath, content);

    const result = await readFile(filePath, "utf-8");
    expect(result).toBe(content);
  });
});

describe("atomicWriteYaml", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes object as YAML", async () => {
    const filePath = join(tempDir, "config.yaml");
    const data = {
      version: 1,
      fleet: { name: "test-fleet" },
    };

    await atomicWriteYaml(filePath, data);

    const content = await readFile(filePath, "utf-8");
    const parsed = parseYaml(content);
    expect(parsed).toEqual(data);
  });

  it("writes array as YAML", async () => {
    const filePath = join(tempDir, "list.yaml");
    const data = ["item1", "item2", "item3"];

    await atomicWriteYaml(filePath, data);

    const content = await readFile(filePath, "utf-8");
    const parsed = parseYaml(content);
    expect(parsed).toEqual(data);
  });

  it("respects custom indent option", async () => {
    const filePath = join(tempDir, "config.yaml");
    const data = { nested: { value: 1 } };

    await atomicWriteYaml(filePath, data, { indent: 4 });

    const content = await readFile(filePath, "utf-8");
    // With indent 4, nested keys should be indented by 4 spaces
    expect(content).toContain("    value:");
  });

  it("handles complex nested structures", async () => {
    const filePath = join(tempDir, "complex.yaml");
    const data = {
      version: 1,
      agents: [
        {
          name: "agent1",
          config: {
            model: "claude-sonnet",
            permissions: ["read", "write"],
          },
        },
        {
          name: "agent2",
          config: {
            model: "claude-opus",
            permissions: ["read"],
          },
        },
      ],
      metadata: {
        created: "2024-01-01",
        tags: ["production", "test"],
      },
    };

    await atomicWriteYaml(filePath, data);

    const content = await readFile(filePath, "utf-8");
    const parsed = parseYaml(content);
    expect(parsed).toEqual(data);
  });

  it("handles null and undefined values", async () => {
    const filePath = join(tempDir, "nullable.yaml");
    const data = {
      present: "value",
      absent: null,
    };

    await atomicWriteYaml(filePath, data);

    const content = await readFile(filePath, "utf-8");
    const parsed = parseYaml(content);
    expect(parsed.present).toBe("value");
    expect(parsed.absent).toBeNull();
  });

  it("throws AtomicWriteError on failure", async () => {
    const filePath = join(tempDir, "nonexistent", "config.yaml");

    await expect(atomicWriteYaml(filePath, { key: "value" })).rejects.toThrow(AtomicWriteError);
  });
});

describe("atomicWriteJson", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes object as JSON with trailing newline", async () => {
    const filePath = join(tempDir, "data.json");
    const data = { key: "value", number: 42 };

    await atomicWriteJson(filePath, data);

    const content = await readFile(filePath, "utf-8");
    expect(content.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(content);
    expect(parsed).toEqual(data);
  });

  it("uses default indentation of 2 spaces", async () => {
    const filePath = join(tempDir, "data.json");
    const data = { nested: { value: 1 } };

    await atomicWriteJson(filePath, data);

    const content = await readFile(filePath, "utf-8");
    expect(content).toContain('  "nested":');
    expect(content).toContain('    "value":');
  });

  it("respects custom indent option", async () => {
    const filePath = join(tempDir, "data.json");
    const data = { nested: { value: 1 } };

    await atomicWriteJson(filePath, data, { indent: 4 });

    const content = await readFile(filePath, "utf-8");
    expect(content).toContain('    "nested":');
    expect(content).toContain('        "value":');
  });

  it("handles arrays", async () => {
    const filePath = join(tempDir, "array.json");
    const data = [1, 2, 3, { key: "value" }];

    await atomicWriteJson(filePath, data);

    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed).toEqual(data);
  });

  it("throws AtomicWriteError on failure", async () => {
    const filePath = join(tempDir, "nonexistent", "data.json");

    await expect(atomicWriteJson(filePath, { key: "value" })).rejects.toThrow(AtomicWriteError);
  });
});

describe("appendJsonl", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("appends single JSON object as line", async () => {
    const filePath = join(tempDir, "log.jsonl");
    const data = { event: "test", timestamp: "2024-01-01" };

    await appendJsonl(filePath, data);

    const content = await readFile(filePath, "utf-8");
    expect(content).toBe('{"event":"test","timestamp":"2024-01-01"}\n');
  });

  it("appends multiple objects as separate lines", async () => {
    const filePath = join(tempDir, "log.jsonl");

    await appendJsonl(filePath, { id: 1 });
    await appendJsonl(filePath, { id: 2 });
    await appendJsonl(filePath, { id: 3 });

    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toEqual({ id: 1 });
    expect(JSON.parse(lines[1])).toEqual({ id: 2 });
    expect(JSON.parse(lines[2])).toEqual({ id: 3 });
  });

  it("creates file if it does not exist", async () => {
    const filePath = join(tempDir, "new.jsonl");

    await appendJsonl(filePath, { event: "created" });

    const exists = await stat(filePath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it("appends to existing file", async () => {
    const filePath = join(tempDir, "existing.jsonl");
    await writeFile(filePath, '{"id":1}\n', "utf-8");

    await appendJsonl(filePath, { id: 2 });

    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ id: 1 });
    expect(JSON.parse(lines[1])).toEqual({ id: 2 });
  });

  it("handles complex objects", async () => {
    const filePath = join(tempDir, "complex.jsonl");
    const data = {
      type: "tool_result",
      content: { output: "Hello\nWorld", exitCode: 0 },
      metadata: { tags: ["test", "prod"] },
    };

    await appendJsonl(filePath, data);

    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed).toEqual(data);
  });

  it("throws AtomicWriteError when directory does not exist", async () => {
    const filePath = join(tempDir, "nonexistent", "log.jsonl");

    await expect(appendJsonl(filePath, { event: "test" })).rejects.toThrow(AtomicWriteError);
  });

  it("handles arrays as JSON lines", async () => {
    const filePath = join(tempDir, "arrays.jsonl");

    await appendJsonl(filePath, [1, 2, 3]);
    await appendJsonl(filePath, ["a", "b"]);

    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");
    expect(JSON.parse(lines[0])).toEqual([1, 2, 3]);
    expect(JSON.parse(lines[1])).toEqual(["a", "b"]);
  });

  it("handles primitive values", async () => {
    const filePath = join(tempDir, "primitives.jsonl");

    await appendJsonl(filePath, "string");
    await appendJsonl(filePath, 42);
    await appendJsonl(filePath, true);
    await appendJsonl(filePath, null);

    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");
    expect(JSON.parse(lines[0])).toBe("string");
    expect(JSON.parse(lines[1])).toBe(42);
    expect(JSON.parse(lines[2])).toBe(true);
    expect(JSON.parse(lines[3])).toBeNull();
  });
});

describe("renameWithRetry", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("succeeds on first try when rename succeeds", async () => {
    const oldPath = join(tempDir, "old.txt");
    const newPath = join(tempDir, "new.txt");
    await writeFile(oldPath, "content", "utf-8");

    await renameWithRetry(oldPath, newPath);

    const content = await readFile(newPath, "utf-8");
    expect(content).toBe("content");
  });

  it("retries on EACCES error", async () => {
    const oldPath = join(tempDir, "old.txt");
    const newPath = join(tempDir, "new.txt");

    let attempts = 0;
    const mockRename = async () => {
      attempts++;
      if (attempts < 3) {
        const err = new Error("Access denied") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      }
      // Success on third attempt
    };

    await renameWithRetry(oldPath, newPath, {
      renameFn: mockRename,
      baseDelayMs: 1, // Fast delays for testing
    });

    expect(attempts).toBe(3);
  });

  it("retries on EPERM error", async () => {
    const oldPath = join(tempDir, "old.txt");
    const newPath = join(tempDir, "new.txt");

    let attempts = 0;
    const mockRename = async () => {
      attempts++;
      if (attempts < 2) {
        const err = new Error("Permission denied") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }
    };

    await renameWithRetry(oldPath, newPath, {
      renameFn: mockRename,
      baseDelayMs: 1,
    });

    expect(attempts).toBe(2);
  });

  it("throws immediately on non-retryable error", async () => {
    const oldPath = join(tempDir, "old.txt");
    const newPath = join(tempDir, "new.txt");

    let attempts = 0;
    const mockRename = async () => {
      attempts++;
      const err = new Error("No such file") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    };

    await expect(renameWithRetry(oldPath, newPath, { renameFn: mockRename })).rejects.toThrow(
      "No such file",
    );

    expect(attempts).toBe(1);
  });

  it("throws after max retries exhausted", async () => {
    const oldPath = join(tempDir, "old.txt");
    const newPath = join(tempDir, "new.txt");

    let attempts = 0;
    const mockRename = async () => {
      attempts++;
      const err = new Error("Access denied") as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    };

    await expect(
      renameWithRetry(oldPath, newPath, {
        renameFn: mockRename,
        maxRetries: 2,
        baseDelayMs: 1,
      }),
    ).rejects.toThrow("Access denied");

    // Initial attempt + 2 retries = 3 total attempts
    expect(attempts).toBe(3);
  });

  it("uses exponential backoff for delays", async () => {
    const oldPath = join(tempDir, "old.txt");
    const newPath = join(tempDir, "new.txt");

    const delays: number[] = [];
    let lastTime = Date.now();
    let attempts = 0;

    const mockRename = async () => {
      const now = Date.now();
      if (attempts > 0) {
        delays.push(now - lastTime);
      }
      lastTime = now;
      attempts++;

      if (attempts <= 3) {
        const err = new Error("Access denied") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      }
    };

    await renameWithRetry(oldPath, newPath, {
      renameFn: mockRename,
      maxRetries: 3,
      baseDelayMs: 10,
    });

    // With baseDelayMs=10: delays should be ~10, ~20, ~40
    // Allow some tolerance for timing
    expect(delays[0]).toBeGreaterThanOrEqual(8);
    expect(delays[1]).toBeGreaterThanOrEqual(15);
    expect(delays[2]).toBeGreaterThanOrEqual(30);
  });

  it("respects custom maxRetries", async () => {
    const oldPath = join(tempDir, "old.txt");
    const newPath = join(tempDir, "new.txt");

    let attempts = 0;
    const mockRename = async () => {
      attempts++;
      const err = new Error("Access denied") as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    };

    await expect(
      renameWithRetry(oldPath, newPath, {
        renameFn: mockRename,
        maxRetries: 5,
        baseDelayMs: 1,
      }),
    ).rejects.toThrow();

    // Initial attempt + 5 retries = 6 total attempts
    expect(attempts).toBe(6);
  });
});

describe("concurrent write safety", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("handles concurrent atomic writes to same file (last write wins)", async () => {
    const filePath = join(tempDir, "concurrent.yaml");

    // Start multiple writes concurrently
    const writes = [];
    for (let i = 0; i < 10; i++) {
      writes.push(atomicWriteYaml(filePath, { version: i }));
    }

    // Wait for all writes to complete
    await Promise.all(writes);

    // File should exist and be valid YAML (one of the versions)
    const content = await readFile(filePath, "utf-8");
    const parsed = parseYaml(content);
    expect(typeof parsed.version).toBe("number");
    expect(parsed.version).toBeGreaterThanOrEqual(0);
    expect(parsed.version).toBeLessThan(10);
  });

  it("handles concurrent JSONL appends", async () => {
    const filePath = join(tempDir, "concurrent.jsonl");

    // Start multiple appends concurrently
    const appends = [];
    for (let i = 0; i < 100; i++) {
      appends.push(appendJsonl(filePath, { id: i }));
    }

    // Wait for all appends to complete
    await Promise.all(appends);

    // All entries should be valid JSON lines
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");

    // Should have all 100 entries
    expect(lines).toHaveLength(100);

    // All lines should be valid JSON
    const ids = lines.map((line) => JSON.parse(line).id).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });
});
