import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, realpath, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getSessionInfo,
  updateSessionInfo,
  clearSession,
  type SessionLogger,
} from "../session.js";
import { type SessionInfo } from "../schemas/session-info.js";
import { StateFileError } from "../errors.js";

// Helper to create a temp directory
async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-session-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(baseDir, { recursive: true });
  // Resolve to real path to handle macOS /var -> /private/var symlink
  return await realpath(baseDir);
}

// Helper to create a mock logger
function createMockLogger(): SessionLogger & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    warn: (message: string) => warnings.push(message),
  };
}

// Helper to create a valid session JSON file
async function writeSessionFile(
  dir: string,
  agentName: string,
  session: SessionInfo
): Promise<string> {
  const filePath = join(dir, `${agentName}.json`);
  await writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");
  return filePath;
}

// Helper to create a valid session object
function createValidSession(agentName: string): SessionInfo {
  const now = new Date().toISOString();
  return {
    agent_name: agentName,
    session_id: `session-${Math.random().toString(36).slice(2)}`,
    created_at: now,
    last_used_at: now,
    job_count: 0,
    mode: "autonomous",
    runtime_type: "sdk",
    docker_enabled: false,
  };
}

describe("getSessionInfo", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns session info when file exists", async () => {
    const session = createValidSession("test-agent");
    await writeSessionFile(tempDir, "test-agent", session);

    const result = await getSessionInfo(tempDir, "test-agent");

    expect(result).not.toBeNull();
    expect(result!.agent_name).toBe("test-agent");
    expect(result!.session_id).toBe(session.session_id);
    expect(result!.mode).toBe("autonomous");
  });

  it("returns null for non-existent session (handles missing file gracefully)", async () => {
    const result = await getSessionInfo(tempDir, "non-existent-agent");
    expect(result).toBeNull();
  });

  it("returns null for empty sessions directory", async () => {
    const result = await getSessionInfo(tempDir, "any-agent");
    expect(result).toBeNull();
  });

  it("returns null and logs warning for corrupted session file", async () => {
    const logger = createMockLogger();
    const corruptedPath = join(tempDir, "corrupted-agent.json");
    await writeFile(corruptedPath, "{ invalid json", "utf-8");

    const result = await getSessionInfo(tempDir, "corrupted-agent", { logger });

    expect(result).toBeNull();
    expect(logger.warnings.length).toBeGreaterThan(0);
  });

  it("returns null for session with invalid schema", async () => {
    const logger = createMockLogger();
    const invalidSession = {
      agent_name: "", // Invalid: empty
      session_id: "valid-session",
      created_at: "2024-01-15T10:00:00Z",
      last_used_at: "2024-01-15T10:00:00Z",
      job_count: 0,
      mode: "autonomous",
    };
    await writeSessionFile(tempDir, "invalid-agent", invalidSession as SessionInfo);

    const result = await getSessionInfo(tempDir, "invalid-agent", { logger });

    expect(result).toBeNull();
    expect(logger.warnings.length).toBeGreaterThan(0);
  });

  it("returns null for session with invalid mode", async () => {
    const logger = createMockLogger();
    const invalidSession = {
      agent_name: "test-agent",
      session_id: "valid-session",
      created_at: "2024-01-15T10:00:00Z",
      last_used_at: "2024-01-15T10:00:00Z",
      job_count: 0,
      mode: "invalid-mode",
    };
    await writeSessionFile(tempDir, "test-agent", invalidSession as SessionInfo);

    const result = await getSessionInfo(tempDir, "test-agent", { logger });

    expect(result).toBeNull();
    expect(logger.warnings.length).toBeGreaterThan(0);
  });

  it("returns null for session with invalid datetime format", async () => {
    const logger = createMockLogger();
    const invalidSession = {
      agent_name: "test-agent",
      session_id: "valid-session",
      created_at: "not-a-date",
      last_used_at: "2024-01-15T10:00:00Z",
      job_count: 0,
      mode: "autonomous",
    };
    await writeSessionFile(tempDir, "test-agent", invalidSession as SessionInfo);

    const result = await getSessionInfo(tempDir, "test-agent", { logger });

    expect(result).toBeNull();
    expect(logger.warnings.length).toBeGreaterThan(0);
  });

  it("validates all session fields correctly", async () => {
    const session: SessionInfo = {
      agent_name: "full-test-agent",
      session_id: "claude-session-abc123",
      created_at: "2024-01-15T10:00:00.000Z",
      last_used_at: "2024-01-15T12:30:00.000Z",
      job_count: 5,
      mode: "interactive",
      runtime_type: "sdk",
      docker_enabled: false,
    };
    await writeSessionFile(tempDir, "full-test-agent", session);

    const result = await getSessionInfo(tempDir, "full-test-agent");

    expect(result).not.toBeNull();
    expect(result!.agent_name).toBe("full-test-agent");
    expect(result!.session_id).toBe("claude-session-abc123");
    expect(result!.created_at).toBe("2024-01-15T10:00:00.000Z");
    expect(result!.last_used_at).toBe("2024-01-15T12:30:00.000Z");
    expect(result!.job_count).toBe(5);
    expect(result!.mode).toBe("interactive");
  });

  it("handles all valid session modes", async () => {
    const modes = ["autonomous", "interactive", "review"] as const;

    for (const mode of modes) {
      const session = createValidSession(`${mode}-agent`);
      session.mode = mode;
      await writeSessionFile(tempDir, `${mode}-agent`, session);

      const result = await getSessionInfo(tempDir, `${mode}-agent`);
      expect(result).not.toBeNull();
      expect(result!.mode).toBe(mode);
    }
  });

  describe("session expiry validation", () => {
    it("returns session when not expired (no timeout option)", async () => {
      const session = createValidSession("test-agent");
      await writeSessionFile(tempDir, "test-agent", session);

      const result = await getSessionInfo(tempDir, "test-agent");
      expect(result).not.toBeNull();
      expect(result!.session_id).toBe(session.session_id);
    });

    it("returns session when not expired (within timeout)", async () => {
      const session = createValidSession("test-agent");
      await writeSessionFile(tempDir, "test-agent", session);

      // Session just created, should be valid with 1h timeout
      const result = await getSessionInfo(tempDir, "test-agent", { timeout: "1h" });
      expect(result).not.toBeNull();
      expect(result!.session_id).toBe(session.session_id);
    });

    it("returns null and clears expired session", async () => {
      const logger = createMockLogger();
      // Create a session that's 2 hours old
      const session = createValidSession("expired-agent");
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      session.last_used_at = twoHoursAgo;
      await writeSessionFile(tempDir, "expired-agent", session);

      // With 1h timeout, session should be expired
      const result = await getSessionInfo(tempDir, "expired-agent", {
        timeout: "1h",
        logger,
      });

      expect(result).toBeNull();
      expect(logger.warnings.some((w) => w.includes("expired"))).toBe(true);

      // Verify session file was cleared
      const afterClear = await getSessionInfo(tempDir, "expired-agent");
      expect(afterClear).toBeNull();
    });

    it("returns session with invalid timeout format (warns but doesn't fail)", async () => {
      const logger = createMockLogger();
      const session = createValidSession("test-agent");
      await writeSessionFile(tempDir, "test-agent", session);

      // Invalid timeout format should warn but still return the session
      const result = await getSessionInfo(tempDir, "test-agent", {
        timeout: "invalid",
        logger,
      });

      expect(result).not.toBeNull();
      expect(result!.session_id).toBe(session.session_id);
      expect(logger.warnings.some((w) => w.includes("Invalid timeout"))).toBe(true);
    });

    it("handles 24h default timeout correctly", async () => {
      // Create a session that's 23 hours old (should be valid)
      const session = createValidSession("almost-expired-agent");
      const twentyThreeHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
      session.last_used_at = twentyThreeHoursAgo;
      await writeSessionFile(tempDir, "almost-expired-agent", session);

      const result = await getSessionInfo(tempDir, "almost-expired-agent", { timeout: "24h" });
      expect(result).not.toBeNull();

      // Create a session that's 25 hours old (should be expired)
      const expiredSession = createValidSession("definitely-expired-agent");
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      expiredSession.last_used_at = twentyFiveHoursAgo;
      await writeSessionFile(tempDir, "definitely-expired-agent", expiredSession);

      const expiredResult = await getSessionInfo(tempDir, "definitely-expired-agent", { timeout: "24h" });
      expect(expiredResult).toBeNull();
    });
  });
});

