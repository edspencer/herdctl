import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, rm, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  safeReadYaml,
  safeReadJsonl,
  readYaml,
  readJsonl,
  SafeReadError,
} from "../reads.js";
import { atomicWriteYaml, appendJsonl } from "../atomic.js";

// Helper to create a temp directory
async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-reads-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(baseDir, { recursive: true });
  // Resolve to real path to handle macOS /var -> /private/var symlink
  return await realpath(baseDir);
}

describe("SafeReadError", () => {
  it("creates error with correct properties", () => {
    const cause = new Error("Original error");
    const error = new SafeReadError(
      "Failed to read",
      "/path/to/file.yaml",
      cause
    );

    expect(error.name).toBe("SafeReadError");
    expect(error.message).toBe("Failed to read");
    expect(error.path).toBe("/path/to/file.yaml");
    expect(error.cause).toBe(cause);
  });

  it("extracts error code from cause", () => {
    const cause = new Error("File not found") as NodeJS.ErrnoException;
    cause.code = "ENOENT";
    const error = new SafeReadError("Failed to read", "/path/to/file.yaml", cause);

    expect(error.code).toBe("ENOENT");
  });

  it("creates error without cause", () => {
    const error = new SafeReadError("Failed to read", "/path/to/file.yaml");

    expect(error.cause).toBeUndefined();
    expect(error.code).toBeUndefined();
  });
});

describe("safeReadYaml", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reads and parses valid YAML file", async () => {
    const filePath = join(tempDir, "config.yaml");
    await writeFile(filePath, "name: test\nversion: 1\n", "utf-8");

    const result = await safeReadYaml<{ name: string; version: number }>(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "test", version: 1 });
    }
  });

  it("handles complex nested YAML structures", async () => {
    const filePath = join(tempDir, "complex.yaml");
    const yamlContent = `
fleet:
  name: my-fleet
  agents:
    - name: agent1
      model: claude-sonnet
    - name: agent2
      model: claude-opus
  settings:
    timeout: 30
    retries: 3
`;
    await writeFile(filePath, yamlContent, "utf-8");

    const result = await safeReadYaml(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        fleet: {
          name: "my-fleet",
          agents: [
            { name: "agent1", model: "claude-sonnet" },
            { name: "agent2", model: "claude-opus" },
          ],
          settings: { timeout: 30, retries: 3 },
        },
      });
    }
  });

  it("handles empty file by returning null", async () => {
    const filePath = join(tempDir, "empty.yaml");
    await writeFile(filePath, "", "utf-8");

    const result = await safeReadYaml(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it("handles file with only whitespace", async () => {
    const filePath = join(tempDir, "whitespace.yaml");
    await writeFile(filePath, "   \n  \n   ", "utf-8");

    const result = await safeReadYaml(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it("returns error for non-existent file", async () => {
    const filePath = join(tempDir, "nonexistent.yaml");

    const result = await safeReadYaml(filePath);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(SafeReadError);
      expect(result.error.code).toBe("ENOENT");
    }
  });

  it("returns error for invalid YAML syntax", async () => {
    const filePath = join(tempDir, "invalid.yaml");
    await writeFile(filePath, "key: [unclosed", "utf-8");

    const result = await safeReadYaml(filePath);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(SafeReadError);
    }
  });

  it("retries on transient parse errors", async () => {
    const filePath = join(tempDir, "retry.yaml");
    let readCount = 0;

    // Mock read function that returns truncated content on first read
    const mockReadFn = async () => {
      readCount++;
      if (readCount === 1) {
        return "key: [unclosed array"; // Truly invalid YAML - causes parse error
      }
      return "key: value\ncomplete: data\n";
    };

    const result = await safeReadYaml(filePath, {
      readFn: mockReadFn,
      baseDelayMs: 1,
    });

    expect(result.success).toBe(true);
    expect(readCount).toBe(2);
  });

  it("handles YAML arrays", async () => {
    const filePath = join(tempDir, "array.yaml");
    await writeFile(filePath, "- item1\n- item2\n- item3\n", "utf-8");

    const result = await safeReadYaml<string[]>(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(["item1", "item2", "item3"]);
    }
  });

  it("handles YAML with unicode characters", async () => {
    const filePath = join(tempDir, "unicode.yaml");
    await writeFile(filePath, "greeting: 你好世界\nemoji: 🚀\n", "utf-8");

    const result = await safeReadYaml<{ greeting: string; emoji: string }>(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ greeting: "你好世界", emoji: "🚀" });
    }
  });

  it("handles YAML with null values", async () => {
    const filePath = join(tempDir, "nullable.yaml");
    await writeFile(filePath, "present: value\nabsent: null\nempty: ~\n", "utf-8");

    const result = await safeReadYaml(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        present: "value",
        absent: null,
        empty: null,
      });
    }
  });

  it("respects maxRetries option", async () => {
    let readCount = 0;

    const mockReadFn = async () => {
      readCount++;
      // Use content that triggers a "transient" parse error
      return "key: [unclosed array"; // Invalid YAML with "unexpected" error
    };

    const result = await safeReadYaml("/fake/path.yaml", {
      readFn: mockReadFn,
      maxRetries: 5,
      baseDelayMs: 1,
    });

    expect(result.success).toBe(false);
    expect(readCount).toBe(6); // Initial + 5 retries
  });

  it("does not retry on ENOENT error", async () => {
    let readCount = 0;

    const mockReadFn = async () => {
      readCount++;
      const error = new Error("File not found") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    };

    const result = await safeReadYaml("/fake/path.yaml", {
      readFn: mockReadFn,
      maxRetries: 5,
      baseDelayMs: 1,
    });

    expect(result.success).toBe(false);
    expect(readCount).toBe(1); // No retries
  });

  it("does not retry on EACCES error", async () => {
    let readCount = 0;

    const mockReadFn = async () => {
      readCount++;
      const error = new Error("Permission denied") as NodeJS.ErrnoException;
      error.code = "EACCES";
      throw error;
    };

    const result = await safeReadYaml("/fake/path.yaml", {
      readFn: mockReadFn,
      maxRetries: 5,
      baseDelayMs: 1,
    });

    expect(result.success).toBe(false);
    expect(readCount).toBe(1); // No retries
  });
});

