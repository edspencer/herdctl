/**
 * Tests for Discord file attachment support
 *
 * Tests attachment categorization, MIME pattern matching, and the
 * processAttachments / cleanupAttachments pipeline.
 */

import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DiscordAttachmentsSchema } from "@herdctl/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordConnector } from "../discord-connector.js";
import { DiscordManager } from "../manager.js";
import type { DiscordAttachmentInfo } from "../types.js";

// =============================================================================
// Mock discord.js (required because DiscordConnector imports it at module level)
// =============================================================================

vi.mock("discord.js", () => {
  const { EventEmitter } = require("node:events");

  class MockClient extends EventEmitter {
    user = { id: "bot123", username: "TestBot", discriminator: "0001", setActivity: vi.fn() };
    rest = new EventEmitter();
    login = vi.fn().mockResolvedValue("token");
    destroy = vi.fn();
  }

  return {
    Client: MockClient,
    GatewayIntentBits: { Guilds: 1, GuildMessages: 2, DirectMessages: 4, MessageContent: 8 },
    Partials: { Channel: 0, Message: 1 },
    Events: { ClientReady: "ready", MessageCreate: "messageCreate" },
    MessageFlags: { IsVoiceMessage: 1 << 13 },
    AttachmentBuilder: vi.fn(),
  };
});

vi.mock("@discordjs/rest", () => ({
  RESTEvents: { RateLimited: "rateLimited" },
}));

// =============================================================================
// Access private static methods for unit testing
// =============================================================================

// biome-ignore lint/suspicious/noExplicitAny: accessing private statics for testing
const ConnectorAny = DiscordConnector as any;
// biome-ignore lint/suspicious/noExplicitAny: accessing private statics for testing
const ManagerAny = DiscordManager as any;

// =============================================================================
// Schema Tests
// =============================================================================

describe("DiscordAttachmentsSchema", () => {
  it("uses correct defaults when no fields are provided", () => {
    const result = DiscordAttachmentsSchema.parse({});
    expect(result).toEqual({
      enabled: false,
      max_file_size_mb: 10,
      max_files_per_message: 5,
      allowed_types: ["image/*", "application/pdf", "text/*"],
      download_dir: ".discord-attachments",
      cleanup_after_processing: true,
    });
  });

  it("accepts full custom configuration", () => {
    const result = DiscordAttachmentsSchema.parse({
      enabled: true,
      max_file_size_mb: 25,
      max_files_per_message: 3,
      allowed_types: ["image/png", "text/plain"],
      download_dir: "my-downloads",
      cleanup_after_processing: false,
    });
    expect(result.enabled).toBe(true);
    expect(result.max_file_size_mb).toBe(25);
    expect(result.max_files_per_message).toBe(3);
    expect(result.allowed_types).toEqual(["image/png", "text/plain"]);
    expect(result.download_dir).toBe("my-downloads");
    expect(result.cleanup_after_processing).toBe(false);
  });

  it("rejects negative max_file_size_mb", () => {
    expect(() => DiscordAttachmentsSchema.parse({ max_file_size_mb: -1 })).toThrow();
  });

  it("rejects zero max_files_per_message", () => {
    expect(() => DiscordAttachmentsSchema.parse({ max_files_per_message: 0 })).toThrow();
  });
});

// =============================================================================
// Categorize Content Type Tests
// =============================================================================