describe("updateSessionInfo", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates new session when none exists", async () => {
    const result = await updateSessionInfo(tempDir, "new-agent", {
      session_id: "new-session-123",
      mode: "autonomous",
    });

    expect(result.agent_name).toBe("new-agent");
    expect(result.session_id).toBe("new-session-123");
    expect(result.mode).toBe("autonomous");
    expect(result.job_count).toBe(0);

    // Verify file was created
    const content = await readFile(join(tempDir, "new-agent.json"), "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.agent_name).toBe("new-agent");
  });

  it("throws StateFileError when creating session without session_id", async () => {
    await expect(
      updateSessionInfo(tempDir, "new-agent", {
        mode: "autonomous",
      })
    ).rejects.toThrow(StateFileError);
  });

  it("updates existing session", async () => {
    const existingSession = createValidSession("test-agent");
    existingSession.job_count = 3;
    await writeSessionFile(tempDir, "test-agent", existingSession);

    const updated = await updateSessionInfo(tempDir, "test-agent", {
      job_count: 5,
      mode: "interactive",
    });

    expect(updated.job_count).toBe(5);
    expect(updated.mode).toBe("interactive");
    expect(updated.session_id).toBe(existingSession.session_id); // Preserved
    expect(updated.created_at).toBe(existingSession.created_at); // Preserved
  });

  it("automatically updates last_used_at", async () => {
    const existingSession = createValidSession("test-agent");
    const originalLastUsed = existingSession.last_used_at;
    await writeSessionFile(tempDir, "test-agent", existingSession);

    // Wait a bit to ensure timestamp differs
    await new Promise((resolve) => setTimeout(resolve, 10));

    const updated = await updateSessionInfo(tempDir, "test-agent", {
      job_count: 1,
    });

    expect(updated.last_used_at).not.toBe(originalLastUsed);
    expect(new Date(updated.last_used_at).getTime()).toBeGreaterThan(
      new Date(originalLastUsed).getTime()
    );
  });

  it("preserves agent_name even if update tries to change it", async () => {
    const existingSession = createValidSession("original-agent");
    await writeSessionFile(tempDir, "original-agent", existingSession);

    const updated = await updateSessionInfo(tempDir, "original-agent", {
      session_id: "new-session",
    });

    expect(updated.agent_name).toBe("original-agent");
  });

  it("preserves created_at even if update tries to change it", async () => {
    const existingSession = createValidSession("test-agent");
    const originalCreatedAt = existingSession.created_at;
    await writeSessionFile(tempDir, "test-agent", existingSession);

    const updated = await updateSessionInfo(tempDir, "test-agent", {
      job_count: 1,
    });

    expect(updated.created_at).toBe(originalCreatedAt);
  });

  it("updates session_id when provided", async () => {
    const existingSession = createValidSession("test-agent");
    await writeSessionFile(tempDir, "test-agent", existingSession);

    const updated = await updateSessionInfo(tempDir, "test-agent", {
      session_id: "new-session-456",
    });

    expect(updated.session_id).toBe("new-session-456");
  });

  it("handles corrupted existing file by treating as new", async () => {
    const corruptedPath = join(tempDir, "corrupted-agent.json");
    await writeFile(corruptedPath, "{ invalid json", "utf-8");

    const updated = await updateSessionInfo(tempDir, "corrupted-agent", {
      session_id: "fresh-session",
      mode: "autonomous",
    });

    expect(updated.agent_name).toBe("corrupted-agent");
    expect(updated.session_id).toBe("fresh-session");
  });

  it("throws StateFileError when directory does not exist", async () => {
    const nonExistentDir = join(tempDir, "does-not-exist");

    await expect(
      updateSessionInfo(nonExistentDir, "test-agent", {
        session_id: "test-session",
      })
    ).rejects.toThrow(StateFileError);
  });

  it("persists all fields correctly", async () => {
    await updateSessionInfo(tempDir, "test-agent", {
      session_id: "session-abc",
      mode: "review",
      job_count: 10,
    });

    // Read file directly and verify
    const content = await readFile(join(tempDir, "test-agent.json"), "utf-8");
    const parsed = JSON.parse(content);

    expect(parsed.agent_name).toBe("test-agent");
    expect(parsed.session_id).toBe("session-abc");
    expect(parsed.mode).toBe("review");
    expect(parsed.job_count).toBe(10);
    expect(parsed.created_at).toBeDefined();
    expect(parsed.last_used_at).toBeDefined();
  });

  it("handles multiple sequential updates", async () => {
    await updateSessionInfo(tempDir, "test-agent", {
      session_id: "session-1",
    });

    await updateSessionInfo(tempDir, "test-agent", {
      job_count: 1,
    });

    await updateSessionInfo(tempDir, "test-agent", {
      mode: "interactive",
    });

    const final = await getSessionInfo(tempDir, "test-agent");
    expect(final!.session_id).toBe("session-1");
    expect(final!.job_count).toBe(1);
    expect(final!.mode).toBe("interactive");
  });
});

