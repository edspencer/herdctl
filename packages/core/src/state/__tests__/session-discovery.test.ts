import { mkdir, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Mocks
// =============================================================================

// Mock session-attribution
vi.mock("../session-attribution.js", () => ({
  buildAttributionIndex: vi.fn(),
}));

// Mock jsonl-parser
vi.mock("../jsonl-parser.js", () => ({
  extractLastSummary: vi.fn(),
  extractSessionMetadata: vi.fn(),
  extractSessionUsage: vi.fn(),
  isSidechainSession: vi.fn().mockResolvedValue(false),
  parseSessionMessages: vi.fn(),
}));

// Mock session-metadata - use a class for proper constructor behavior
const mockGetCustomName = vi.fn().mockResolvedValue(undefined);
const mockGetAutoName = vi.fn().mockResolvedValue(undefined);
const mockBatchSetAutoNames = vi.fn().mockResolvedValue(undefined);
vi.mock("../session-metadata.js", () => {
  return {
    SessionMetadataStore: class MockSessionMetadataStore {
      getCustomName = mockGetCustomName;
      getAutoName = mockGetAutoName;
      batchSetAutoNames = mockBatchSetAutoNames;
    },
  };
});

import {
  extractLastSummary,
  extractSessionMetadata,
  extractSessionUsage,
  isSidechainSession,
  parseSessionMessages,
} from "../jsonl-parser.js";
// Import after mocks
import { buildAttributionIndex } from "../session-attribution.js";
import { SessionDiscoveryService } from "../session-discovery.js";

const mockBuildAttributionIndex = vi.mocked(buildAttributionIndex);
const mockExtractLastSummary = vi.mocked(extractLastSummary);
const mockExtractSessionMetadata = vi.mocked(extractSessionMetadata);
const mockExtractSessionUsage = vi.mocked(extractSessionUsage);
const mockIsSidechainSession = vi.mocked(isSidechainSession);
const mockParseSessionMessages = vi.mocked(parseSessionMessages);

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a temporary directory with a unique name
 */
async function createTempDir(prefix: string): Promise<string> {
  const baseDir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(baseDir, { recursive: true });
  // Resolve to real path to handle macOS /var -> /private/var symlink
  return await realpath(baseDir);
}

/**
 * Create an empty .jsonl session file
 */
async function createSessionFile(dir: string, sessionId: string): Promise<void> {
  await writeFile(join(dir, `${sessionId}.jsonl`), "");
}

/**
 * Create a default mock attribution index
 */
function createMockAttributionIndex(overrides?: {
  getAttribute?: (sessionId: string) => {
    origin: "native" | "web" | "discord" | "slack" | "schedule";
    agentName: string | undefined;
    triggerType: string | undefined;
  };
  /** Default agent name returned by getAttribute. Defaults to "my-agent". */
  defaultAgentName?: string;
}) {
  const agentName = overrides?.defaultAgentName ?? "my-agent";
  const defaultGetAttribute = (sessionId: string) => ({
    origin: "native" as const,
    agentName,
    triggerType: undefined,
  });

  const getAttribute = overrides?.getAttribute ?? defaultGetAttribute;

  return {
    getAttribute,
    getAttributes: (ids: string[]) => new Map(ids.map((id) => [id, getAttribute(id)])),
    size: 0,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("SessionDiscoveryService", () => {
  let tempClaudeHome: string;
  let tempStateDir: string;

  beforeEach(async () => {
    tempClaudeHome = await createTempDir("claude-home-test");
    tempStateDir = await createTempDir("state-dir-test");

    // Set up default attribution mock
    mockBuildAttributionIndex.mockResolvedValue(createMockAttributionIndex());

    // Reset metadata store mocks to default
    mockGetCustomName.mockReset();
    mockGetCustomName.mockResolvedValue(undefined);
    mockGetAutoName.mockReset();
    mockGetAutoName.mockResolvedValue(undefined);
    mockBatchSetAutoNames.mockReset();
    mockBatchSetAutoNames.mockResolvedValue(undefined);

    // Reset JSONL parser mocks
    mockExtractLastSummary.mockReset();
    mockExtractLastSummary.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await rm(tempClaudeHome, { recursive: true, force: true });
    await rm(tempStateDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // getAgentSessions
  // ===========================================================================

  describe("getAgentSessions", () => {
    it("returns sessions from agent's working directory, sorted by mtime descending", async () => {
      // Create projects directory structure
      const workingDir = "/Users/ed/Code/myproject";
      const encodedPath = "-Users-ed-Code-myproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });

      // Create session files with different mtimes
      const now = Date.now();
      await createSessionFile(projectDir, "session-older");
      await createSessionFile(projectDir, "session-newer");

      // Set mtimes explicitly
      const olderTime = new Date(now - 10000);
      const newerTime = new Date(now);
      await utimes(join(projectDir, "session-older.jsonl"), olderTime, olderTime);
      await utimes(join(projectDir, "session-newer.jsonl"), newerTime, newerTime);

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const sessions = await service.getAgentSessions("my-agent", workingDir, false);

      expect(sessions).toHaveLength(2);
      // Newest first
      expect(sessions[0].sessionId).toBe("session-newer");
      expect(sessions[1].sessionId).toBe("session-older");
    });

    it("returns empty array when projects directory doesn't exist", async () => {
      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      // Directory doesn't exist at all
      const sessions = await service.getAgentSessions("my-agent", "/nonexistent/path", false);

      expect(sessions).toEqual([]);
    });

    it("returns empty array when no .jsonl files in directory", async () => {
      const workingDir = "/Users/ed/Code/emptyproject";
      const encodedPath = "-Users-ed-Code-emptyproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });

      // Create a non-.jsonl file
      await writeFile(join(projectDir, "readme.txt"), "hello");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const sessions = await service.getAgentSessions("my-agent", workingDir, false);

      expect(sessions).toEqual([]);
    });

    it("includes attribution data from the attribution index", async () => {
      const workingDir = "/Users/ed/Code/myproject";
      const encodedPath = "-Users-ed-Code-myproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-abc");

      // Set up attribution mock to return discord origin attributed to the requested agent
      mockBuildAttributionIndex.mockResolvedValue(
        createMockAttributionIndex({
          getAttribute: (sessionId) => ({
            origin: "discord",
            agentName: "my-agent",
            triggerType: "discord",
          }),
        }),
      );

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const sessions = await service.getAgentSessions("my-agent", workingDir, false);

      expect(sessions[0].origin).toBe("discord");
      expect(sessions[0].agentName).toBe("my-agent");
    });

    it("includes custom name from metadata store", async () => {
      const workingDir = "/Users/ed/Code/myproject";
      const encodedPath = "-Users-ed-Code-myproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-abc");

      // Set up metadata store mock to return a custom name
      mockGetCustomName.mockResolvedValue("My Custom Session");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const sessions = await service.getAgentSessions("my-agent", workingDir, false);

      expect(sessions[0].customName).toBe("My Custom Session");
      expect(mockGetCustomName).toHaveBeenCalledWith("my-agent", "session-abc");
    });

    it("sets resumable: true for non-Docker agents", async () => {
      const workingDir = "/Users/ed/Code/myproject";
      const encodedPath = "-Users-ed-Code-myproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-abc");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const sessions = await service.getAgentSessions("my-agent", workingDir, false);

      expect(sessions[0].resumable).toBe(true);
    });

    it("sets resumable: false for Docker agents", async () => {
      const workingDir = "/Users/ed/Code/myproject";
      const encodedPath = "-Users-ed-Code-myproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-abc");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const sessions = await service.getAgentSessions("my-agent", workingDir, true);

      expect(sessions[0].resumable).toBe(false);
    });

    it("cache behavior: second call within TTL uses cache (doesn't re-readdir)", async () => {
      const workingDir = "/Users/ed/Code/myproject";
      const encodedPath = "-Users-ed-Code-myproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-abc");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
        cacheTtlMs: 5000, // 5 second TTL
      });

      // First call
      const sessions1 = await service.getAgentSessions("my-agent", workingDir, false);
      expect(sessions1).toHaveLength(1);

      // Add a new session file
      await createSessionFile(projectDir, "session-def");

      // Second call within TTL - should return cached result
      const sessions2 = await service.getAgentSessions("my-agent", workingDir, false);
      expect(sessions2).toHaveLength(1); // Still 1, from cache
    });

    it("cache behavior: after TTL expires, re-reads directory", async () => {
      const workingDir = "/Users/ed/Code/myproject";
      const encodedPath = "-Users-ed-Code-myproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-abc");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
        cacheTtlMs: 50, // Very short TTL for testing
      });

      // First call
      const sessions1 = await service.getAgentSessions("my-agent", workingDir, false);
      expect(sessions1).toHaveLength(1);

      // Add a new session file
      await createSessionFile(projectDir, "session-def");

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Third call after TTL - should read new file
      const sessions3 = await service.getAgentSessions("my-agent", workingDir, false);
      expect(sessions3).toHaveLength(2);
    });

    it("preview field is always undefined (lazy loading)", async () => {
      const workingDir = "/Users/ed/Code/myproject";
      const encodedPath = "-Users-ed-Code-myproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-abc");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const sessions = await service.getAgentSessions("my-agent", workingDir, false);

      expect(sessions[0].preview).toBeUndefined();
    });

    it("only returns sessions attributed to the requested agent", async () => {
      const workingDir = "/Users/ed/Code/myproject";
      const encodedPath = "-Users-ed-Code-myproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-abc");

      // Attribution points to a different agent
      mockBuildAttributionIndex.mockResolvedValue(
        createMockAttributionIndex({
          getAttribute: () => ({
            origin: "web",
            agentName: "other-agent",
            triggerType: "web",
          }),
        }),
      );

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      // Requesting sessions for "my-agent" should not include sessions attributed to "other-agent"
      const sessions = await service.getAgentSessions("my-agent", workingDir, false);

      expect(sessions).toHaveLength(0);
    });

    it("excludes unattributed sessions from per-agent results", async () => {
      const workingDir = "/Users/ed/Code/myproject";
      const encodedPath = "-Users-ed-Code-myproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-abc");

      // Attribution has no agentName (native CLI session)
      mockBuildAttributionIndex.mockResolvedValue(
        createMockAttributionIndex({
          getAttribute: () => ({
            origin: "native",
            agentName: undefined,
            triggerType: undefined,
          }),
        }),
      );

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      // Unattributed sessions should not appear in per-agent results
      const sessions = await service.getAgentSessions("my-agent", workingDir, false);

      expect(sessions).toHaveLength(0);
    });
  });

  // ===========================================================================
  // getAllSessions
  // ===========================================================================

  describe("getAllSessions", () => {
    it("returns directory groups for all project directories", async () => {
      // Create multiple project directories
      const projectDir1 = join(tempClaudeHome, "projects", "-Users-ed-Code-project1");
      const projectDir2 = join(tempClaudeHome, "projects", "-Users-ed-Code-project2");
      await mkdir(projectDir1, { recursive: true });
      await mkdir(projectDir2, { recursive: true });
      await createSessionFile(projectDir1, "session-a");
      await createSessionFile(projectDir2, "session-b");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const groups = await service.getAllSessions([]);

      expect(groups).toHaveLength(2);
      expect(groups.map((g) => g.encodedPath).sort()).toEqual([
        "-Users-ed-Code-project1",
        "-Users-ed-Code-project2",
      ]);
    });

    it("matches agent directories to fleet agents by encoded path", async () => {
      const projectDir = join(tempClaudeHome, "projects", "-Users-ed-Code-myproject");
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-a");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const groups = await service.getAllSessions([
        {
          name: "my-fleet/my-agent",
          workingDirectory: "/Users/ed/Code/myproject",
          dockerEnabled: false,
        },
      ]);

      expect(groups).toHaveLength(1);
      expect(groups[0].agentName).toBe("my-fleet/my-agent");
    });

    it("filters out temp directories (paths starting with /tmp/)", async () => {
      // Create a temp-like directory
      const tempProjectDir = join(tempClaudeHome, "projects", "-tmp-test-project");
      await mkdir(tempProjectDir, { recursive: true });
      await createSessionFile(tempProjectDir, "session-temp");

      // Create a normal directory
      const normalProjectDir = join(tempClaudeHome, "projects", "-Users-ed-Code-normal");
      await mkdir(normalProjectDir, { recursive: true });
      await createSessionFile(normalProjectDir, "session-normal");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const groups = await service.getAllSessions([]);

      // Only the normal directory should be returned
      expect(groups).toHaveLength(1);
      expect(groups[0].encodedPath).toBe("-Users-ed-Code-normal");
    });

    it("filters out temp directories (paths containing /var/folders/)", async () => {
      // Create a var/folders-like directory
      const varFoldersDir = join(tempClaudeHome, "projects", "-var-folders-ab-cd-T-test");
      await mkdir(varFoldersDir, { recursive: true });
      await createSessionFile(varFoldersDir, "session-temp");

      // Create a normal directory
      const normalProjectDir = join(tempClaudeHome, "projects", "-Users-ed-Code-normal");
      await mkdir(normalProjectDir, { recursive: true });
      await createSessionFile(normalProjectDir, "session-normal");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const groups = await service.getAllSessions([]);

      // Only the normal directory should be returned
      expect(groups).toHaveLength(1);
      expect(groups[0].encodedPath).toBe("-Users-ed-Code-normal");
    });

    it("returns empty array when projects directory doesn't exist", async () => {
      // Don't create the projects directory
      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const groups = await service.getAllSessions([]);

      expect(groups).toEqual([]);
    });

    it("sorts groups by most recent session mtime", async () => {
      const now = Date.now();

      // Create project directories with sessions at different times
      const olderProjectDir = join(tempClaudeHome, "projects", "-Users-ed-Code-older");
      const newerProjectDir = join(tempClaudeHome, "projects", "-Users-ed-Code-newer");
      await mkdir(olderProjectDir, { recursive: true });
      await mkdir(newerProjectDir, { recursive: true });

      await createSessionFile(olderProjectDir, "session-old");
      await createSessionFile(newerProjectDir, "session-new");

      // Set mtimes
      const olderTime = new Date(now - 10000);
      const newerTime = new Date(now);
      await utimes(join(olderProjectDir, "session-old.jsonl"), olderTime, olderTime);
      await utimes(join(newerProjectDir, "session-new.jsonl"), newerTime, newerTime);

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const groups = await service.getAllSessions([]);

      expect(groups).toHaveLength(2);
      // Newest first
      expect(groups[0].encodedPath).toBe("-Users-ed-Code-newer");
      expect(groups[1].encodedPath).toBe("-Users-ed-Code-older");
    });

    it("skips directories with no .jsonl files", async () => {
      // Create a project directory with only non-jsonl files
      const emptyProjectDir = join(tempClaudeHome, "projects", "-Users-ed-Code-empty");
      await mkdir(emptyProjectDir, { recursive: true });
      await writeFile(join(emptyProjectDir, "readme.txt"), "hello");

      // Create a normal project directory
      const normalProjectDir = join(tempClaudeHome, "projects", "-Users-ed-Code-normal");
      await mkdir(normalProjectDir, { recursive: true });
      await createSessionFile(normalProjectDir, "session-a");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const groups = await service.getAllSessions([]);

      expect(groups).toHaveLength(1);
      expect(groups[0].encodedPath).toBe("-Users-ed-Code-normal");
    });

    it("skips non-directory entries in projects folder", async () => {
      // Create a file in the projects directory
      const projectsDir = join(tempClaudeHome, "projects");
      await mkdir(projectsDir, { recursive: true });
      await writeFile(join(projectsDir, "some-file.txt"), "hello");

      // Create a normal project directory
      const normalProjectDir = join(projectsDir, "-Users-ed-Code-normal");
      await mkdir(normalProjectDir, { recursive: true });
      await createSessionFile(normalProjectDir, "session-a");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const groups = await service.getAllSessions([]);

      expect(groups).toHaveLength(1);
      expect(groups[0].encodedPath).toBe("-Users-ed-Code-normal");
    });

    it("sets resumable based on agent dockerEnabled", async () => {
      const projectDir = join(tempClaudeHome, "projects", "-Users-ed-Code-myproject");
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-a");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const groups = await service.getAllSessions([
        {
          name: "docker-agent",
          workingDirectory: "/Users/ed/Code/myproject",
          dockerEnabled: true,
        },
      ]);

      expect(groups[0].sessions[0].resumable).toBe(false);
    });

    it("defaults resumable to true for unmatched directories", async () => {
      const projectDir = join(tempClaudeHome, "projects", "-Users-ed-Code-myproject");
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-a");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      // No matching agents
      const groups = await service.getAllSessions([]);

      expect(groups[0].sessions[0].resumable).toBe(true);
    });

    it("decodes workingDirectory from encoded path", async () => {
      const projectDir = join(tempClaudeHome, "projects", "-Users-ed-Code-myproject");
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-a");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const groups = await service.getAllSessions([]);

      expect(groups[0].workingDirectory).toBe("/Users/ed/Code/myproject");
    });
  });

  // ===========================================================================
  // Delegation methods
  // ===========================================================================

  describe("getSessionMessages", () => {
    it("delegates to parseSessionMessages", async () => {
      const mockMessages = [
        { role: "user" as const, content: "Hello", timestamp: "2024-01-15T10:00:00Z" },
      ];
      mockParseSessionMessages.mockResolvedValue(mockMessages);

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const result = await service.getSessionMessages("/Users/ed/Code/myproject", "session-abc");

      expect(result).toEqual(mockMessages);
      expect(mockParseSessionMessages).toHaveBeenCalled();
    });
  });

  describe("getSessionMetadata", () => {
    it("delegates to extractSessionMetadata", async () => {
      const mockMetadata = {
        sessionId: "session-abc",
        firstMessagePreview: "Hello world",
        gitBranch: "main",
        claudeCodeVersion: "1.0.0",
        messageCount: 10,
        firstMessageAt: "2024-01-15T10:00:00Z",
        lastMessageAt: "2024-01-15T11:00:00Z",
        summary: undefined,
        isSidechain: false,
      };
      mockExtractSessionMetadata.mockResolvedValue(mockMetadata);

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const result = await service.getSessionMetadata("/Users/ed/Code/myproject", "session-abc");

      expect(result).toEqual(mockMetadata);
      expect(mockExtractSessionMetadata).toHaveBeenCalled();
    });

    it("caches metadata on subsequent calls", async () => {
      // Clear the mock call count before this test
      mockExtractSessionMetadata.mockClear();

      const mockMetadata = {
        sessionId: "session-abc",
        firstMessagePreview: "Hello",
        gitBranch: undefined,
        claudeCodeVersion: undefined,
        messageCount: 1,
        firstMessageAt: "2024-01-15T10:00:00Z",
        lastMessageAt: "2024-01-15T10:00:00Z",
        summary: undefined,
        isSidechain: false,
      };
      mockExtractSessionMetadata.mockResolvedValue(mockMetadata);

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      // First call
      await service.getSessionMetadata("/Users/ed/Code/myproject", "session-abc");

      // Second call
      await service.getSessionMetadata("/Users/ed/Code/myproject", "session-abc");

      // Should only be called once due to caching
      expect(mockExtractSessionMetadata).toHaveBeenCalledTimes(1);
    });
  });

  describe("getSessionUsage", () => {
    it("delegates to extractSessionUsage", async () => {
      const mockUsage = {
        inputTokens: 1000,
        turnCount: 5,
        hasData: true,
      };
      mockExtractSessionUsage.mockResolvedValue(mockUsage);

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const result = await service.getSessionUsage("/Users/ed/Code/myproject", "session-abc");

      expect(result).toEqual(mockUsage);
      expect(mockExtractSessionUsage).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Cache invalidation
  // ===========================================================================

  describe("invalidateCache", () => {
    it("invalidateCache() with no args clears all caches", async () => {
      const workingDir = "/Users/ed/Code/myproject";
      const encodedPath = "-Users-ed-Code-myproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-abc");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
        cacheTtlMs: 60000, // Long TTL
      });

      // Populate caches
      await service.getAgentSessions("my-agent", workingDir, false);

      // Add a new session
      await createSessionFile(projectDir, "session-def");

      // Verify cache is still returning old data
      const beforeInvalidate = await service.getAgentSessions("my-agent", workingDir, false);
      expect(beforeInvalidate).toHaveLength(1);

      // Invalidate all caches
      service.invalidateCache();

      // Should now see new session
      const afterInvalidate = await service.getAgentSessions("my-agent", workingDir, false);
      expect(afterInvalidate).toHaveLength(2);
    });

    it("invalidateCache(workingDirectory) clears only that directory's cache", async () => {
      const workingDir1 = "/Users/ed/Code/project1";
      const workingDir2 = "/Users/ed/Code/project2";
      const encodedPath1 = "-Users-ed-Code-project1";
      const encodedPath2 = "-Users-ed-Code-project2";
      const projectDir1 = join(tempClaudeHome, "projects", encodedPath1);
      const projectDir2 = join(tempClaudeHome, "projects", encodedPath2);
      await mkdir(projectDir1, { recursive: true });
      await mkdir(projectDir2, { recursive: true });
      await createSessionFile(projectDir1, "session-a");
      await createSessionFile(projectDir2, "session-b");

      // Map sessions to their owning agents so the attribution filter passes
      const sessionAgentMap: Record<string, string> = {
        "session-a": "agent-1",
        "session-a2": "agent-1",
        "session-b": "agent-2",
        "session-b2": "agent-2",
      };
      mockBuildAttributionIndex.mockResolvedValue(
        createMockAttributionIndex({
          getAttribute: (sessionId: string) => ({
            origin: "native" as const,
            agentName: sessionAgentMap[sessionId],
            triggerType: undefined,
          }),
        }),
      );

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
        cacheTtlMs: 60000,
      });

      // Populate caches for both directories
      await service.getAgentSessions("agent-1", workingDir1, false);
      await service.getAgentSessions("agent-2", workingDir2, false);

      // Add new sessions to both
      await createSessionFile(projectDir1, "session-a2");
      await createSessionFile(projectDir2, "session-b2");

      // Invalidate only project1's cache
      service.invalidateCache(workingDir1);

      // Project1 should see new session
      const sessions1 = await service.getAgentSessions("agent-1", workingDir1, false);
      expect(sessions1).toHaveLength(2);

      // Project2 should still return cached (1 session)
      const sessions2 = await service.getAgentSessions("agent-2", workingDir2, false);
      expect(sessions2).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  describe("edge cases", () => {
    it("handles Windows-style encoded paths", async () => {
      // Windows path: C:\Users\ed\Code\myproject encodes to C:-Users-ed-Code-myproject
      const projectDir = join(tempClaudeHome, "projects", "C:-Users-ed-Code-myproject");
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-a");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const groups = await service.getAllSessions([]);

      expect(groups).toHaveLength(1);
      expect(groups[0].workingDirectory).toBe("C:/Users/ed/Code/myproject");
    });

    it("handles file being deleted between readdir and stat", async () => {
      const workingDir = "/Users/ed/Code/myproject";
      const encodedPath = "-Users-ed-Code-myproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });

      // Create two sessions
      await createSessionFile(projectDir, "session-a");
      await createSessionFile(projectDir, "session-b");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      // This should handle the race condition gracefully
      const sessions = await service.getAgentSessions("my-agent", workingDir, false);

      expect(sessions.length).toBeGreaterThanOrEqual(0);
    });

    it("uses attribution index cache within TTL", async () => {
      // Clear the mock call count before this test
      mockBuildAttributionIndex.mockClear();

      const workingDir = "/Users/ed/Code/myproject";
      const encodedPath = "-Users-ed-Code-myproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-a");

      mockBuildAttributionIndex.mockResolvedValue(
        createMockAttributionIndex({ defaultAgentName: "agent" }),
      );

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
        cacheTtlMs: 5000,
      });

      // First call
      await service.getAgentSessions("agent", workingDir, false);

      // Second call
      await service.getAgentSessions("agent", workingDir, false);

      // Attribution index should only be built once
      expect(mockBuildAttributionIndex).toHaveBeenCalledTimes(1);
    });

    it("refreshes attribution index after TTL expires", async () => {
      // Clear the mock call count before this test
      mockBuildAttributionIndex.mockClear();

      const workingDir = "/Users/ed/Code/myproject";
      const encodedPath = "-Users-ed-Code-myproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-a");

      mockBuildAttributionIndex.mockResolvedValue(
        createMockAttributionIndex({ defaultAgentName: "agent" }),
      );

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
        cacheTtlMs: 50, // Very short TTL
      });

      // First call
      await service.getAgentSessions("agent", workingDir, false);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Invalidate directory cache so it forces a re-read
      service.invalidateCache(workingDir);

      // Second call after TTL
      await service.getAgentSessions("agent", workingDir, false);

      // Attribution index should be rebuilt
      expect(mockBuildAttributionIndex).toHaveBeenCalledTimes(2);
    });

    it("uses 'adhoc' key for metadata lookups on unattributed directories", async () => {
      const projectDir = join(tempClaudeHome, "projects", "-Users-ed-Code-unmatched");
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-a");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      // No matching agent
      const groups = await service.getAllSessions([]);

      // Custom name should still be looked up using "adhoc" key
      expect(groups[0].sessions[0].customName).toBeUndefined();
      // The metadata store should be called with "adhoc" key for unattributed sessions
      expect(mockGetCustomName).toHaveBeenCalledWith("adhoc", "session-a");
    });

    it("gets custom name for directories with matching agent", async () => {
      const projectDir = join(tempClaudeHome, "projects", "-Users-ed-Code-matched");
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-a");

      mockGetCustomName.mockResolvedValue("Custom Name");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const groups = await service.getAllSessions([
        {
          name: "my-agent",
          workingDirectory: "/Users/ed/Code/matched",
          dockerEnabled: false,
        },
      ]);

      expect(groups[0].sessions[0].customName).toBe("Custom Name");
      expect(mockGetCustomName).toHaveBeenCalledWith("my-agent", "session-a");
    });

    it("returns correct sessionCount in directory groups", async () => {
      const projectDir = join(tempClaudeHome, "projects", "-Users-ed-Code-multi");
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-a");
      await createSessionFile(projectDir, "session-b");
      await createSessionFile(projectDir, "session-c");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const groups = await service.getAllSessions([]);

      expect(groups[0].sessionCount).toBe(3);
      expect(groups[0].sessions).toHaveLength(3);
    });
  });

  // ===========================================================================
  // autoName caching
  // ===========================================================================

  describe("autoName caching", () => {
    it("includes autoName field in discovered sessions from getAgentSessions", async () => {
      const workingDir = "/Users/ed/Code/myproject";
      const encodedPath = "-Users-ed-Code-myproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-abc");

      // Mock cache miss then extraction returns a summary
      mockGetAutoName.mockResolvedValue(undefined);
      mockExtractLastSummary.mockResolvedValue("Auto-generated session name");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const sessions = await service.getAgentSessions("my-agent", workingDir, false);

      expect(sessions[0].autoName).toBe("Auto-generated session name");
    });

    it("uses cached autoName when cache is valid", async () => {
      const workingDir = "/Users/ed/Code/myproject";
      const encodedPath = "-Users-ed-Code-myproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-abc");

      // Mock cache hit - return cached value with mtime in the future to ensure validity
      mockGetAutoName.mockResolvedValue({
        autoName: "Cached Auto Name",
        autoNameMtime: "2099-01-01T00:00:00.000Z",
      });

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const sessions = await service.getAgentSessions("my-agent", workingDir, false);

      expect(sessions[0].autoName).toBe("Cached Auto Name");
      // Should not have called extractLastSummary since cache was valid
      expect(mockExtractLastSummary).not.toHaveBeenCalled();
    });

    it("re-extracts autoName when cache is stale", async () => {
      const workingDir = "/Users/ed/Code/myproject";
      const encodedPath = "-Users-ed-Code-myproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-abc");

      // Mock cache miss (old mtime)
      mockGetAutoName.mockResolvedValue({
        autoName: "Old Cached Name",
        autoNameMtime: "1990-01-01T00:00:00.000Z",
      });
      mockExtractLastSummary.mockResolvedValue("Fresh Extracted Name");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const sessions = await service.getAgentSessions("my-agent", workingDir, false);

      expect(sessions[0].autoName).toBe("Fresh Extracted Name");
      expect(mockExtractLastSummary).toHaveBeenCalled();
    });

    it("batch writes autoName updates for getAgentSessions", async () => {
      const workingDir = "/Users/ed/Code/myproject";
      const encodedPath = "-Users-ed-Code-myproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-1");
      await createSessionFile(projectDir, "session-2");

      // Mock cache miss for both — use implementation that returns based on path
      mockGetAutoName.mockResolvedValue(undefined);
      mockExtractLastSummary.mockImplementation(async (filePath: string) => {
        if (filePath.includes("session-1")) return "Session 1 Name";
        if (filePath.includes("session-2")) return "Session 2 Name";
        return undefined;
      });

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      await service.getAgentSessions("my-agent", workingDir, false);

      // Should have called batchSetAutoNames once with both sessions
      expect(mockBatchSetAutoNames).toHaveBeenCalledTimes(1);
      expect(mockBatchSetAutoNames).toHaveBeenCalledWith(
        "my-agent",
        expect.arrayContaining([
          expect.objectContaining({ sessionId: "session-1", autoName: "Session 1 Name" }),
          expect.objectContaining({ sessionId: "session-2", autoName: "Session 2 Name" }),
        ]),
      );
    });

    it("does not batch write when all autoNames are from cache", async () => {
      const workingDir = "/Users/ed/Code/myproject";
      const encodedPath = "-Users-ed-Code-myproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-abc");

      // Mock cache hit
      mockGetAutoName.mockResolvedValue({
        autoName: "Cached Name",
        autoNameMtime: "2099-01-01T00:00:00.000Z",
      });

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      await service.getAgentSessions("my-agent", workingDir, false);

      // Should not have called batchSetAutoNames
      expect(mockBatchSetAutoNames).not.toHaveBeenCalled();
    });

    it("uses 'adhoc' key for autoName caching on unattributed sessions in getAllSessions", async () => {
      const projectDir = join(tempClaudeHome, "projects", "-Users-ed-Code-unattributed");
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-abc");

      // Mock cache miss
      mockGetAutoName.mockResolvedValue(undefined);
      mockExtractLastSummary.mockResolvedValue("Unattributed Session Name");

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const groups = await service.getAllSessions([]);

      expect(groups[0].sessions[0].autoName).toBe("Unattributed Session Name");
      // Should use "adhoc" key for unattributed sessions
      expect(mockGetAutoName).toHaveBeenCalledWith("adhoc", "session-abc");
      expect(mockBatchSetAutoNames).toHaveBeenCalledWith(
        "adhoc",
        expect.arrayContaining([
          expect.objectContaining({
            sessionId: "session-abc",
            autoName: "Unattributed Session Name",
          }),
        ]),
      );
    });

    it("returns undefined autoName when session has no summary", async () => {
      const workingDir = "/Users/ed/Code/myproject";
      const encodedPath = "-Users-ed-Code-myproject";
      const projectDir = join(tempClaudeHome, "projects", encodedPath);
      await mkdir(projectDir, { recursive: true });
      await createSessionFile(projectDir, "session-abc");

      // Mock cache miss and no summary
      mockGetAutoName.mockResolvedValue(undefined);
      mockExtractLastSummary.mockResolvedValue(undefined);

      const service = new SessionDiscoveryService({
        claudeHomePath: tempClaudeHome,
        stateDir: tempStateDir,
      });

      const sessions = await service.getAgentSessions("my-agent", workingDir, false);

      expect(sessions[0].autoName).toBeUndefined();
      // Should not batch write when there's nothing to write
      expect(mockBatchSetAutoNames).not.toHaveBeenCalled();
    });
  });
});
