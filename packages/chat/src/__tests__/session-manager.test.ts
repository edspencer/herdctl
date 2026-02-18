import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { ChatSessionManager } from "../session-manager/session-manager.js";
import {
  type ChatSessionState,
  createInitialSessionState,
} from "../session-manager/types.js";
import {
  SessionStateReadError,
  SessionStateWriteError,
  SessionDirectoryCreateError,
} from "../session-manager/errors.js";

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestDir(): string {
  const random = randomBytes(8).toString("hex");
  return join(tmpdir(), `herdctl-chat-session-test-${random}`);
}

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// =============================================================================
// Session Manager Tests - Discord Platform
// =============================================================================

describe("ChatSessionManager (platform: discord)", () => {
  let testDir: string;
  let mockLogger: ReturnType<typeof createMockLogger>;
  const platform = "discord";

  beforeEach(async () => {
    testDir = createTestDir();
    await mkdir(testDir, { recursive: true });
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe("constructor", () => {
    it("creates session manager with valid options", () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      expect(manager.agentName).toBe("test-agent");
      expect(manager.platform).toBe("discord");
    });

    it("uses default expiry hours when not specified", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      // Create a session
      await manager.getOrCreateSession("channel-1");

      // Read the state file to verify it was created
      const stateFilePath = join(
        testDir,
        "discord-sessions",
        "test-agent.yaml"
      );
      const content = await readFile(stateFilePath, "utf-8");
      const state = parseYaml(content) as ChatSessionState;

      expect(state.channels["channel-1"]).toBeDefined();
    });

    it("accepts custom expiry hours", () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        sessionExpiryHours: 48,
        logger: mockLogger,
      });

      expect(manager.agentName).toBe("test-agent");
    });
  });

  // ===========================================================================
  // getOrCreateSession Tests
  // ===========================================================================

  describe("getOrCreateSession", () => {
    it("creates new session when none exists", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      const result = await manager.getOrCreateSession("channel-123");

      expect(result.isNew).toBe(true);
      expect(result.sessionId).toMatch(/^discord-test-agent-/);
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Created new session",
        expect.objectContaining({ channelId: "channel-123" })
      );
    });

    it("returns existing session when one exists", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      // Create first session
      const first = await manager.getOrCreateSession("channel-123");

      // Get session again
      const second = await manager.getOrCreateSession("channel-123");

      expect(second.isNew).toBe(false);
      expect(second.sessionId).toBe(first.sessionId);
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Resuming existing session",
        expect.objectContaining({
          channelId: "channel-123",
          sessionId: first.sessionId,
        })
      );
    });

    it("creates different sessions for different channels", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      const session1 = await manager.getOrCreateSession("channel-1");
      const session2 = await manager.getOrCreateSession("channel-2");

      expect(session1.sessionId).not.toBe(session2.sessionId);
      expect(session1.isNew).toBe(true);
      expect(session2.isNew).toBe(true);
    });

    it("creates new session when previous is expired", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        sessionExpiryHours: 1, // 1 hour expiry
        logger: mockLogger,
      });

      // Create initial session
      const first = await manager.getOrCreateSession("channel-123");

      // Manually update state to have old timestamp
      const stateFilePath = join(
        testDir,
        "discord-sessions",
        "test-agent.yaml"
      );
      const content = await readFile(stateFilePath, "utf-8");
      const state = parseYaml(content) as ChatSessionState;

      // Set last message to 2 hours ago
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      state.channels["channel-123"].lastMessageAt = twoHoursAgo.toISOString();
      await writeFile(stateFilePath, stringifyYaml(state), "utf-8");

      // Clear cache by creating new manager
      const manager2 = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        sessionExpiryHours: 1,
        logger: mockLogger,
      });

      // Get session again - should be new
      const second = await manager2.getOrCreateSession("channel-123");

      expect(second.isNew).toBe(true);
      expect(second.sessionId).not.toBe(first.sessionId);
    });

    it("creates discord-sessions directory if it doesn't exist", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      await manager.getOrCreateSession("channel-123");

      // Verify directory was created
      const stateFilePath = join(
        testDir,
        "discord-sessions",
        "test-agent.yaml"
      );
      const content = await readFile(stateFilePath, "utf-8");
      expect(content).toBeTruthy();
    });

    it("persists state to YAML file", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      const result = await manager.getOrCreateSession("channel-123");

      // Read and verify the state file
      const stateFilePath = join(
        testDir,
        "discord-sessions",
        "test-agent.yaml"
      );
      const content = await readFile(stateFilePath, "utf-8");
      const state = parseYaml(content) as ChatSessionState;

      expect(state.version).toBe(1);
      expect(state.agentName).toBe("test-agent");
      expect(state.channels["channel-123"].sessionId).toBe(result.sessionId);
      expect(state.channels["channel-123"].lastMessageAt).toBeTruthy();
    });
  });

  // ===========================================================================
  // touchSession Tests
  // ===========================================================================

  describe("touchSession", () => {
    it("updates lastMessageAt timestamp", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      // Create session
      await manager.getOrCreateSession("channel-123");

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Touch the session
      await manager.touchSession("channel-123");

      // Read state and verify timestamp was updated
      const stateFilePath = join(
        testDir,
        "discord-sessions",
        "test-agent.yaml"
      );
      const content = await readFile(stateFilePath, "utf-8");
      const state = parseYaml(content) as ChatSessionState;

      const lastMessageAt = new Date(
        state.channels["channel-123"].lastMessageAt
      );
      const now = new Date();

      // Should be within last second
      expect(now.getTime() - lastMessageAt.getTime()).toBeLessThan(1000);
    });

    it("warns when touching non-existent session", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      await manager.touchSession("non-existent-channel");

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Attempted to touch non-existent session",
        { channelId: "non-existent-channel" }
      );
    });
  });

  // ===========================================================================
  // getSession Tests
  // ===========================================================================

  describe("getSession", () => {
    it("returns null when no session exists", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      const session = await manager.getSession("channel-123");

      expect(session).toBeNull();
    });

    it("returns session when it exists and is not expired", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      // Create session
      const created = await manager.getOrCreateSession("channel-123");

      // Get session
      const session = await manager.getSession("channel-123");

      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe(created.sessionId);
    });

    it("returns null when session is expired", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        sessionExpiryHours: 1,
        logger: mockLogger,
      });

      // Create session
      await manager.getOrCreateSession("channel-123");

      // Manually update state to have old timestamp
      const stateFilePath = join(
        testDir,
        "discord-sessions",
        "test-agent.yaml"
      );
      const content = await readFile(stateFilePath, "utf-8");
      const state = parseYaml(content) as ChatSessionState;

      // Set last message to 2 hours ago
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      state.channels["channel-123"].lastMessageAt = twoHoursAgo.toISOString();
      await writeFile(stateFilePath, stringifyYaml(state), "utf-8");

      // Clear cache by creating new manager
      const manager2 = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        sessionExpiryHours: 1,
        logger: mockLogger,
      });

      // Get session - should be null
      const session = await manager2.getSession("channel-123");

      expect(session).toBeNull();
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Session expired",
        expect.objectContaining({ channelId: "channel-123" })
      );
    });
  });

  // ===========================================================================
  // setSession Tests
  // ===========================================================================

  describe("setSession", () => {
    it("stores a new session for a channel", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      await manager.setSession("channel-123", "sdk-session-456");

      // Verify session was stored
      const session = await manager.getSession("channel-123");
      expect(session).toBeDefined();
      expect(session?.sessionId).toBe("sdk-session-456");

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Stored new session",
        expect.objectContaining({
          channelId: "channel-123",
          sessionId: "sdk-session-456",
        })
      );
    });

    it("updates an existing session with a new session ID", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      // Store initial session
      await manager.setSession("channel-123", "old-session-id");

      // Update with new session ID
      await manager.setSession("channel-123", "new-session-id");

      // Verify session was updated
      const session = await manager.getSession("channel-123");
      expect(session).toBeDefined();
      expect(session?.sessionId).toBe("new-session-id");

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Updated session",
        expect.objectContaining({
          channelId: "channel-123",
          oldSessionId: "old-session-id",
          newSessionId: "new-session-id",
        })
      );
    });

    it("updates the lastMessageAt timestamp", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      const beforeSet = new Date();
      await manager.setSession("channel-123", "sdk-session-456");
      const afterSet = new Date();

      const session = await manager.getSession("channel-123");
      expect(session).toBeDefined();

      const lastMessageAt = new Date(session!.lastMessageAt);
      expect(lastMessageAt.getTime()).toBeGreaterThanOrEqual(beforeSet.getTime());
      expect(lastMessageAt.getTime()).toBeLessThanOrEqual(afterSet.getTime());
    });
  });

  // ===========================================================================
  // clearSession Tests
  // ===========================================================================

  describe("clearSession", () => {
    it("returns false when no session exists", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      const result = await manager.clearSession("channel-123");

      expect(result).toBe(false);
    });

    it("clears existing session and returns true", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      // Create session
      await manager.getOrCreateSession("channel-123");

      // Clear it
      const result = await manager.clearSession("channel-123");

      expect(result).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Cleared session",
        expect.objectContaining({ channelId: "channel-123" })
      );

      // Verify it's gone
      const session = await manager.getSession("channel-123");
      expect(session).toBeNull();
    });

    it("only clears the specified session", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      // Create sessions
      await manager.getOrCreateSession("channel-1");
      const session2 = await manager.getOrCreateSession("channel-2");

      // Clear only channel-1
      await manager.clearSession("channel-1");

      // Verify channel-2 still exists
      const remaining = await manager.getSession("channel-2");
      expect(remaining).not.toBeNull();
      expect(remaining!.sessionId).toBe(session2.sessionId);
    });
  });

  // ===========================================================================
  // cleanupExpiredSessions Tests
  // ===========================================================================

  describe("cleanupExpiredSessions", () => {
    it("returns 0 when no sessions exist", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      const count = await manager.cleanupExpiredSessions();

      expect(count).toBe(0);
    });

    it("returns 0 when no sessions are expired", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      // Create sessions
      await manager.getOrCreateSession("channel-1");
      await manager.getOrCreateSession("channel-2");

      const count = await manager.cleanupExpiredSessions();

      expect(count).toBe(0);
    });

    it("cleans up expired sessions", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        sessionExpiryHours: 1,
        logger: mockLogger,
      });

      // Create sessions
      await manager.getOrCreateSession("channel-1");
      await manager.getOrCreateSession("channel-2");
      await manager.getOrCreateSession("channel-3");

      // Manually expire some sessions
      const stateFilePath = join(
        testDir,
        "discord-sessions",
        "test-agent.yaml"
      );
      const content = await readFile(stateFilePath, "utf-8");
      const state = parseYaml(content) as ChatSessionState;

      // Expire channel-1 and channel-3 (2 hours ago)
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      state.channels["channel-1"].lastMessageAt = twoHoursAgo.toISOString();
      state.channels["channel-3"].lastMessageAt = twoHoursAgo.toISOString();
      await writeFile(stateFilePath, stringifyYaml(state), "utf-8");

      // Clear cache by creating new manager
      const manager2 = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        sessionExpiryHours: 1,
        logger: mockLogger,
      });

      // Cleanup
      const count = await manager2.cleanupExpiredSessions();

      expect(count).toBe(2);
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Cleaned up expired sessions",
        { count: 2 }
      );

      // Verify channel-2 still exists
      const session2 = await manager2.getSession("channel-2");
      expect(session2).not.toBeNull();

      // Verify channel-1 and channel-3 are gone
      const session1 = await manager2.getSession("channel-1");
      const session3 = await manager2.getSession("channel-3");
      expect(session1).toBeNull();
      expect(session3).toBeNull();
    });
  });

  // ===========================================================================
  // State File Recovery Tests
  // ===========================================================================

  describe("state file recovery", () => {
    it("creates fresh state when file is corrupted", async () => {
      // Write corrupted YAML
      const stateDir = join(testDir, "discord-sessions");
      await mkdir(stateDir, { recursive: true });
      await writeFile(
        join(stateDir, "test-agent.yaml"),
        "invalid: yaml: content: {{"
      );

      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      // Should still work
      const result = await manager.getOrCreateSession("channel-123");

      expect(result.isNew).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Corrupted session state file, creating fresh state",
        expect.any(Object)
      );
    });

    it("creates fresh state when file has invalid schema", async () => {
      // Write valid YAML but invalid schema
      const stateDir = join(testDir, "discord-sessions");
      await mkdir(stateDir, { recursive: true });
      await writeFile(
        join(stateDir, "test-agent.yaml"),
        stringifyYaml({ version: 999, invalid: true })
      );

      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      // Should still work
      const result = await manager.getOrCreateSession("channel-123");

      expect(result.isNew).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Corrupted session state file, creating fresh state",
        expect.any(Object)
      );
    });

    it("creates fresh state when file is empty", async () => {
      // Write empty file
      const stateDir = join(testDir, "discord-sessions");
      await mkdir(stateDir, { recursive: true });
      await writeFile(join(stateDir, "test-agent.yaml"), "");

      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      // Should still work
      const result = await manager.getOrCreateSession("channel-123");

      expect(result.isNew).toBe(true);
    });
  });

  // ===========================================================================
  // agentName Property Tests
  // ===========================================================================

  describe("agentName", () => {
    it("returns the agent name from options", () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "my-test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      expect(manager.agentName).toBe("my-test-agent");
    });
  });

  // ===========================================================================
  // Session ID Format Tests
  // ===========================================================================

  describe("session ID format", () => {
    it("generates session IDs with expected format", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "my-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      const result = await manager.getOrCreateSession("channel-123");

      // Should match pattern: discord-<agent-name>-<uuid>
      expect(result.sessionId).toMatch(
        /^discord-my-agent-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });
  });

  // ===========================================================================
  // Concurrent Access Tests
  // ===========================================================================

  describe("concurrent access", () => {
    it("handles concurrent getOrCreateSession calls", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      // Make concurrent calls
      const promises = [
        manager.getOrCreateSession("channel-1"),
        manager.getOrCreateSession("channel-2"),
        manager.getOrCreateSession("channel-3"),
      ];

      const results = await Promise.all(promises);

      // All should succeed
      expect(results[0].isNew).toBe(true);
      expect(results[1].isNew).toBe(true);
      expect(results[2].isNew).toBe(true);

      // Each should have unique session ID
      const sessionIds = new Set(results.map((r) => r.sessionId));
      expect(sessionIds.size).toBe(3);
    });
  });
});