describe("clearSession", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("deletes existing session and returns true", async () => {
    const session = createValidSession("test-agent");
    await writeSessionFile(tempDir, "test-agent", session);

    const deleted = await clearSession(tempDir, "test-agent");

    expect(deleted).toBe(true);

    // Verify file is gone
    const retrieved = await getSessionInfo(tempDir, "test-agent");
    expect(retrieved).toBeNull();
  });

  it("returns false for non-existent session", async () => {
    const deleted = await clearSession(tempDir, "non-existent-agent");
    expect(deleted).toBe(false);
  });

  it("does not affect other sessions", async () => {
    const session1 = createValidSession("agent-1");
    const session2 = createValidSession("agent-2");
    await writeSessionFile(tempDir, "agent-1", session1);
    await writeSessionFile(tempDir, "agent-2", session2);

    await clearSession(tempDir, "agent-1");

    const remaining = await getSessionInfo(tempDir, "agent-2");
    expect(remaining).not.toBeNull();
    expect(remaining!.agent_name).toBe("agent-2");
  });

  it("allows creating new session after clearing", async () => {
    const session = createValidSession("test-agent");
    await writeSessionFile(tempDir, "test-agent", session);

    await clearSession(tempDir, "test-agent");

    const newSession = await updateSessionInfo(tempDir, "test-agent", {
      session_id: "new-session-after-clear",
    });

    expect(newSession.session_id).toBe("new-session-after-clear");
    expect(newSession.job_count).toBe(0); // Fresh session
  });
});

