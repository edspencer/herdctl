import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  encodePathForCli,
  getCliSessionDir,
  getCliSessionFile,
  getDockerSessionFile,
} from "../cli-session-path.js";

describe("encodePathForCli", () => {
  describe("Unix path encoding", () => {
    it("encodes forward slashes to hyphens", () => {
      expect(encodePathForCli("/home/user/project")).toBe("-home-user-project");
    });

    it("handles paths with multiple consecutive slashes", () => {
      expect(encodePathForCli("/path//double")).toBe("-path--double");
    });

    it("handles root path", () => {
      expect(encodePathForCli("/")).toBe("-");
    });

    it("handles relative path", () => {
      expect(encodePathForCli("relative/path")).toBe("relative-path");
    });

    it("handles deeply nested paths", () => {
      expect(encodePathForCli("/usr/local/share/project/src/components")).toBe(
        "-usr-local-share-project-src-components",
      );
    });

    it("handles path with trailing slash", () => {
      expect(encodePathForCli("/path/to/project/")).toBe("-path-to-project-");
    });

    it("handles path with special characters", () => {
      // Every non-alphanumeric character (including `_`) is encoded to a hyphen,
      // matching Claude Code's actual cwd -> transcript-dir encoding.
      expect(encodePathForCli("/path/to/my-project_v2")).toBe("-path-to-my-project-v2");
    });
  });

  // Claude Code encodes a cwd into its transcript directory under
  // ~/.claude/projects/<encoded>/ by replacing EVERY non-[A-Za-z0-9] character
  // with a hyphen (verified empirically against ~/.claude/projects and against
  // Claude Code's bundled encoder: `H.replace(/[^a-zA-Z0-9]/g, "-")`). These
  // cases pin herdctl's encoder to that rule so session discovery resolves the
  // correct directory for dotted/underscored/special-char working directories.
  describe("Claude Code non-alphanumeric encoding (dots, underscores, etc.)", () => {
    it("encodes a single dot to a hyphen", () => {
      // Real example: cwd `/Users/ed/Code/my.project` -> dir `-Users-ed-Code-my-project`
      expect(encodePathForCli("/Users/ed/Code/my.project")).toBe("-Users-ed-Code-my-project");
    });

    it("encodes multiple dots within a segment", () => {
      expect(encodePathForCli("/tmp/multi.dot.dir")).toBe("-tmp-multi-dot-dir");
    });

    it("encodes a leading dot in a path segment (producing a double hyphen)", () => {
      // The slash before `.leading` becomes `-` and the leading dot also becomes
      // `-`, yielding the `--leading` Claude Code actually creates.
      expect(encodePathForCli("/tmp/.leading")).toBe("-tmp--leading");
    });

    it("encodes a dotfile-style relative segment", () => {
      expect(encodePathForCli(".config/herdctl")).toBe("-config-herdctl");
    });

    it("encodes underscores to hyphens", () => {
      expect(encodePathForCli("/path/to/under_score")).toBe("-path-to-under-score");
    });

    it("encodes other special characters (@, +, ~, space) to hyphens", () => {
      expect(encodePathForCli("/tmp/at@sign")).toBe("-tmp-at-sign");
      expect(encodePathForCli("/tmp/plus+sign")).toBe("-tmp-plus-sign");
      expect(encodePathForCli("/tmp/tilde~here")).toBe("-tmp-tilde-here");
      expect(encodePathForCli("/tmp/with space")).toBe("-tmp-with-space");
    });

    it("matches the real ~/.claude/projects directory names for known paths", () => {
      // These two were observed directly under ~/.claude/projects/.
      expect(encodePathForCli("/Users/ed/herds/personal/homelab")).toBe(
        "-Users-ed-herds-personal-homelab",
      );
      expect(encodePathForCli("/Users/ed/Code/hushpod")).toBe("-Users-ed-Code-hushpod");
    });

    it("truncates very long encoded paths and appends a stable hash", () => {
      // Claude Code slices the encoded path to 200 chars and appends a hash of
      // the original path when it would otherwise exceed the limit.
      const longPath = `/${"a".repeat(250)}`;
      const encoded = encodePathForCli(longPath);
      expect(encoded.length).toBeGreaterThan(200);
      // First 200 chars are the truncated encoding ("-" + 199 "a"s).
      expect(encoded.slice(0, 200)).toBe(`-${"a".repeat(199)}`);
      // Followed by "-<hash>".
      expect(encoded.slice(200)).toMatch(/^-[0-9a-z]+$/);
      // Stable across calls.
      expect(encodePathForCli(longPath)).toBe(encoded);
    });

    it("does not truncate paths at or below the 200-char limit", () => {
      const exact = `/${"a".repeat(199)}`; // encodes to exactly 200 chars
      const encoded = encodePathForCli(exact);
      expect(encoded.length).toBe(200);
      expect(encoded).toBe(`-${"a".repeat(199)}`);
    });
  });

  describe("Windows path encoding", () => {
    it("encodes backslashes (and the drive colon) to hyphens", () => {
      expect(encodePathForCli("C:\\Users\\test")).toBe("C--Users-test");
    });

    it("encodes forward slashes in Windows paths", () => {
      expect(encodePathForCli("C:/Users/test")).toBe("C--Users-test");
    });

    it("encodes mixed slashes", () => {
      expect(encodePathForCli("C:\\Users/test\\project")).toBe("C--Users-test-project");
    });

    it("handles UNC paths", () => {
      expect(encodePathForCli("\\\\server\\share\\folder")).toBe("--server-share-folder");
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      expect(encodePathForCli("")).toBe("");
    });

    it("handles path with only slashes", () => {
      expect(encodePathForCli("///")).toBe("---");
    });

    it("handles single segment", () => {
      expect(encodePathForCli("project")).toBe("project");
    });
  });
});

