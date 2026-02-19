import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve, join } from "node:path";

// Mock node:fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  realpath: vi.fn(),
}));

import { createFileSenderDef, type FileSenderContext } from "../file-sender-mcp.js";
import { readFile, realpath } from "node:fs/promises";

// =============================================================================
// Helpers
// =============================================================================

function createTestContext(overrides: Partial<FileSenderContext> = {}): FileSenderContext {
  return {
    workingDirectory: "/workspace",
    uploadFile: vi.fn().mockResolvedValue({ fileId: "F12345" }),
    ...overrides,
  };
}

/**
 * Extract the tool handler from the def's first tool.
 */
function getToolHandler(context: FileSenderContext) {
  const def = createFileSenderDef(context);
  return def.tools[0].handler;
}

// =============================================================================
// Tests
// =============================================================================

describe("createFileSenderDef", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a def with the correct server name", () => {
    const context = createTestContext();
    const def = createFileSenderDef(context);
    expect(def.name).toBe("herdctl-file-sender");
  });

  it("defines a single herdctl_send_file tool", () => {
    const context = createTestContext();
    const def = createFileSenderDef(context);

    expect(def.tools).toHaveLength(1);
    expect(def.tools[0].name).toBe("herdctl_send_file");
  });

  it("includes file_path as a required property in the input schema", () => {
    const context = createTestContext();
    const def = createFileSenderDef(context);
    const schema = def.tools[0].inputSchema;

    expect(schema.required).toContain("file_path");
    expect(schema.properties as Record<string, unknown>).toHaveProperty("file_path");
  });
});

describe("herdctl_send_file tool handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // By default, realpath acts as identity (no symlinks)
    vi.mocked(realpath).mockImplementation(async (p) => String(p));
  });

  it("uploads a file within the working directory", async () => {
    const context = createTestContext();
    const handler = getToolHandler(context);
    const mockBuffer = Buffer.from("test content");
    vi.mocked(readFile).mockResolvedValue(mockBuffer);

    const result = await handler({ file_path: "report.pdf" });

    expect(readFile).toHaveBeenCalledWith(resolve("/workspace", "report.pdf"));
    expect(context.uploadFile).toHaveBeenCalledWith({
      fileBuffer: mockBuffer,
      filename: "report.pdf",
      message: undefined,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("uploaded successfully");
    expect(result.content[0].text).toContain("F12345");
  });

  it("passes optional message to uploadFile", async () => {
    const context = createTestContext();
    const handler = getToolHandler(context);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("data"));

    await handler({
      file_path: "output.csv",
      message: "Here is the CSV export",
    });

    expect(context.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Here is the CSV export",
      }),
    );
  });

  it("uses filename override when provided", async () => {
    const context = createTestContext();
    const handler = getToolHandler(context);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("data"));

    await handler({
      file_path: "tmp/abc123.pdf",
      filename: "quarterly-report.pdf",
    });

    expect(context.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "quarterly-report.pdf",
      }),
    );
  });

  it("rejects paths that escape the working directory with ../", async () => {
    const context = createTestContext();
    const handler = getToolHandler(context);

    const result = await handler({
      file_path: "../../../etc/passwd",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("escapes working directory");
    expect(context.uploadFile).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("rejects absolute paths outside working directory", async () => {
    const context = createTestContext();
    const handler = getToolHandler(context);

    const result = await handler({
      file_path: "/etc/passwd",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("escapes working directory");
    expect(context.uploadFile).not.toHaveBeenCalled();
  });

  it("rejects symlinks that resolve outside the working directory", async () => {
    const context = createTestContext();
    const handler = getToolHandler(context);

    // Simulate a symlink: /workspace/link.txt -> /etc/passwd
    vi.mocked(realpath).mockImplementation(async (p) => {
      const s = String(p);
      if (s === resolve("/workspace", "link.txt")) return "/etc/passwd";
      return s;
    });

    const result = await handler({ file_path: "link.txt" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("escapes working directory");
    expect(context.uploadFile).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("allows absolute paths within the working directory", async () => {
    const context = createTestContext();
    const handler = getToolHandler(context);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("data"));

    const result = await handler({
      file_path: "/workspace/subdir/file.txt",
    });

    expect(result.isError).toBeUndefined();
    expect(context.uploadFile).toHaveBeenCalled();
  });

  it("allows nested relative paths within working directory", async () => {
    const context = createTestContext();
    const handler = getToolHandler(context);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("data"));

    const result = await handler({
      file_path: "subdir/deep/file.txt",
    });

    expect(result.isError).toBeUndefined();
    expect(readFile).toHaveBeenCalledWith(join("/workspace", "subdir/deep/file.txt"));
  });

  it("returns error when file does not exist (realpath ENOENT)", async () => {
    const context = createTestContext();
    const handler = getToolHandler(context);
    vi.mocked(realpath).mockRejectedValue(new Error("ENOENT: no such file or directory"));

    const result = await handler({ file_path: "nonexistent.pdf" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("file not found");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("returns error when upload fails", async () => {
    const uploadFile = vi.fn().mockRejectedValue(new Error("Slack API error: file_too_large"));
    const context = createTestContext({ uploadFile });
    const handler = getToolHandler(context);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("data"));

    const result = await handler({ file_path: "huge-file.zip" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("file_too_large");
  });
});