// =============================================================================
// Session Manager Tests - Slack Platform
// =============================================================================

describe("ChatSessionManager (platform: slack)", () => {
  let testDir: string;
  let mockLogger: ReturnType<typeof createMockLogger>;
  const platform = "slack";

  beforeEach(async () => {
    testDir = createTestDir();
    await mkdir(testDir, { recursive: true });
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("platform-specific behavior", () => {
    it("stores sessions in slack-sessions directory", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      await manager.getOrCreateSession("channel-123");

      // Verify directory was created with slack prefix
      const stateFilePath = join(
        testDir,
        "slack-sessions",
        "test-agent.yaml"
      );
      const content = await readFile(stateFilePath, "utf-8");
      expect(content).toBeTruthy();
    });

    it("generates session IDs with slack prefix", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "my-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      const result = await manager.getOrCreateSession("channel-123");

      // Should match pattern: slack-<agent-name>-<uuid>
      expect(result.sessionId).toMatch(
        /^slack-my-agent-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it("exposes platform property", () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      expect(manager.platform).toBe("slack");
    });
  });

  describe("full session lifecycle", () => {
    it("completes full session lifecycle", async () => {
      const manager = new ChatSessionManager({
        platform,
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      // Create session
      const created = await manager.getOrCreateSession("channel-123");
      expect(created.isNew).toBe(true);
      expect(created.sessionId).toMatch(/^slack-test-agent-/);

      // Touch session
      await manager.touchSession("channel-123");

      // Get session
      const retrieved = await manager.getSession("channel-123");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.sessionId).toBe(created.sessionId);

      // Set session with new ID
      await manager.setSession("channel-123", "new-sdk-session");
      const updated = await manager.getSession("channel-123");
      expect(updated!.sessionId).toBe("new-sdk-session");

      // Get active session count
      const count = await manager.getActiveSessionCount();
      expect(count).toBe(1);

      // Clear session
      const cleared = await manager.clearSession("channel-123");
      expect(cleared).toBe(true);

      // Verify cleared
      const afterClear = await manager.getSession("channel-123");
      expect(afterClear).toBeNull();
    });
  });
});

// =============================================================================
// Platform-Agnostic Tests
// =============================================================================

describe("ChatSessionManager (platform-agnostic)", () => {
  let testDir: string;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    testDir = createTestDir();
    await mkdir(testDir, { recursive: true });
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("custom platform", () => {
    it("supports arbitrary platform names", async () => {
      const manager = new ChatSessionManager({
        platform: "teams",
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      const result = await manager.getOrCreateSession("channel-123");

      // Verify custom platform in session ID
      expect(result.sessionId).toMatch(/^teams-test-agent-/);

      // Verify custom platform directory
      const stateFilePath = join(
        testDir,
        "teams-sessions",
        "test-agent.yaml"
      );
      const content = await readFile(stateFilePath, "utf-8");
      expect(content).toBeTruthy();

      // Verify platform property
      expect(manager.platform).toBe("teams");
    });
  });

  describe("multiple platforms can coexist", () => {
    it("maintains separate session stores per platform", async () => {
      const discordManager = new ChatSessionManager({
        platform: "discord",
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      const slackManager = new ChatSessionManager({
        platform: "slack",
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      // Create sessions in both
      const discordSession = await discordManager.getOrCreateSession("channel-123");
      const slackSession = await slackManager.getOrCreateSession("channel-123");

      // Sessions should be independent
      expect(discordSession.sessionId).not.toBe(slackSession.sessionId);
      expect(discordSession.sessionId).toMatch(/^discord-/);
      expect(slackSession.sessionId).toMatch(/^slack-/);

      // Clear Discord session
      await discordManager.clearSession("channel-123");

      // Slack session should still exist
      const slackAfterClear = await slackManager.getSession("channel-123");
      expect(slackAfterClear).not.toBeNull();
      expect(slackAfterClear!.sessionId).toBe(slackSession.sessionId);
    });
  });
});

// =============================================================================
// Error Tests
// =============================================================================

describe("ChatSessionManager errors", () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  describe("SessionStateReadError", () => {
    it("is thrown on permission errors", async () => {
      // Create a directory that looks like a file (causes read to fail)
      const testDir = createTestDir();
      const stateDir = join(testDir, "discord-sessions");
      await mkdir(stateDir, { recursive: true });

      // Create the state file as a directory (which will cause read to fail)
      await mkdir(join(stateDir, "test-agent.yaml"));

      const manager = new ChatSessionManager({
        platform: "discord",
        agentName: "test-agent",
        stateDir: testDir,
        logger: mockLogger,
      });

      await expect(manager.getOrCreateSession("channel-123")).rejects.toThrow(
        SessionStateReadError
      );

      // Cleanup
      await rm(testDir, { recursive: true, force: true });
    });
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe("createInitialSessionState", () => {
  it("creates state with version 1", () => {
    const state = createInitialSessionState("my-agent");

    expect(state.version).toBe(1);
    expect(state.agentName).toBe("my-agent");
    expect(state.channels).toEqual({});
  });
});