describe("getCliSessionDir", () => {
  it("returns .claude/projects/encoded-path inside home dir", () => {
    const workspacePath = "/workspace/myproject";
    const result = getCliSessionDir(workspacePath);

    expect(result).toContain(".claude");
    expect(result).toContain("projects");
    expect(result).toContain("-workspace-myproject");
  });

  it("uses homedir as base", () => {
    const workspacePath = "/workspace/myproject";
    const result = getCliSessionDir(workspacePath);
    const expectedBase = join(homedir(), ".claude", "projects");

    expect(result.startsWith(expectedBase)).toBe(true);
  });

  it("encodes workspace path correctly", () => {
    const workspacePath = "/Users/ed/Code/herdctl";
    const result = getCliSessionDir(workspacePath);

    expect(result).toBe(join(homedir(), ".claude", "projects", "-Users-ed-Code-herdctl"));
  });

  it("handles different workspace paths", () => {
    const paths = ["/workspace/project1", "/workspace/project2", "/different/path"];

    const results = paths.map((p) => getCliSessionDir(p));

    // Each should be unique
    expect(new Set(results).size).toBe(paths.length);

    // All should be in .claude/projects
    results.forEach((r) => {
      expect(r).toContain(".claude");
      expect(r).toContain("projects");
    });
  });

  it("handles workspace path with trailing slash", () => {
    const result1 = getCliSessionDir("/workspace/project");
    const result2 = getCliSessionDir("/workspace/project/");

    // Should differ by one trailing hyphen
    expect(result2).toBe(`${result1}-`);
  });
});

describe("getCliSessionFile", () => {
  it("returns session file path with .jsonl extension", () => {
    const workspacePath = "/workspace/myproject";
    const sessionId = "dda6da5b-8788-4990-a582-d5a2c63fbfba";
    const result = getCliSessionFile(workspacePath, sessionId);

    expect(result).toContain(".claude");
    expect(result).toContain("projects");
    expect(result).toContain("-workspace-myproject");
    expect(result).toContain(sessionId);
    expect(result.endsWith(".jsonl")).toBe(true);
  });

  it("joins session dir and session file correctly", () => {
    const workspacePath = "/Users/ed/Code/herdctl";
    const sessionId = "abc123";
    const result = getCliSessionFile(workspacePath, sessionId);

    const expectedDir = getCliSessionDir(workspacePath);
    const expectedFile = join(expectedDir, `${sessionId}.jsonl`);

    expect(result).toBe(expectedFile);
  });

  it("handles different session IDs", () => {
    const workspacePath = "/workspace/project";
    const sessionIds = ["session-1", "session-2", "dda6da5b-8788-4990-a582-d5a2c63fbfba"];

    const results = sessionIds.map((id) => getCliSessionFile(workspacePath, id));

    // Each should be unique
    expect(new Set(results).size).toBe(sessionIds.length);

    // All should end with .jsonl
    results.forEach((r) => {
      expect(r.endsWith(".jsonl")).toBe(true);
    });

    // All should contain the session ID
    results.forEach((r, i) => {
      expect(r).toContain(sessionIds[i]);
    });
  });

  it("constructs correct path components", () => {
    const workspacePath = "/workspace/project";
    const sessionId = "test-session";
    const result = getCliSessionFile(workspacePath, sessionId);

    const expectedPath = join(
      homedir(),
      ".claude",
      "projects",
      "-workspace-project",
      "test-session.jsonl",
    );

    expect(result).toBe(expectedPath);
  });

  it("handles UUID format session IDs", () => {
    const workspacePath = "/workspace/project";
    const sessionId = "dda6da5b-8788-4990-a582-d5a2c63fbfba";
    const result = getCliSessionFile(workspacePath, sessionId);

    expect(result).toContain(sessionId);
    expect(result).toMatch(/dda6da5b-8788-4990-a582-d5a2c63fbfba\.jsonl$/);
  });

  describe("path traversal protection", () => {
    it("throws error for session ID with path traversal sequences", () => {
      const workspacePath = "/workspace/project";
      expect(() => getCliSessionFile(workspacePath, "../etc/passwd")).toThrow(
        "Invalid session ID: ../etc/passwd",
      );
      expect(() => getCliSessionFile(workspacePath, "../../etc/passwd")).toThrow(
        "Invalid session ID: ../../etc/passwd",
      );
      expect(() => getCliSessionFile(workspacePath, "..\\windows\\system32")).toThrow(
        "Invalid session ID: ..\\windows\\system32",
      );
    });

    it("throws error for session ID with slashes", () => {
      const workspacePath = "/workspace/project";
      expect(() => getCliSessionFile(workspacePath, "sessions/malicious")).toThrow(
        "Invalid session ID: sessions/malicious",
      );
      expect(() => getCliSessionFile(workspacePath, "sessions\\malicious")).toThrow(
        "Invalid session ID: sessions\\malicious",
      );
    });

    it("throws error for session ID with special characters", () => {
      const workspacePath = "/workspace/project";
      expect(() => getCliSessionFile(workspacePath, "session!@#")).toThrow(
        "Invalid session ID: session!@#",
      );
      expect(() => getCliSessionFile(workspacePath, "session$%^")).toThrow(
        "Invalid session ID: session$%^",
      );
      expect(() => getCliSessionFile(workspacePath, "session_id")).toThrow(
        "Invalid session ID: session_id",
      );
    });

    it("allows valid session IDs with alphanumeric and hyphens", () => {
      const workspacePath = "/workspace/project";
      const validSessionIds = [
        "dda6da5b-8788-4990-a582-d5a2c63fbfba",
        "abc123",
        "SESSION-123",
        "test-session-id",
        "123456789",
        "AbCdEf123",
      ];

      validSessionIds.forEach((sessionId) => {
        expect(() => getCliSessionFile(workspacePath, sessionId)).not.toThrow();
      });
    });
  });
});