describe("SessionInfoSchema validation", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects negative job_count", async () => {
    const logger = createMockLogger();
    const invalidSession = {
      agent_name: "test-agent",
      session_id: "valid-session",
      created_at: "2024-01-15T10:00:00Z",
      last_used_at: "2024-01-15T10:00:00Z",
      job_count: -1,
      mode: "autonomous",
    };
    await writeSessionFile(tempDir, "test-agent", invalidSession as SessionInfo);

    const result = await getSessionInfo(tempDir, "test-agent", { logger });
    expect(result).toBeNull();
  });

  it("rejects non-integer job_count", async () => {
    const logger = createMockLogger();
    const invalidSession = {
      agent_name: "test-agent",
      session_id: "valid-session",
      created_at: "2024-01-15T10:00:00Z",
      last_used_at: "2024-01-15T10:00:00Z",
      job_count: 1.5,
      mode: "autonomous",
    };
    await writeSessionFile(tempDir, "test-agent", invalidSession as SessionInfo);

    const result = await getSessionInfo(tempDir, "test-agent", { logger });
    expect(result).toBeNull();
  });

  it("rejects empty session_id", async () => {
    const logger = createMockLogger();
    const invalidSession = {
      agent_name: "test-agent",
      session_id: "",
      created_at: "2024-01-15T10:00:00Z",
      last_used_at: "2024-01-15T10:00:00Z",
      job_count: 0,
      mode: "autonomous",
    };
    await writeSessionFile(tempDir, "test-agent", invalidSession as SessionInfo);

    const result = await getSessionInfo(tempDir, "test-agent", { logger });
    expect(result).toBeNull();
  });
});

