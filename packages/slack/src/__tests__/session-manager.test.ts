import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "../session-manager/session-manager.js";
import {
  createInitialSessionState,
  createChannelSession,
} from "../session-manager/types.js";
import {
  SessionManagerError,
  SessionStateReadError,
  SessionStateWriteError,
  SessionDirectoryCreateError,
  SessionErrorCode,
} from "../session-manager/errors.js";

const createMockLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe("SessionManager", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "slack-session-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const createManager = (agentName = "test-agent", expiryHours = 24) => {
    return new SessionManager({
      agentName,
      stateDir: tempDir,
      sessionExpiryHours: expiryHours,
      logger: createMockLogger(),
    });
  };

  describe("getOrCreateSession", () => {
    it("creates a new session for unknown channel", async () => {
      const manager = createManager();

      const result = await manager.getOrCreateSession("C0123456789");

      expect(result.isNew).toBe(true);
      expect(result.sessionId).toMatch(/^slack-test-agent-/);
    });

    it("returns existing session for known channel", async () => {
      const manager = createManager();

      const first = await manager.getOrCreateSession("C0123456789");
      const second = await manager.getOrCreateSession("C0123456789");

      expect(second.isNew).toBe(false);
      expect(second.sessionId).toBe(first.sessionId);
    });

    it("creates different sessions for different channels", async () => {
      const manager = createManager();

      const first = await manager.getOrCreateSession("C0123456789");
      const second = await manager.getOrCreateSession("C9876543210");

      expect(first.sessionId).not.toBe(second.sessionId);
    });
  });

  describe("getSession", () => {
    it("returns null for unknown channel", async () => {
      const manager = createManager();

      const session = await manager.getSession("C_UNKNOWN");

      expect(session).toBeNull();
    });

    it("returns session for known channel", async () => {
      const manager = createManager();

      await manager.getOrCreateSession("C0123456789");
      const session = await manager.getSession("C0123456789");

      expect(session).not.toBeNull();
      expect(session!.sessionId).toMatch(/^slack-test-agent-/);
    });

    it("returns null for expired sessions", async () => {
      // 0 hours expiry = immediately expired
      const manager = createManager("test-agent", 0);

      await manager.getOrCreateSession("C0123456789");

      // Wait a tick so the session is expired
      await new Promise((resolve) => setTimeout(resolve, 10));

      const session = await manager.getSession("C0123456789");
      expect(session).toBeNull();
    });
  });

  describe("touchSession", () => {
    it("updates last message timestamp", async () => {
      const manager = createManager();

      await manager.getOrCreateSession("C0123456789");
      const before = await manager.getSession("C0123456789");
      const beforeTime = new Date(before!.lastMessageAt).getTime();

      // Wait enough for a distinct timestamp
      await new Promise((resolve) => setTimeout(resolve, 50));
      await manager.touchSession("C0123456789");

      const after = await manager.getSession("C0123456789");
      const afterTime = new Date(after!.lastMessageAt).getTime();

      expect(afterTime).toBeGreaterThanOrEqual(beforeTime);
    });

    it("does not throw for unknown channel", async () => {
      const manager = createManager();

      await expect(
        manager.touchSession("C_UNKNOWN")
      ).resolves.toBeUndefined();
    });
  });

  describe("setSession", () => {
    it("creates or updates a session", async () => {
      const manager = createManager();

      await manager.setSession("C0123456789", "custom-session-id");

      const session = await manager.getSession("C0123456789");
      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe("custom-session-id");
    });

    it("overwrites existing session", async () => {
      const manager = createManager();

      await manager.getOrCreateSession("C0123456789");
      await manager.setSession("C0123456789", "new-session-id");

      const session = await manager.getSession("C0123456789");
      expect(session!.sessionId).toBe("new-session-id");
    });
  });

  describe("clearSession", () => {
    it("removes a session and returns true", async () => {
      const manager = createManager();

      await manager.getOrCreateSession("C0123456789");
      const result = await manager.clearSession("C0123456789");

      expect(result).toBe(true);

      const session = await manager.getSession("C0123456789");
      expect(session).toBeNull();
    });

    it("returns false for unknown channel", async () => {
      const manager = createManager();

      const result = await manager.clearSession("C_UNKNOWN");

      expect(result).toBe(false);
    });
  });

  describe("cleanupExpiredSessions", () => {
    it("removes expired sessions", async () => {
      const manager = createManager("test-agent", 0);

      await manager.getOrCreateSession("C001");
      await manager.getOrCreateSession("C002");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const count = await manager.cleanupExpiredSessions();

      expect(count).toBe(2);
    });

    it("keeps active sessions", async () => {
      const manager = createManager("test-agent", 24);

      await manager.getOrCreateSession("C001");

      const count = await manager.cleanupExpiredSessions();

      expect(count).toBe(0);
    });
  });

  describe("getActiveSessionCount", () => {
    it("returns 0 when no sessions", async () => {
      const manager = createManager();

      expect(await manager.getActiveSessionCount()).toBe(0);
    });

    it("counts active sessions", async () => {
      const manager = createManager();

      await manager.getOrCreateSession("C001");
      await manager.getOrCreateSession("C002");

      expect(await manager.getActiveSessionCount()).toBe(2);
    });
  });

  describe("persistence", () => {
    it("persists state to YAML file", async () => {
      const manager = createManager();

      await manager.getOrCreateSession("C0123456789");

      const filePath = join(
        tempDir,
        "slack-sessions",
        "test-agent.yaml"
      );
      const content = await readFile(filePath, "utf-8");

      expect(content).toContain("version: 2");
      expect(content).toContain("agentName: test-agent");
      expect(content).toContain("C0123456789");
    });

    it("survives recreation with same state dir", async () => {
      const manager1 = createManager();
      const result1 = await manager1.getOrCreateSession("C0123456789");

      // Create new manager pointing to same dir
      const manager2 = createManager();
      const result2 = await manager2.getOrCreateSession("C0123456789");

      expect(result2.isNew).toBe(false);
      expect(result2.sessionId).toBe(result1.sessionId);
    });
  });
});