describe("safeReadJsonl", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reads and parses valid JSONL file", async () => {
    const filePath = join(tempDir, "events.jsonl");
    await writeFile(
      filePath,
      '{"id":1}\n{"id":2}\n{"id":3}\n',
      "utf-8"
    );

    const result = await safeReadJsonl<{ id: number }>(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
      expect(result.skippedLines).toBe(0);
    }
  });

  it("handles empty file", async () => {
    const filePath = join(tempDir, "empty.jsonl");
    await writeFile(filePath, "", "utf-8");

    const result = await safeReadJsonl(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
      expect(result.skippedLines).toBe(0);
    }
  });

  it("handles file with only whitespace", async () => {
    const filePath = join(tempDir, "whitespace.jsonl");
    await writeFile(filePath, "   \n  \n   ", "utf-8");

    const result = await safeReadJsonl(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it("handles incomplete last line by skipping it", async () => {
    const filePath = join(tempDir, "incomplete.jsonl");
    await writeFile(
      filePath,
      '{"id":1}\n{"id":2}\n{"id":3,"partial',
      "utf-8"
    );

    const result = await safeReadJsonl<{ id: number }>(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([{ id: 1 }, { id: 2 }]);
      expect(result.skippedLines).toBe(1);
    }
  });

  it("handles file ending with newline", async () => {
    const filePath = join(tempDir, "trailing.jsonl");
    await writeFile(
      filePath,
      '{"id":1}\n{"id":2}\n',
      "utf-8"
    );

    const result = await safeReadJsonl<{ id: number }>(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([{ id: 1 }, { id: 2 }]);
      expect(result.skippedLines).toBe(0);
    }
  });

  it("returns error for non-existent file", async () => {
    const filePath = join(tempDir, "nonexistent.jsonl");

    const result = await safeReadJsonl(filePath);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(SafeReadError);
      expect(result.error.code).toBe("ENOENT");
    }
  });

  it("fails on invalid middle line by default", async () => {
    const filePath = join(tempDir, "invalid-middle.jsonl");
    await writeFile(
      filePath,
      '{"id":1}\ninvalid json here\n{"id":3}\n',
      "utf-8"
    );

    const result = await safeReadJsonl(filePath);

    expect(result.success).toBe(false);
  });

  it("skips invalid lines when skipInvalidLines is true", async () => {
    const filePath = join(tempDir, "skip-invalid.jsonl");
    await writeFile(
      filePath,
      '{"id":1}\ninvalid json here\n{"id":3}\n',
      "utf-8"
    );

    const result = await safeReadJsonl<{ id: number }>(filePath, {
      skipInvalidLines: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([{ id: 1 }, { id: 3 }]);
      expect(result.skippedLines).toBe(1);
    }
  });

  it("handles complex JSON objects", async () => {
    const filePath = join(tempDir, "complex.jsonl");
    const obj1 = {
      type: "event",
      data: { nested: { value: 1 } },
      tags: ["a", "b"],
    };
    const obj2 = {
      type: "result",
      data: { output: "Hello\nWorld" },
      tags: [],
    };
    await writeFile(
      filePath,
      `${JSON.stringify(obj1)}\n${JSON.stringify(obj2)}\n`,
      "utf-8"
    );

    const result = await safeReadJsonl(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([obj1, obj2]);
    }
  });

  it("handles JSON with unicode characters", async () => {
    const filePath = join(tempDir, "unicode.jsonl");
    await writeFile(
      filePath,
      '{"text":"你好世界"}\n{"emoji":"🚀"}\n',
      "utf-8"
    );

    const result = await safeReadJsonl<{ text?: string; emoji?: string }>(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([{ text: "你好世界" }, { emoji: "🚀" }]);
    }
  });

  it("handles primitive JSON values", async () => {
    const filePath = join(tempDir, "primitives.jsonl");
    await writeFile(
      filePath,
      '"string"\n42\ntrue\nnull\n',
      "utf-8"
    );

    const result = await safeReadJsonl(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(["string", 42, true, null]);
    }
  });

  it("handles arrays as JSON lines", async () => {
    const filePath = join(tempDir, "arrays.jsonl");
    await writeFile(
      filePath,
      '[1,2,3]\n["a","b"]\n',
      "utf-8"
    );

    const result = await safeReadJsonl(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([[1, 2, 3], ["a", "b"]]);
    }
  });

  it("retries on transient read errors", async () => {
    let readCount = 0;

    const mockReadFn = async () => {
      readCount++;
      if (readCount === 1) {
        throw new Error("Temporary IO error");
      }
      return '{"id":1}\n{"id":2}\n';
    };

    const result = await safeReadJsonl("/fake/path.jsonl", {
      readFn: mockReadFn,
      baseDelayMs: 1,
    });

    expect(result.success).toBe(true);
    expect(readCount).toBe(2);
  });

  it("does not retry on ENOENT error", async () => {
    let readCount = 0;

    const mockReadFn = async () => {
      readCount++;
      const error = new Error("File not found") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    };

    const result = await safeReadJsonl("/fake/path.jsonl", {
      readFn: mockReadFn,
      maxRetries: 5,
      baseDelayMs: 1,
    });

    expect(result.success).toBe(false);
    expect(readCount).toBe(1); // No retries
  });

  it("handles large JSONL files", async () => {
    const filePath = join(tempDir, "large.jsonl");
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) {
      lines.push(JSON.stringify({ id: i, data: "x".repeat(100) }));
    }
    await writeFile(filePath, lines.join("\n") + "\n", "utf-8");

    const result = await safeReadJsonl<{ id: number; data: string }>(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1000);
      expect(result.data[0].id).toBe(0);
      expect(result.data[999].id).toBe(999);
    }
  });
});