describe("_categorizeContentType", () => {
  const categorize = ConnectorAny._categorizeContentType;

  it("categorizes image/* as image", () => {
    expect(categorize("image/png")).toBe("image");
    expect(categorize("image/jpeg")).toBe("image");
    expect(categorize("image/gif")).toBe("image");
    expect(categorize("image/webp")).toBe("image");
  });

  it("categorizes application/pdf as pdf", () => {
    expect(categorize("application/pdf")).toBe("pdf");
  });

  it("categorizes text/* as text", () => {
    expect(categorize("text/plain")).toBe("text");
    expect(categorize("text/html")).toBe("text");
    expect(categorize("text/csv")).toBe("text");
    expect(categorize("text/yaml")).toBe("text");
  });

  it("categorizes common code MIME types as text", () => {
    expect(categorize("application/json")).toBe("text");
    expect(categorize("application/javascript")).toBe("text");
    expect(categorize("application/typescript")).toBe("text");
    expect(categorize("application/x-yaml")).toBe("text");
    expect(categorize("application/x-sh")).toBe("text");
    expect(categorize("application/xml")).toBe("text");
  });

  it("returns unsupported for unknown types", () => {
    expect(categorize("application/octet-stream")).toBe("unsupported");
    expect(categorize("application/zip")).toBe("unsupported");
    expect(categorize("video/mp4")).toBe("unsupported");
    expect(categorize("audio/mpeg")).toBe("unsupported");
  });

  it("handles content types with charset parameters", () => {
    expect(categorize("text/plain; charset=utf-8")).toBe("text");
    expect(categorize("application/json; charset=utf-8")).toBe("text");
  });

  it("is case-insensitive", () => {
    expect(categorize("Image/PNG")).toBe("image");
    expect(categorize("APPLICATION/PDF")).toBe("pdf");
    expect(categorize("Text/Plain")).toBe("text");
  });
});

// =============================================================================
// MIME Pattern Matching Tests
// =============================================================================

describe("matchesMimePattern", () => {
  const matches = ManagerAny.matchesMimePattern;

  it("matches exact MIME types", () => {
    expect(matches("image/png", "image/png")).toBe(true);
    expect(matches("text/plain", "text/plain")).toBe(true);
    expect(matches("application/pdf", "application/pdf")).toBe(true);
  });

  it("matches wildcard patterns", () => {
    expect(matches("image/png", "image/*")).toBe(true);
    expect(matches("image/jpeg", "image/*")).toBe(true);
    expect(matches("text/plain", "text/*")).toBe(true);
    expect(matches("text/html", "text/*")).toBe(true);
  });

  it("does not match different types", () => {
    expect(matches("text/plain", "image/*")).toBe(false);
    expect(matches("image/png", "text/*")).toBe(false);
    expect(matches("application/pdf", "image/*")).toBe(false);
  });

  it("handles content types with parameters", () => {
    expect(matches("text/plain; charset=utf-8", "text/*")).toBe(true);
    expect(matches("text/plain; charset=utf-8", "text/plain")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matches("Image/PNG", "image/*")).toBe(true);
    expect(matches("image/png", "Image/*")).toBe(true);
  });
});

// =============================================================================
// processAttachments Tests
// =============================================================================