describe("Session manager types", () => {
  describe("createInitialSessionState", () => {
    it("creates state with empty channels", () => {
      const state = createInitialSessionState("my-agent");

      expect(state.version).toBe(2);
      expect(state.agentName).toBe("my-agent");
      expect(state.channels).toEqual({});
    });
  });

  describe("createChannelSession", () => {
    it("creates channel session", () => {
      const session = createChannelSession("session-123");

      expect(session.sessionId).toBe("session-123");
      expect(session.lastMessageAt).toBeDefined();
    });
  });
});

describe("Session manager errors", () => {
  it("SessionManagerError has correct properties", () => {
    const error = new SessionManagerError(
      "test error",
      SessionErrorCode.STATE_READ_FAILED,
      "test-agent"
    );

    expect(error.message).toBe("test error");
    expect(error.code).toBe(SessionErrorCode.STATE_READ_FAILED);
    expect(error.agentName).toBe("test-agent");
    expect(error.name).toBe("SessionManagerError");
  });

  it("SessionStateReadError has formatted message", () => {
    const error = new SessionStateReadError("test-agent", "/path/to/state");

    expect(error.message).toContain("test-agent");
    expect(error.message).toContain("/path/to/state");
    expect(error.code).toBe(SessionErrorCode.STATE_READ_FAILED);
  });

  it("SessionStateWriteError has formatted message", () => {
    const error = new SessionStateWriteError("test-agent", "/path/to/state");

    expect(error.message).toContain("test-agent");
    expect(error.code).toBe(SessionErrorCode.STATE_WRITE_FAILED);
  });

  it("SessionDirectoryCreateError has formatted message", () => {
    const error = new SessionDirectoryCreateError("test-agent", "/path/to/dir");

    expect(error.message).toContain("test-agent");
    expect(error.code).toBe(SessionErrorCode.DIRECTORY_CREATE_FAILED);
  });
});