describe("atomic write behavior", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("does not leave temp files on successful write", async () => {
    await updateSessionInfo(tempDir, "test-agent", {
      session_id: "test-session",
    });

    const { readdir } = await import("node:fs/promises");
    const files = await readdir(tempDir);
    const tempFiles = files.filter((f) => f.includes(".tmp."));
    expect(tempFiles).toHaveLength(0);
  });

  it("creates valid JSON file", async () => {
    await updateSessionInfo(tempDir, "test-agent", {
      session_id: "test-session",
    });

    const content = await readFile(join(tempDir, "test-agent.json"), "utf-8");
    // Should not throw
    const parsed = JSON.parse(content);
    expect(parsed).toBeDefined();
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

  it("handles multiple concurrent reads", async () => {
    const session = createValidSession("test-agent");
    await writeSessionFile(tempDir, "test-agent", session);

    const reads = [];
    for (let i = 0; i < 50; i++) {
      reads.push(getSessionInfo(tempDir, "test-agent"));
    }

    const results = await Promise.all(reads);

    for (const result of results) {
      expect(result).not.toBeNull();
      expect(result!.agent_name).toBe("test-agent");
    }
  });

  it("handles sequential updates correctly", async () => {
    await updateSessionInfo(tempDir, "test-agent", {
      session_id: "initial-session",
    });

    for (let i = 0; i < 10; i++) {
      await updateSessionInfo(tempDir, "test-agent", {
        job_count: i + 1,
      });
    }

    const final = await getSessionInfo(tempDir, "test-agent");
    expect(final!.job_count).toBe(10);
  });

  it("handles multiple agents concurrently", async () => {
    const updates = [];
    for (let i = 0; i < 10; i++) {
      updates.push(
        updateSessionInfo(tempDir, `agent-${i}`, {
          session_id: `session-${i}`,
        })
      );
    }

    const results = await Promise.all(updates);

    expect(results).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(results[i].agent_name).toBe(`agent-${i}`);
      expect(results[i].session_id).toBe(`session-${i}`);
    }
  });
});

describe("file path handling", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("stores sessions at correct path", async () => {
    await updateSessionInfo(tempDir, "my-agent", {
      session_id: "test-session",
    });

    const expectedPath = join(tempDir, "my-agent.json");
    const content = await readFile(expectedPath, "utf-8");
    expect(content).toContain("my-agent");
  });

  it("handles agent names with special characters", async () => {
    // Agent names with dashes and underscores
    await updateSessionInfo(tempDir, "my-special_agent-123", {
      session_id: "test-session",
    });

    const result = await getSessionInfo(tempDir, "my-special_agent-123");
    expect(result).not.toBeNull();
    expect(result!.agent_name).toBe("my-special_agent-123");
  });
});