describe("processAttachments", () => {
  const processAttachments = ManagerAny.processAttachments.bind(ManagerAny);

  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  let testDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    testDir = join(tmpdir(), `herdctl-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(testDir, { recursive: true, force: true });
  });

  const defaultConfig = DiscordAttachmentsSchema.parse({ enabled: true });

  function makeAttachment(overrides: Partial<DiscordAttachmentInfo> = {}): DiscordAttachmentInfo {
    return {
      id: "att_1",
      name: "test.txt",
      url: "https://cdn.discordapp.com/attachments/test.txt",
      contentType: "text/plain",
      size: 100,
      category: "text",
      ...overrides,
    };
  }

  it("skips attachments not in allowed_types", async () => {
    const config = DiscordAttachmentsSchema.parse({
      enabled: true,
      allowed_types: ["image/*"],
    });
    const attachment = makeAttachment({ contentType: "text/plain", category: "text" });

    const result = await processAttachments([attachment], config, testDir, mockLogger);

    expect(result.promptSections).toHaveLength(0);
    expect(result.skippedFiles).toHaveLength(1);
    expect(result.skippedFiles[0].reason).toContain("not in allowed_types");
  });

  it("skips attachments exceeding size limit", async () => {
    const config = DiscordAttachmentsSchema.parse({
      enabled: true,
      max_file_size_mb: 1,
    });
    const attachment = makeAttachment({
      size: 2 * 1024 * 1024, // 2MB
    });

    const result = await processAttachments([attachment], config, testDir, mockLogger);

    expect(result.promptSections).toHaveLength(0);
    expect(result.skippedFiles).toHaveLength(1);
    expect(result.skippedFiles[0].reason).toContain("exceeds");
  });

  it("limits files to max_files_per_message", async () => {
    const config = DiscordAttachmentsSchema.parse({
      enabled: true,
      max_files_per_message: 2,
    });
    const attachments = [
      makeAttachment({ id: "1", name: "a.txt" }),
      makeAttachment({ id: "2", name: "b.txt" }),
      makeAttachment({ id: "3", name: "c.txt" }),
    ];

    // Mock fetch for text attachments
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "content",
      }),
    );

    const result = await processAttachments(attachments, config, testDir, mockLogger);

    // Only first 2 should be processed, 3rd should be skipped
    expect(result.skippedFiles).toContainEqual(
      expect.objectContaining({ name: "c.txt", reason: "exceeded max_files_per_message" }),
    );

    vi.unstubAllGlobals();
  });

  it("inlines text file content into prompt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "hello world",
      }),
    );

    const attachment = makeAttachment({ name: "script.py", contentType: "text/x-python" });
    const result = await processAttachments([attachment], defaultConfig, testDir, mockLogger);

    expect(result.promptSections).toHaveLength(1);
    expect(result.promptSections[0]).toContain("--- File: script.py (text/x-python) ---");
    expect(result.promptSections[0]).toContain("hello world");
    expect(result.promptSections[0]).toContain("--- End of script.py ---");
    expect(result.downloadedPaths).toHaveLength(0);

    vi.unstubAllGlobals();
  });

  it("truncates large text files", async () => {
    const largeContent = "x".repeat(60_000);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => largeContent,
      }),
    );

    const attachment = makeAttachment();
    const result = await processAttachments([attachment], defaultConfig, testDir, mockLogger);

    expect(result.promptSections).toHaveLength(1);
    expect(result.promptSections[0]).toContain("truncated at 50000 chars");

    vi.unstubAllGlobals();
  });

  it("downloads images to disk and returns file path in prompt", async () => {
    const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () =>
          imageData.buffer.slice(imageData.byteOffset, imageData.byteOffset + imageData.byteLength),
      }),
    );

    const attachment = makeAttachment({
      name: "screenshot.png",
      contentType: "image/png",
      category: "image",
    });
    const result = await processAttachments([attachment], defaultConfig, testDir, mockLogger);

    expect(result.promptSections).toHaveLength(1);
    expect(result.promptSections[0]).toContain("[Image attached:");
    expect(result.promptSections[0]).toContain("att_1-screenshot.png");
    expect(result.promptSections[0]).toContain("Use the Read tool");
    expect(result.downloadedPaths).toHaveLength(1);
    expect(basename(result.downloadedPaths[0])).toBe("att_1-screenshot.png");

    // Verify file was actually written
    const fileContents = await readFile(result.downloadedPaths[0]);
    expect(Buffer.from(fileContents)).toEqual(Buffer.from(imageData));

    vi.unstubAllGlobals();
  });

  it("downloads PDFs to disk and returns file path in prompt", async () => {
    const pdfData = Buffer.from("%PDF-1.4");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => pdfData.buffer,
      }),
    );

    const attachment = makeAttachment({
      name: "document.pdf",
      contentType: "application/pdf",
      category: "pdf",
    });
    const result = await processAttachments([attachment], defaultConfig, testDir, mockLogger);

    expect(result.promptSections).toHaveLength(1);
    expect(result.promptSections[0]).toContain("[PDF attached:");
    expect(result.promptSections[0]).toContain("att_1-document.pdf");
    expect(result.downloadedPaths).toHaveLength(1);
    expect(basename(result.downloadedPaths[0])).toBe("att_1-document.pdf");

    vi.unstubAllGlobals();
  });

  it("skips binary attachments when no working directory", async () => {
    const attachment = makeAttachment({
      name: "photo.jpg",
      contentType: "image/jpeg",
      category: "image",
    });

    const result = await processAttachments([attachment], defaultConfig, undefined, mockLogger);

    expect(result.promptSections).toHaveLength(0);
    expect(result.skippedFiles).toHaveLength(1);
    expect(result.skippedFiles[0].reason).toContain("no working_directory");
  });

  it("handles fetch failures gracefully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }),
    );

    const attachment = makeAttachment();
    const result = await processAttachments([attachment], defaultConfig, testDir, mockLogger);

    expect(result.promptSections).toHaveLength(0);
    expect(result.skippedFiles).toHaveLength(1);
    expect(result.skippedFiles[0].reason).toContain("download/processing failed");
    expect(mockLogger.warn).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("handles network errors gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const attachment = makeAttachment();
    const result = await processAttachments([attachment], defaultConfig, testDir, mockLogger);

    expect(result.promptSections).toHaveLength(0);
    expect(result.skippedFiles).toHaveLength(1);
    expect(result.skippedFiles[0].reason).toContain("Network error");

    vi.unstubAllGlobals();
  });

  it("uses different download directories across attachment runs", async () => {
    const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () =>
          imageData.buffer.slice(imageData.byteOffset, imageData.byteOffset + imageData.byteLength),
      }),
    );

    const first = await processAttachments(
      [
        makeAttachment({
          id: "run1",
          name: "one.png",
          contentType: "image/png",
          category: "image",
        }),
      ],
      defaultConfig,
      testDir,
      mockLogger,
    );
    const second = await processAttachments(
      [
        makeAttachment({
          id: "run2",
          name: "two.png",
          contentType: "image/png",
          category: "image",
        }),
      ],
      defaultConfig,
      testDir,
      mockLogger,
    );

    expect(first.downloadedPaths).toHaveLength(1);
    expect(second.downloadedPaths).toHaveLength(1);
    expect(dirname(first.downloadedPaths[0])).not.toBe(dirname(second.downloadedPaths[0]));

    vi.unstubAllGlobals();
  });

  it("preserves both binary attachments when filenames are duplicated", async () => {
    const firstPayload = Buffer.from("first");
    const secondPayload = Buffer.from("second");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () =>
            firstPayload.buffer.slice(
              firstPayload.byteOffset,
              firstPayload.byteOffset + firstPayload.byteLength,
            ),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () =>
            secondPayload.buffer.slice(
              secondPayload.byteOffset,
              secondPayload.byteOffset + secondPayload.byteLength,
            ),
        }),
    );

    const duplicatedName = "same-name.png";
    const attachments = [
      makeAttachment({
        id: "att_101",
        name: duplicatedName,
        contentType: "image/png",
        category: "image",
      }),
      makeAttachment({
        id: "att_202",
        name: duplicatedName,
        contentType: "image/png",
        category: "image",
      }),
    ];

    const result = await processAttachments(attachments, defaultConfig, testDir, mockLogger);

    expect(result.downloadedPaths).toHaveLength(2);
    expect(result.downloadedPaths[0]).not.toBe(result.downloadedPaths[1]);
    expect(basename(result.downloadedPaths[0])).toBe("att_101-same-name.png");
    expect(basename(result.downloadedPaths[1])).toBe("att_202-same-name.png");

    const firstBytes = await readFile(result.downloadedPaths[0]);
    const secondBytes = await readFile(result.downloadedPaths[1]);
    expect(Buffer.from(firstBytes)).toEqual(firstPayload);
    expect(Buffer.from(secondBytes)).toEqual(secondPayload);

    vi.unstubAllGlobals();
  });
});

// =============================================================================
// cleanupAttachments Tests
// =============================================================================

describe("cleanupAttachments", () => {
  const cleanupAttachments = ManagerAny.cleanupAttachments.bind(ManagerAny);

  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  let testDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    testDir = join(tmpdir(), `herdctl-cleanup-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("removes downloaded files and empty parent directories", async () => {
    const subDir = join(testDir, "timestamp123");
    await mkdir(subDir, { recursive: true });
    const filePath = join(subDir, "test.png");
    await import("node:fs/promises").then((fs) => fs.writeFile(filePath, "data"));

    await cleanupAttachments([filePath], mockLogger);

    // File should be gone
    await expect(stat(filePath)).rejects.toThrow();
    // Parent timestamp dir should also be gone
    await expect(stat(subDir)).rejects.toThrow();
  });

  it("handles missing files gracefully", async () => {
    const nonexistent = join(testDir, "nope.txt");

    // Should not throw
    await cleanupAttachments([nonexistent], mockLogger);
    expect(mockLogger.debug).toHaveBeenCalled();
  });
});
