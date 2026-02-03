import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseTimeout,
  validateSession,
  validateRuntimeContext,
  formatDuration,
  isSessionExpiredError,
  cleanupExpiredSessions,
  DEFAULT_SESSION_TIMEOUT_MS,
} from "../session-validation.js";
import { type SessionInfo } from "../schemas/session-info.js";

// Helper to create a temp directory
async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-session-validation-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(baseDir, { recursive: true });
  // Resolve to real path to handle macOS /var -> /private/var symlink
  return await realpath(baseDir);
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

// Helper to create a session with a specific last_used_at time
function createSessionWithAge(
  agentName: string,
  ageMs: number
): SessionInfo {
  const now = Date.now();
  const lastUsedAt = new Date(now - ageMs).toISOString();
  const createdAt = new Date(now - ageMs - 60000).toISOString(); // 1 minute before last used

  return {
    agent_name: agentName,
    session_id: `session-${Math.random().toString(36).slice(2)}`,
    created_at: createdAt,
    last_used_at: lastUsedAt,
    job_count: 1,
    mode: "autonomous",
    runtime_type: "sdk",
    docker_enabled: false,
  };
}

describe("parseTimeout", () => {
  it("parses seconds correctly", () => {
    expect(parseTimeout("30s")).toBe(30 * 1000);
    expect(parseTimeout("1s")).toBe(1000);
    expect(parseTimeout("60s")).toBe(60 * 1000);
  });

  it("parses minutes correctly", () => {
    expect(parseTimeout("5m")).toBe(5 * 60 * 1000);
    expect(parseTimeout("30m")).toBe(30 * 60 * 1000);
    expect(parseTimeout("60m")).toBe(60 * 60 * 1000);
  });

  it("parses hours correctly", () => {
    expect(parseTimeout("1h")).toBe(60 * 60 * 1000);
    expect(parseTimeout("24h")).toBe(24 * 60 * 60 * 1000);
    expect(parseTimeout("48h")).toBe(48 * 60 * 60 * 1000);
  });

  it("parses days correctly", () => {
    expect(parseTimeout("1d")).toBe(24 * 60 * 60 * 1000);
    expect(parseTimeout("7d")).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("parses weeks correctly", () => {
    expect(parseTimeout("1w")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseTimeout("2w")).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("handles decimal values", () => {
    expect(parseTimeout("1.5h")).toBe(1.5 * 60 * 60 * 1000);
    expect(parseTimeout("0.5d")).toBe(12 * 60 * 60 * 1000);
  });

  it("returns null for invalid formats", () => {
    expect(parseTimeout("")).toBeNull();
    expect(parseTimeout("invalid")).toBeNull();
    expect(parseTimeout("30")).toBeNull();
    expect(parseTimeout("m30")).toBeNull();
    expect(parseTimeout("30 m")).toBeNull();
    expect(parseTimeout("30x")).toBeNull();
    expect(parseTimeout("-5m")).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats seconds", () => {
    expect(formatDuration(5000)).toBe("5s");
    expect(formatDuration(30000)).toBe("30s");
  });

  it("formats minutes", () => {
    expect(formatDuration(60 * 1000)).toBe("1m");
    expect(formatDuration(5 * 60 * 1000)).toBe("5m");
    expect(formatDuration(30 * 60 * 1000)).toBe("30m");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(60 * 60 * 1000)).toBe("1h 0m");
    expect(formatDuration(90 * 60 * 1000)).toBe("1h 30m");
    expect(formatDuration(2 * 60 * 60 * 1000)).toBe("2h 0m");
  });

  it("formats days and hours", () => {
    expect(formatDuration(24 * 60 * 60 * 1000)).toBe("1d 0h");
    expect(formatDuration(36 * 60 * 60 * 1000)).toBe("1d 12h");
    expect(formatDuration(48 * 60 * 60 * 1000)).toBe("2d 0h");
  });
});

describe("validateSession", () => {
  it("returns missing for null session", () => {
    const result = validateSession(null);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing");
  });

  it("returns invalid_timeout for bad timeout format", () => {
    const session = createSessionWithAge("test-agent", 60000); // 1 minute old
    const result = validateSession(session, "invalid");

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_timeout");
    expect(result.message).toContain("Invalid timeout format");
  });

  it("returns valid for fresh session", () => {
    const session = createSessionWithAge("test-agent", 5 * 60 * 1000); // 5 minutes old
    const result = validateSession(session, "1h"); // 1 hour timeout

    expect(result.valid).toBe(true);
    expect(result.ageMs).toBeGreaterThan(0);
    expect(result.timeoutMs).toBe(60 * 60 * 1000);
  });

  it("returns expired for old session", () => {
    const session = createSessionWithAge("test-agent", 2 * 60 * 60 * 1000); // 2 hours old
    const result = validateSession(session, "1h"); // 1 hour timeout

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
    expect(result.message).toContain("Session expired");
    expect(result.ageMs).toBeGreaterThan(2 * 60 * 60 * 1000 - 1000);
    expect(result.timeoutMs).toBe(60 * 60 * 1000);
  });

  it("uses default timeout when not specified", () => {
    // Session older than default (24h)
    const session = createSessionWithAge("test-agent", 25 * 60 * 60 * 1000); // 25 hours old
    const result = validateSession(session);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
    expect(result.timeoutMs).toBe(DEFAULT_SESSION_TIMEOUT_MS);
  });

  it("session just within timeout is valid", () => {
    // Session at 55 minutes with 1 hour timeout
    const session = createSessionWithAge("test-agent", 55 * 60 * 1000);
    const result = validateSession(session, "1h");

    expect(result.valid).toBe(true);
  });

  it("session just past timeout is expired", () => {
    // Session at 61 minutes with 1 hour timeout
    const session = createSessionWithAge("test-agent", 61 * 60 * 1000);
    const result = validateSession(session, "1h");

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
  });

  it("returns expired for invalid last_used_at timestamp", () => {
    const session: SessionInfo = {
      agent_name: "test-agent",
      session_id: "session-123",
      created_at: new Date().toISOString(),
      last_used_at: "invalid-date-string",
      job_count: 1,
      mode: "autonomous",
      runtime_type: "sdk",
      docker_enabled: false,
    };

    const result = validateSession(session, "1h");

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
    expect(result.message).toContain("invalid last_used_at timestamp");
  });

  it("handles future timestamp (clock skew) as valid", () => {
    // Create a session with last_used_at in the future (simulating clock skew)
    const futureTime = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour in future
    const session: SessionInfo = {
      agent_name: "test-agent",
      session_id: "session-123",
      created_at: new Date().toISOString(),
      last_used_at: futureTime,
      job_count: 1,
      mode: "autonomous",
      runtime_type: "sdk",
      docker_enabled: false,
    };

    const result = validateSession(session, "1h");

    expect(result.valid).toBe(true);
    expect(result.ageMs).toBe(0); // Reported as just used
  });
});

describe("isSessionExpiredError", () => {
  it("detects session expired error", () => {
    expect(isSessionExpiredError(new Error("Session expired"))).toBe(true);
    expect(isSessionExpiredError(new Error("session_expired"))).toBe(true);
    expect(isSessionExpiredError(new Error("The session has expired"))).toBe(true);
    expect(isSessionExpiredError(new Error("Stale session detected"))).toBe(true);
  });

  it("detects session not found error", () => {
    expect(isSessionExpiredError(new Error("Session not found"))).toBe(true);
    expect(isSessionExpiredError(new Error("session not found for id abc"))).toBe(true);
    expect(isSessionExpiredError(new Error("Session does not exist"))).toBe(true);
    expect(isSessionExpiredError(new Error("Session ID xyz not found"))).toBe(true);
  });

  it("detects invalid session error", () => {
    expect(isSessionExpiredError(new Error("Invalid session"))).toBe(true);
    expect(isSessionExpiredError(new Error("invalid session id"))).toBe(true);
  });

  it("detects conversation not found error", () => {
    expect(isSessionExpiredError(new Error("Conversation not found"))).toBe(true);
    expect(isSessionExpiredError(new Error("No conversation with that ID"))).toBe(true);
    expect(isSessionExpiredError(new Error("Conversation does not exist"))).toBe(true);
    expect(isSessionExpiredError(new Error("Invalid conversation ID"))).toBe(true);
  });

  it("detects resume failed error", () => {
    expect(isSessionExpiredError(new Error("Resume failed"))).toBe(true);
    expect(isSessionExpiredError(new Error("Failed to resume session"))).toBe(true);
    expect(isSessionExpiredError(new Error("Cannot resume conversation"))).toBe(true);
    expect(isSessionExpiredError(new Error("Unable to resume session"))).toBe(true);
    expect(isSessionExpiredError(new Error("Could not resume the conversation"))).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isSessionExpiredError(new Error("Network timeout"))).toBe(false);
    expect(isSessionExpiredError(new Error("Rate limit exceeded"))).toBe(false);
    expect(isSessionExpiredError(new Error("Invalid API key"))).toBe(false);
    expect(isSessionExpiredError(new Error("Connection refused"))).toBe(false);
    expect(isSessionExpiredError(new Error("Internal server error"))).toBe(false);
  });

  it("detects session expired via error code", () => {
    const sessionExpiredError = new Error("Error occurred") as NodeJS.ErrnoException;
    sessionExpiredError.code = "SESSION_EXPIRED";
    expect(isSessionExpiredError(sessionExpiredError)).toBe(true);

    const invalidSessionError = new Error("Error occurred") as NodeJS.ErrnoException;
    invalidSessionError.code = "INVALID_SESSION";
    expect(isSessionExpiredError(invalidSessionError)).toBe(true);

    const sessionNotFoundError = new Error("Error occurred") as NodeJS.ErrnoException;
    sessionNotFoundError.code = "SESSION_NOT_FOUND";
    expect(isSessionExpiredError(sessionNotFoundError)).toBe(true);
  });

  it("detects conversation errors via error code", () => {
    const conversationExpiredError = new Error("Error occurred") as NodeJS.ErrnoException;
    conversationExpiredError.code = "CONVERSATION_EXPIRED";
    expect(isSessionExpiredError(conversationExpiredError)).toBe(true);

    const conversationNotFoundError = new Error("Error occurred") as NodeJS.ErrnoException;
    conversationNotFoundError.code = "conversation_not_found";
    expect(isSessionExpiredError(conversationNotFoundError)).toBe(true);
  });

  it("returns false for unrelated error codes", () => {
    const networkError = new Error("Network error") as NodeJS.ErrnoException;
    networkError.code = "ECONNREFUSED";
    expect(isSessionExpiredError(networkError)).toBe(false);

    const timeoutError = new Error("Timeout") as NodeJS.ErrnoException;
    timeoutError.code = "ETIMEDOUT";
    expect(isSessionExpiredError(timeoutError)).toBe(false);
  });
});

describe("cleanupExpiredSessions", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("removes expired sessions", async () => {
    // Create an expired session (2 hours old with 1 hour timeout)
    const expiredSession = createSessionWithAge("expired-agent", 2 * 60 * 60 * 1000);
    await writeSessionFile(tempDir, "expired-agent", expiredSession);

    // Create a valid session (5 minutes old with 1 hour timeout)
    const validSession = createSessionWithAge("valid-agent", 5 * 60 * 1000);
    await writeSessionFile(tempDir, "valid-agent", validSession);

    const result = await cleanupExpiredSessions(tempDir, "1h", {
      logger: { info: () => {}, warn: () => {} },
    });

    expect(result.removed).toBe(1);
    expect(result.kept).toBe(1);
    expect(result.removedAgents).toContain("expired-agent");
    expect(result.removedAgents).not.toContain("valid-agent");
  });

  it("keeps all valid sessions", async () => {
    const session1 = createSessionWithAge("agent-1", 10 * 60 * 1000); // 10 min
    const session2 = createSessionWithAge("agent-2", 20 * 60 * 1000); // 20 min
    await writeSessionFile(tempDir, "agent-1", session1);
    await writeSessionFile(tempDir, "agent-2", session2);

    const result = await cleanupExpiredSessions(tempDir, "1h", {
      logger: { info: () => {}, warn: () => {} },
    });

    expect(result.removed).toBe(0);
    expect(result.kept).toBe(2);
    expect(result.removedAgents).toHaveLength(0);
  });

  it("removes all expired sessions", async () => {
    const session1 = createSessionWithAge("agent-1", 2 * 60 * 60 * 1000); // 2 hours
    const session2 = createSessionWithAge("agent-2", 3 * 60 * 60 * 1000); // 3 hours
    await writeSessionFile(tempDir, "agent-1", session1);
    await writeSessionFile(tempDir, "agent-2", session2);

    const result = await cleanupExpiredSessions(tempDir, "1h", {
      logger: { info: () => {}, warn: () => {} },
    });

    expect(result.removed).toBe(2);
    expect(result.kept).toBe(0);
    expect(result.removedAgents).toContain("agent-1");
    expect(result.removedAgents).toContain("agent-2");
  });

  it("handles empty sessions directory", async () => {
    const result = await cleanupExpiredSessions(tempDir, "1h", {
      logger: { info: () => {}, warn: () => {} },
    });

    expect(result.removed).toBe(0);
    expect(result.kept).toBe(0);
    expect(result.removedAgents).toHaveLength(0);
  });

  it("supports dry run mode", async () => {
    const expiredSession = createSessionWithAge("expired-agent", 2 * 60 * 60 * 1000);
    await writeSessionFile(tempDir, "expired-agent", expiredSession);

    const result = await cleanupExpiredSessions(tempDir, "1h", {
      logger: { info: () => {}, warn: () => {} },
      dryRun: true,
    });

    expect(result.removed).toBe(1);
    expect(result.removedAgents).toContain("expired-agent");

    // Session should still exist (dry run)
    const { getSessionInfo } = await import("../session.js");
    const stillExists = await getSessionInfo(tempDir, "expired-agent");
    expect(stillExists).not.toBeNull();
  });

  it("uses default timeout when not specified", async () => {
    // Session older than default 24h
    const expiredSession = createSessionWithAge("expired-agent", 25 * 60 * 60 * 1000);
    await writeSessionFile(tempDir, "expired-agent", expiredSession);

    // Session younger than 24h
    const validSession = createSessionWithAge("valid-agent", 23 * 60 * 60 * 1000);
    await writeSessionFile(tempDir, "valid-agent", validSession);

    const result = await cleanupExpiredSessions(tempDir, undefined, {
      logger: { info: () => {}, warn: () => {} },
    });

    expect(result.removed).toBe(1);
    expect(result.kept).toBe(1);
    expect(result.removedAgents).toContain("expired-agent");
  });
});

describe("DEFAULT_SESSION_TIMEOUT_MS", () => {
  it("is 24 hours", () => {
    expect(DEFAULT_SESSION_TIMEOUT_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("validateRuntimeContext", () => {
  // Helper to create a session with runtime context
  function createSessionWithRuntime(
    runtimeType: "sdk" | "cli",
    dockerEnabled: boolean
  ): SessionInfo {
    const now = new Date().toISOString();
    return {
      agent_name: "test-agent",
      session_id: `session-${Math.random().toString(36).slice(2)}`,
      created_at: now,
      last_used_at: now,
      job_count: 1,
      mode: "autonomous",
      runtime_type: runtimeType,
      docker_enabled: dockerEnabled,
    };
  }

  it("validates session with matching runtime context", () => {
    const session = createSessionWithRuntime("sdk", false);
    const result = validateRuntimeContext(session, "sdk", false);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("validates CLI runtime with native execution", () => {
    const session = createSessionWithRuntime("cli", false);
    const result = validateRuntimeContext(session, "cli", false);
    expect(result.valid).toBe(true);
  });

  it("validates SDK runtime with Docker enabled", () => {
    const session = createSessionWithRuntime("sdk", true);
    const result = validateRuntimeContext(session, "sdk", true);
    expect(result.valid).toBe(true);
  });

  it("validates CLI runtime with Docker enabled", () => {
    const session = createSessionWithRuntime("cli", true);
    const result = validateRuntimeContext(session, "cli", true);
    expect(result.valid).toBe(true);
  });

  it("invalidates session when runtime type changes from SDK to CLI", () => {
    const session = createSessionWithRuntime("sdk", false);
    const result = validateRuntimeContext(session, "cli", false);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("runtime_mismatch");
    expect(result.message).toContain('Runtime type changed from "sdk" to "cli"');
  });

  it("invalidates session when runtime type changes from CLI to SDK", () => {
    const session = createSessionWithRuntime("cli", false);
    const result = validateRuntimeContext(session, "sdk", false);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("runtime_mismatch");
    expect(result.message).toContain('Runtime type changed from "cli" to "sdk"');
  });

  it("invalidates session when Docker is enabled after native session", () => {
    const session = createSessionWithRuntime("sdk", false);
    const result = validateRuntimeContext(session, "sdk", true);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("runtime_mismatch");
    expect(result.message).toContain("Docker context changed from native to Docker");
  });

  it("invalidates session when Docker is disabled after Docker session", () => {
    const session = createSessionWithRuntime("sdk", true);
    const result = validateRuntimeContext(session, "sdk", false);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("runtime_mismatch");
    expect(result.message).toContain("Docker context changed from Docker to native");
  });

  it("invalidates session when both runtime type and Docker change", () => {
    const session = createSessionWithRuntime("cli", true);
    const result = validateRuntimeContext(session, "sdk", false);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("runtime_mismatch");
    // Should fail on first check (runtime type)
    expect(result.message).toContain('Runtime type changed from "cli" to "sdk"');
  });

  it("returns invalid for null session", () => {
    const result = validateRuntimeContext(null, "sdk", false);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing");
    expect(result.message).toBe("No session found");
  });

  it("validates legacy session without runtime context (defaults to SDK native)", () => {
    // Legacy session missing runtime_type and docker_enabled fields
    // Schema defaults will apply when parsed
    const legacySession: SessionInfo = {
      agent_name: "legacy-agent",
      session_id: "legacy-session-id",
      created_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
      job_count: 5,
      mode: "autonomous",
      runtime_type: "sdk", // Schema defaults these
      docker_enabled: false,
    };

    const result = validateRuntimeContext(legacySession, "sdk", false);
    expect(result.valid).toBe(true);
  });

  it("invalidates legacy session when switching to Docker", () => {
    // Legacy session defaults to SDK native
    const legacySession: SessionInfo = {
      agent_name: "legacy-agent",
      session_id: "legacy-session-id",
      created_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
      job_count: 5,
      mode: "autonomous",
      runtime_type: "sdk",
      docker_enabled: false,
    };

    // Now trying to use with Docker enabled
    const result = validateRuntimeContext(legacySession, "sdk", true);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("runtime_mismatch");
    expect(result.message).toContain("Docker context changed from native to Docker");
  });
});
