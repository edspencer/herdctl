import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  encodePathForCli,
  getCliSessionDir,
  getCliSessionFile,
  getDockerSessionFile,
  readSessionCwd,
  sessionBelongsToWorkingDirectory,
  snapshotSessionFiles,
  waitForNewSessionFile,
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

  // Issue #148: the encoding is intentionally lossy and shared byte-for-byte with
  // Claude Code, so distinct working directories can collapse to the same encoded
  // transcript directory. These tests PIN that (unavoidable) behaviour so we never
  // accidentally "fix" the encoder in a way that diverges from Claude Code and
  // points at a directory that does not exist on disk. Disambiguation happens at
  // the session level via the recorded cwd (see readSessionCwd tests below).
  describe("lossy collisions (issue #148)", () => {
    it("collapses /a/b-c, /a-b/c, and /a/b/c to the same encoded directory", () => {
      const encoded = "-a-b-c";
      expect(encodePathForCli("/a/b-c")).toBe(encoded);
      expect(encodePathForCli("/a-b/c")).toBe(encoded);
      expect(encodePathForCli("/a/b/c")).toBe(encoded);
    });

    it("collides a hyphenated project dir with a deeper nested one", () => {
      // A very common real-world collision: a repo literally named with hyphens
      // vs. the same segments as separate directories.
      expect(encodePathForCli("/home/user/my-project")).toBe("-home-user-my-project");
      expect(encodePathForCli("/home/user/my/project")).toBe("-home-user-my-project");
    });

    it("matches Claude Code's real collision behaviour observed on disk", () => {
      // Verified empirically: claude run in /private/tmp/.../a/b-c and
      // /private/tmp/.../a-b/c both wrote transcripts into the single
      // `-private-tmp-...-a-b-c` directory under ~/.claude/projects/.
      const p1 = "/private/tmp/cc-collide/a/b-c";
      const p2 = "/private/tmp/cc-collide/a-b/c";
      expect(encodePathForCli(p1)).toBe("-private-tmp-cc-collide-a-b-c");
      expect(encodePathForCli(p2)).toBe(encodePathForCli(p1));
    });

    it("still encodes normal (non-colliding) paths uniquely and identically to before", () => {
      // Regression guard: the common case must be unchanged.
      expect(encodePathForCli("/Users/ed/Code/herdctl")).toBe("-Users-ed-Code-herdctl");
      expect(encodePathForCli("/Users/ed/Code/paddock")).toBe("-Users-ed-Code-paddock");
      expect(encodePathForCli("/Users/ed/Code/herdctl")).not.toBe(
        encodePathForCli("/Users/ed/Code/paddock"),
      );
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

// =============================================================================
// readSessionCwd / sessionBelongsToWorkingDirectory (issue #148 disambiguation)
// =============================================================================

// A transcript line shaped like the real Claude Code JSONL entries: queue
// operations have no cwd, user/assistant entries carry the authoritative cwd.
function jsonl(lines: Array<Record<string, unknown>>): string {
  return lines.map((l) => JSON.stringify(l)).join("\n");
}

describe("readSessionCwd", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "herdctl-cwd-test-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the cwd recorded on the first entry that carries one", async () => {
    const file = join(dir, "with-cwd.jsonl");
    await writeFile(
      file,
      jsonl([
        { type: "queue-operation" }, // no cwd
        { type: "user", cwd: "/home/user/my/project", sessionId: "s1" },
        { type: "assistant", cwd: "/home/user/my/project" },
      ]),
    );
    expect(await readSessionCwd(file)).toBe("/home/user/my/project");
  });

  it("distinguishes two colliding directories by their recorded cwd", async () => {
    // Both of these encode to the same `-home-user-my-project` directory, but the
    // transcripts themselves record different real cwds.
    const a = join(dir, "collide-a.jsonl");
    const b = join(dir, "collide-b.jsonl");
    await writeFile(a, jsonl([{ type: "user", cwd: "/home/user/my-project" }]));
    await writeFile(b, jsonl([{ type: "user", cwd: "/home/user/my/project" }]));

    // Sanity: the lossy encoder collides them...
    expect(encodePathForCli("/home/user/my-project")).toBe(
      encodePathForCli("/home/user/my/project"),
    );
    // ...but the recorded cwds disambiguate them.
    expect(await readSessionCwd(a)).toBe("/home/user/my-project");
    expect(await readSessionCwd(b)).toBe("/home/user/my/project");
  });

  it("returns null when no entry records a cwd", async () => {
    const file = join(dir, "no-cwd.jsonl");
    await writeFile(file, jsonl([{ type: "queue-operation" }, { type: "summary", summary: "x" }]));
    expect(await readSessionCwd(file)).toBeNull();
  });

  it("returns null for an empty file", async () => {
    const file = join(dir, "empty.jsonl");
    await writeFile(file, "");
    expect(await readSessionCwd(file)).toBeNull();
  });

  it("skips malformed JSON lines and keeps reading", async () => {
    const file = join(dir, "malformed.jsonl");
    await writeFile(file, `not json\n{"type":"user","cwd":"/real/dir"}\n`);
    expect(await readSessionCwd(file)).toBe("/real/dir");
  });

  it("returns null for a missing file (no throw)", async () => {
    expect(await readSessionCwd(join(dir, "does-not-exist.jsonl"))).toBeNull();
  });
});

describe("sessionBelongsToWorkingDirectory", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "herdctl-belongs-test-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns true when the recorded cwd matches the working directory", async () => {
    const file = join(dir, "match.jsonl");
    await writeFile(file, jsonl([{ type: "user", cwd: "/home/user/my-project" }]));
    expect(await sessionBelongsToWorkingDirectory(file, "/home/user/my-project")).toBe(true);
  });

  it("returns false for a colliding-but-different working directory", async () => {
    // Encodes to the same dir, but is a different real path — must NOT match.
    const file = join(dir, "collide.jsonl");
    await writeFile(file, jsonl([{ type: "user", cwd: "/home/user/my/project" }]));
    expect(await sessionBelongsToWorkingDirectory(file, "/home/user/my-project")).toBe(false);
  });

  it("normalises trailing slashes and relative segments before comparing", async () => {
    const file = join(dir, "normalise.jsonl");
    await writeFile(file, jsonl([{ type: "user", cwd: "/home/user/project" }]));
    expect(await sessionBelongsToWorkingDirectory(file, "/home/user/project/")).toBe(true);
    expect(await sessionBelongsToWorkingDirectory(file, "/home/user/foo/../project")).toBe(true);
  });

  it("defaults to belonging (true) when the cwd is unknown", async () => {
    const file = join(dir, "unknown.jsonl");
    await writeFile(file, jsonl([{ type: "queue-operation" }]));
    expect(await sessionBelongsToWorkingDirectory(file, "/anything")).toBe(true);
  });

  it("respects defaultWhenUnknown: false to exclude unidentifiable sessions", async () => {
    const file = join(dir, "unknown2.jsonl");
    await writeFile(file, jsonl([{ type: "queue-operation" }]));
    expect(
      await sessionBelongsToWorkingDirectory(file, "/anything", { defaultWhenUnknown: false }),
    ).toBe(false);
  });
});

