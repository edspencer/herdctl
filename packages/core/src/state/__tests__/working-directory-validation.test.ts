/**
 * Tests for working directory validation
 */

import { describe, it, expect } from "vitest";
import { validateWorkingDirectory } from "../working-directory-validation.js";
import type { SessionInfo } from "../schemas/session-info.js";

describe("validateWorkingDirectory", () => {
  const baseSession: SessionInfo = {
    agent_name: "test-agent",
    session_id: "test-session-123",
    created_at: "2026-01-01T00:00:00Z",
    last_used_at: "2026-01-01T00:00:00Z",
    job_count: 1,
    mode: "autonomous",
    runtime_type: "sdk",
    docker_enabled: false,
  };

  describe("when session is null", () => {
    it("returns valid=true", () => {
      const result = validateWorkingDirectory(null, "/some/path");
      expect(result.valid).toBe(true);
    });
  });

  describe("when both working directories are undefined", () => {
    it("returns valid=true (backward compat)", () => {
      const session: SessionInfo = {
        ...baseSession,
        working_directory: undefined,
      };
      const result = validateWorkingDirectory(session, undefined);
      expect(result.valid).toBe(true);
    });
  });

  describe("when working directory changed from undefined to defined", () => {
    it("returns valid=false with change reason", () => {
      const session: SessionInfo = {
        ...baseSession,
        working_directory: undefined,
      };
      const result = validateWorkingDirectory(session, "/new/path");

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("changed");
      expect(result.message).toContain("undefined");
      expect(result.message).toContain("/new/path");
      expect(result.oldPath).toBeUndefined();
      expect(result.newPath).toBe("/new/path");
    });
  });

  describe("when working directory changed from defined to undefined", () => {
    it("returns valid=false with change reason", () => {
      const session: SessionInfo = {
        ...baseSession,
        working_directory: "/old/path",
      };
      const result = validateWorkingDirectory(session, undefined);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("changed");
      expect(result.message).toContain("/old/path");
      expect(result.message).toContain("undefined");
      expect(result.oldPath).toBe("/old/path");
      expect(result.newPath).toBeUndefined();
    });
  });

  describe("when working directory changed to a different path", () => {
    it("returns valid=false with change reason", () => {
      const session: SessionInfo = {
        ...baseSession,
        working_directory: "/old/path",
      };
      const result = validateWorkingDirectory(session, "/new/path");

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("changed");
      expect(result.message).toContain("/old/path");
      expect(result.message).toContain("/new/path");
      expect(result.oldPath).toBe("/old/path");
      expect(result.newPath).toBe("/new/path");
    });
  });

  describe("when working directory is the same", () => {
    it("returns valid=true", () => {
      const session: SessionInfo = {
        ...baseSession,
        working_directory: "/same/path",
      };
      const result = validateWorkingDirectory(session, "/same/path");

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.message).toBeUndefined();
    });
  });

  describe("message content", () => {
    it("includes both old and new paths in message", () => {
      const session: SessionInfo = {
        ...baseSession,
        working_directory: "/users/ed/herds",
      };
      const result = validateWorkingDirectory(session, "/users/ed/herds/personal/homelab");

      expect(result.message).toBe(
        "Working directory changed from /users/ed/herds to /users/ed/herds/personal/homelab"
      );
    });
  });
});