describe("readYaml (throwing variant)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns parsed data on success", async () => {
    const filePath = join(tempDir, "config.yaml");
    await writeFile(filePath, "name: test\n", "utf-8");

    const data = await readYaml<{ name: string }>(filePath);

    expect(data).toEqual({ name: "test" });
  });

  it("throws SafeReadError on failure", async () => {
    const filePath = join(tempDir, "nonexistent.yaml");

    await expect(readYaml(filePath)).rejects.toThrow(SafeReadError);
  });
});

describe("readJsonl (throwing variant)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns parsed data on success", async () => {
    const filePath = join(tempDir, "events.jsonl");
    await writeFile(filePath, '{"id":1}\n{"id":2}\n', "utf-8");

    const data = await readJsonl<{ id: number }>(filePath);

    expect(data).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("throws SafeReadError on failure", async () => {
    const filePath = join(tempDir, "nonexistent.jsonl");

    await expect(readJsonl(filePath)).rejects.toThrow(SafeReadError);
  });
});

describe("concurrent read safety", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("handles concurrent reads of same YAML file", async () => {
    const filePath = join(tempDir, "concurrent.yaml");
    await atomicWriteYaml(filePath, { version: 1, data: "test" });

    // Start multiple reads concurrently
    const reads = [];
    for (let i = 0; i < 50; i++) {
      reads.push(safeReadYaml(filePath));
    }

    const results = await Promise.all(reads);

    // All reads should succeed
    for (const result of results) {
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ version: 1, data: "test" });
      }
    }
  });

  it("handles concurrent reads of same JSONL file", async () => {
    const filePath = join(tempDir, "concurrent.jsonl");
    for (let i = 0; i < 10; i++) {
      await appendJsonl(filePath, { id: i });
    }

    // Start multiple reads concurrently
    const reads = [];
    for (let i = 0; i < 50; i++) {
      reads.push(safeReadJsonl<{ id: number }>(filePath));
    }

    const results = await Promise.all(reads);

    // All reads should succeed with same data
    for (const result of results) {
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(10);
        const ids = result.data.map((d) => d.id).sort((a, b) => a - b);
        expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      }
    }
  });

  it("handles reads while JSONL file is being appended to", async () => {
    const filePath = join(tempDir, "append-while-read.jsonl");

    // Start with some initial data
    for (let i = 0; i < 5; i++) {
      await appendJsonl(filePath, { id: i });
    }

    // Start concurrent reads and writes
    const operations: Promise<unknown>[] = [];

    // 20 reads
    for (let i = 0; i < 20; i++) {
      operations.push(safeReadJsonl<{ id: number }>(filePath));
    }

    // 10 appends
    for (let i = 5; i < 15; i++) {
      operations.push(appendJsonl(filePath, { id: i }));
    }

    const results = await Promise.all(operations);

    // All read operations should succeed
    const readResults = results.slice(0, 20) as Awaited<
      ReturnType<typeof safeReadJsonl<{ id: number }>>
    >[];
    for (const result of readResults) {
      expect(result.success).toBe(true);
      if (result.success) {
        // Should have at least the initial 5 entries
        expect(result.data.length).toBeGreaterThanOrEqual(5);
        // All entries should be valid
        for (const entry of result.data) {
          expect(typeof entry.id).toBe("number");
        }
      }
    }

    // Final read should have all entries
    const finalResult = await safeReadJsonl<{ id: number }>(filePath);
    expect(finalResult.success).toBe(true);
    if (finalResult.success) {
      expect(finalResult.data).toHaveLength(15);
    }
  });

  it("handles reads during atomic YAML writes", async () => {
    const filePath = join(tempDir, "atomic-write-read.yaml");
    await atomicWriteYaml(filePath, { version: 0 });

    // Start concurrent reads and writes
    const operations: Promise<unknown>[] = [];

    // 30 reads
    for (let i = 0; i < 30; i++) {
      operations.push(safeReadYaml<{ version: number }>(filePath));
    }

    // 10 writes with different versions
    for (let i = 1; i <= 10; i++) {
      operations.push(atomicWriteYaml(filePath, { version: i }));
    }

    await Promise.all(operations);

    // All reads should succeed (may see different versions)
    const readResults = operations.slice(0, 30);
    for (const op of readResults) {
      const result = (await op) as Awaited<ReturnType<typeof safeReadYaml<{ version: number }>>>;
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data?.version).toBe("number");
      }
    }

    // Final state should be one of the written versions
    const finalResult = await safeReadYaml<{ version: number }>(filePath);
    expect(finalResult.success).toBe(true);
    if (finalResult.success) {
      expect(finalResult.data?.version).toBeGreaterThanOrEqual(0);
      expect(finalResult.data?.version).toBeLessThanOrEqual(10);
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

  it("YAML: handles file with only comments", async () => {
    const filePath = join(tempDir, "comments.yaml");
    await writeFile(filePath, "# This is a comment\n# Another comment\n", "utf-8");

    const result = await safeReadYaml(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it("YAML: returns error for multi-document YAML", async () => {
    const filePath = join(tempDir, "multi.yaml");
    await writeFile(
      filePath,
      "name: first\n---\nname: second\n",
      "utf-8"
    );

    const result = await safeReadYaml<{ name: string }>(filePath);

    // yaml library throws on multi-document YAML by default
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("multiple documents");
    }
  });

  it("JSONL: handles single line file without trailing newline", async () => {
    const filePath = join(tempDir, "single.jsonl");
    await writeFile(filePath, '{"id":1}', "utf-8");

    const result = await safeReadJsonl<{ id: number }>(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([{ id: 1 }]);
    }
  });

  it("JSONL: handles multiple empty lines between entries", async () => {
    const filePath = join(tempDir, "sparse.jsonl");
    await writeFile(filePath, '{"id":1}\n\n\n{"id":2}\n\n', "utf-8");

    const result = await safeReadJsonl<{ id: number }>(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([{ id: 1 }, { id: 2 }]);
    }
  });

  it("JSONL: handles lines with only whitespace", async () => {
    const filePath = join(tempDir, "whitespace-lines.jsonl");
    await writeFile(filePath, '{"id":1}\n   \n{"id":2}\n', "utf-8");

    const result = await safeReadJsonl<{ id: number }>(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([{ id: 1 }, { id: 2 }]);
    }
  });

  it("JSONL: handles very long JSON lines", async () => {
    const filePath = join(tempDir, "long-line.jsonl");
    const longString = "x".repeat(100000);
    await writeFile(
      filePath,
      `${JSON.stringify({ data: longString })}\n`,
      "utf-8"
    );

    const result = await safeReadJsonl<{ data: string }>(filePath);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].data).toBe(longString);
    }
  });
});
