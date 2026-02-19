import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodePathForCli, getCliSessionDir, getCliSessionFile } from "../cli-session-path.js";

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
      // Only slashes are encoded, other characters pass through
      expect(encodePathForCli("/path/to/my-project_v2")).toBe("-path-to-my-project_v2");
    });
  });

  describe("Windows path encoding", () => {
    it("encodes backslashes to hyphens", () => {
      expect(encodePathForCli("C:\\Users\\test")).toBe("C:-Users-test");
    });

    it("encodes forward slashes in Windows paths", () => {
      expect(encodePathForCli("C:/Users/test")).toBe("C:-Users-test");
    });

    it("encodes mixed slashes", () => {
      expect(encodePathForCli("C:\\Users/test\\project")).toBe("C:-Users-test-project");
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
});