describe("snapshotSessionFiles", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "herdctl-snapshot-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the set of .jsonl filenames currently present", async () => {
    await writeFile(join(dir, "a.jsonl"), "");
    await writeFile(join(dir, "b.jsonl"), "");
    await writeFile(join(dir, "notes.txt"), ""); // ignored — not a transcript

    const snapshot = await snapshotSessionFiles(dir);
    expect(snapshot).toEqual(new Set(["a.jsonl", "b.jsonl"]));
  });

  it("returns basenames (not full paths) so they compare against a later readdir", async () => {
    await writeFile(join(dir, "abc123.jsonl"), "");
    const snapshot = await snapshotSessionFiles(dir);
    expect(snapshot.has("abc123.jsonl")).toBe(true);
    expect(snapshot.has(join(dir, "abc123.jsonl"))).toBe(false);
  });

  it("returns an empty set for a non-existent directory (first-ever session)", async () => {
    const snapshot = await snapshotSessionFiles(join(dir, "does-not-exist"));
    expect(snapshot).toEqual(new Set());
  });
});

describe("waitForNewSessionFile", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "herdctl-waitnew-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Set a file's mtime to `ms` epoch milliseconds so tests can order files
  // deterministically regardless of write speed.
  async function setMtime(file: string, ms: number): Promise<void> {
    const when = new Date(ms);
    await utimes(file, when, when);
  }

  describe("set-difference path (knownFiles supplied) — issue #357", () => {
    it("returns the brand-new file even when a co-located session is newer", async () => {
      // Agent A's session already exists and is actively streaming.
      const coLocated = join(dir, "aaaaaaaa-cccc-4444-8888-000000000000.jsonl");
      await writeFile(coLocated, "");
      const knownFiles = await snapshotSessionFiles(dir);

      const startTime = Date.now() - 10_000;

      // Agent B spawns and creates its own new file...
      const brandNew = join(dir, "bbbbbbbb-cccc-4444-8888-111111111111.jsonl");
      await writeFile(brandNew, "");
      await setMtime(brandNew, startTime + 1000);
      // ...but agent A keeps streaming, so its file is now the NEWEST by mtime.
      await setMtime(coLocated, startTime + 5000);

      const resolved = await waitForNewSessionFile(dir, startTime, {
        knownFiles,
        timeoutMs: 2000,
        pollIntervalMs: 10,
      });

      // Must be B's brand-new file, not A's newer-mtime streaming file.
      expect(resolved).toBe(brandNew);
    });

    it("(contrast) the legacy mtime path picks the wrong (co-located) file", async () => {
      // Same setup, but WITHOUT the snapshot — demonstrates the bug the
      // set-difference path fixes.
      const coLocated = join(dir, "aaaaaaaa-cccc-4444-8888-000000000000.jsonl");
      await writeFile(coLocated, "");
      const startTime = Date.now() - 10_000;

      const brandNew = join(dir, "bbbbbbbb-cccc-4444-8888-111111111111.jsonl");
      await writeFile(brandNew, "");
      await setMtime(brandNew, startTime + 1000);
      await setMtime(coLocated, startTime + 5000);

      const resolved = await waitForNewSessionFile(dir, startTime, {
        timeoutMs: 2000,
        pollIntervalMs: 10,
      });

      // Legacy heuristic grabs the newest-by-mtime file — the co-located one.
      expect(resolved).toBe(coLocated);
    });

    it("keeps polling until the new-named file appears (ignores co-located churn)", async () => {
      const coLocated = join(dir, "aaaaaaaa-cccc-4444-8888-000000000000.jsonl");
      await writeFile(coLocated, "");
      const knownFiles = await snapshotSessionFiles(dir);
      const startTime = Date.now() - 10_000;

      // The new file appears only after a couple of poll intervals.
      const brandNew = join(dir, "bbbbbbbb-cccc-4444-8888-111111111111.jsonl");
      setTimeout(() => {
        void writeFile(brandNew, "");
      }, 60);

      const resolved = await waitForNewSessionFile(dir, startTime, {
        knownFiles,
        timeoutMs: 2000,
        pollIntervalMs: 10,
      });
      expect(resolved).toBe(brandNew);
    });

    it("falls back to newest-by-mtime after the deadline if no new-named file appears", async () => {
      // Only co-located files exist; none is 'new'. After the timeout the
      // function falls back to the mtime heuristic rather than the primary path.
      const coLocated = join(dir, "aaaaaaaa-cccc-4444-8888-000000000000.jsonl");
      await writeFile(coLocated, "");
      const knownFiles = await snapshotSessionFiles(dir);
      const startTime = Date.now() - 10_000;
      await setMtime(coLocated, startTime + 1000);

      const resolved = await waitForNewSessionFile(dir, startTime, {
        knownFiles,
        timeoutMs: 150,
        pollIntervalMs: 20,
      });
      expect(resolved).toBe(coLocated);
    });
  });

  describe("legacy mtime path (no knownFiles)", () => {
    it("returns the newest file created after startTime", async () => {
      const startTime = Date.now() - 10_000;
      const older = join(dir, "older.jsonl");
      const newer = join(dir, "newer.jsonl");
      await writeFile(older, "");
      await writeFile(newer, "");
      await setMtime(older, startTime + 1000);
      await setMtime(newer, startTime + 2000);

      const resolved = await waitForNewSessionFile(dir, startTime, {
        timeoutMs: 2000,
        pollIntervalMs: 10,
      });
      expect(resolved).toBe(newer);
    });

    it("throws on timeout when no file is created after startTime", async () => {
      const stale = join(dir, "stale.jsonl");
      await writeFile(stale, "");
      const startTime = Date.now() + 10_000; // future — nothing qualifies

      await expect(
        waitForNewSessionFile(dir, startTime, { timeoutMs: 120, pollIntervalMs: 20 }),
      ).rejects.toThrow(/Timeout waiting for new session file/);
    });
  });
});