describe("getDockerSessionFile", () => {
  it("returns Docker session file path with .jsonl extension", () => {
    const stateDir = "/home/user/.herdctl";
    const sessionId = "dda6da5b-8788-4990-a582-d5a2c63fbfba";
    const result = getDockerSessionFile(stateDir, sessionId);

    expect(result).toBe(join(stateDir, "docker-sessions", `${sessionId}.jsonl`));
    expect(result.endsWith(".jsonl")).toBe(true);
  });

  it("handles different session IDs", () => {
    const stateDir = "/home/user/.herdctl";
    const sessionIds = ["session-1", "session-2", "dda6da5b-8788-4990-a582-d5a2c63fbfba"];

    const results = sessionIds.map((id) => getDockerSessionFile(stateDir, id));

    // Each should be unique
    expect(new Set(results).size).toBe(sessionIds.length);

    // All should end with .jsonl and be in docker-sessions
    results.forEach((r) => {
      expect(r.endsWith(".jsonl")).toBe(true);
      expect(r).toContain("docker-sessions");
    });
  });

  describe("path traversal protection", () => {
    it("throws error for session ID with path traversal sequences", () => {
      const stateDir = "/home/user/.herdctl";
      expect(() => getDockerSessionFile(stateDir, "../etc/passwd")).toThrow(
        "Invalid session ID: ../etc/passwd",
      );
      expect(() => getDockerSessionFile(stateDir, "../../etc/passwd")).toThrow(
        "Invalid session ID: ../../etc/passwd",
      );
      expect(() => getDockerSessionFile(stateDir, "..\\windows\\system32")).toThrow(
        "Invalid session ID: ..\\windows\\system32",
      );
    });

    it("throws error for session ID with slashes", () => {
      const stateDir = "/home/user/.herdctl";
      expect(() => getDockerSessionFile(stateDir, "sessions/malicious")).toThrow(
        "Invalid session ID: sessions/malicious",
      );
      expect(() => getDockerSessionFile(stateDir, "sessions\\malicious")).toThrow(
        "Invalid session ID: sessions\\malicious",
      );
    });

    it("throws error for session ID with special characters", () => {
      const stateDir = "/home/user/.herdctl";
      expect(() => getDockerSessionFile(stateDir, "session!@#")).toThrow(
        "Invalid session ID: session!@#",
      );
      expect(() => getDockerSessionFile(stateDir, "session$%^")).toThrow(
        "Invalid session ID: session$%^",
      );
      expect(() => getDockerSessionFile(stateDir, "session_id")).toThrow(
        "Invalid session ID: session_id",
      );
    });

    it("allows valid session IDs with alphanumeric and hyphens", () => {
      const stateDir = "/home/user/.herdctl";
      const validSessionIds = [
        "dda6da5b-8788-4990-a582-d5a2c63fbfba",
        "abc123",
        "SESSION-123",
        "test-session-id",
        "123456789",
        "AbCdEf123",
      ];

      validSessionIds.forEach((sessionId) => {
        expect(() => getDockerSessionFile(stateDir, sessionId)).not.toThrow();
      });
    });
  });
});
