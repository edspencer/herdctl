/**
 * Tests for Source Specifier Parser
 */

import * as path from "path";

import { describe, expect, it } from "vitest";

import {
  type GitHubSource,
  isGitHubSource,
  isLocalSource,
  type LocalSource,
  parseSourceSpecifier,
  SourceParseError,
  type SourceSpecifier,
  stringifySourceSpecifier,
} from "../source-specifier.js";

// =============================================================================
// GitHub Source Tests
// =============================================================================

describe("parseSourceSpecifier - GitHub sources", () => {
  describe("basic GitHub sources", () => {
    it("should parse basic github:owner/repo format", () => {
      const result = parseSourceSpecifier("github:user/repo");

      expect(result.type).toBe("github");
      expect(isGitHubSource(result)).toBe(true);
      if (isGitHubSource(result)) {
        expect(result.owner).toBe("user");
        expect(result.repo).toBe("repo");
        expect(result.ref).toBeUndefined();
      }
    });

    it("should parse GitHub source with organization owner", () => {
      const result = parseSourceSpecifier("github:herdctl-examples/website-monitor-agent");

      expect(result.type).toBe("github");
      if (isGitHubSource(result)) {
        expect(result.owner).toBe("herdctl-examples");
        expect(result.repo).toBe("website-monitor-agent");
      }
    });

    it("should parse GitHub source with underscores in names", () => {
      const result = parseSourceSpecifier("github:my_org/my_repo");

      expect(result.type).toBe("github");
      if (isGitHubSource(result)) {
        expect(result.owner).toBe("my_org");
        expect(result.repo).toBe("my_repo");
      }
    });

    it("should parse GitHub source with dots in names", () => {
      const result = parseSourceSpecifier("github:user.name/repo.name");

      expect(result.type).toBe("github");
      if (isGitHubSource(result)) {
        expect(result.owner).toBe("user.name");
        expect(result.repo).toBe("repo.name");
      }
    });

    it("should parse GitHub source with numeric names", () => {
      const result = parseSourceSpecifier("github:user123/repo456");

      expect(result.type).toBe("github");
      if (isGitHubSource(result)) {
        expect(result.owner).toBe("user123");
        expect(result.repo).toBe("repo456");
      }
    });

    it("should parse GitHub source with single character names", () => {
      const result = parseSourceSpecifier("github:a/b");

      expect(result.type).toBe("github");
      if (isGitHubSource(result)) {
        expect(result.owner).toBe("a");
        expect(result.repo).toBe("b");
      }
    });
  });

  describe("GitHub sources with tag ref", () => {
    it("should parse GitHub source with semver tag", () => {
      const result = parseSourceSpecifier("github:user/repo@v1.0.0");

      expect(result.type).toBe("github");
      if (isGitHubSource(result)) {
        expect(result.owner).toBe("user");
        expect(result.repo).toBe("repo");
        expect(result.ref).toBe("v1.0.0");
      }
    });

    it("should parse GitHub source with tag without v prefix", () => {
      const result = parseSourceSpecifier("github:user/repo@1.2.3");

      expect(result.type).toBe("github");
      if (isGitHubSource(result)) {
        expect(result.ref).toBe("1.2.3");
      }
    });

    it("should parse GitHub source with prerelease tag", () => {
      const result = parseSourceSpecifier("github:user/repo@v2.0.0-beta.1");

      expect(result.type).toBe("github");
      if (isGitHubSource(result)) {
        expect(result.ref).toBe("v2.0.0-beta.1");
      }
    });
  });

  describe("GitHub sources with branch ref", () => {
    it("should parse GitHub source with main branch", () => {
      const result = parseSourceSpecifier("github:user/repo@main");

      expect(result.type).toBe("github");
      if (isGitHubSource(result)) {
        expect(result.ref).toBe("main");
      }
    });

    it("should parse GitHub source with feature branch", () => {
      const result = parseSourceSpecifier("github:user/repo@feature/new-feature");

      expect(result.type).toBe("github");
      if (isGitHubSource(result)) {
        expect(result.ref).toBe("feature/new-feature");
      }
    });

    it("should parse GitHub source with branch containing hyphens", () => {
      const result = parseSourceSpecifier("github:user/repo@fix-bug-123");

      expect(result.type).toBe("github");
      if (isGitHubSource(result)) {
        expect(result.ref).toBe("fix-bug-123");
      }
    });

    it("should parse GitHub source with branch containing dots", () => {
      const result = parseSourceSpecifier("github:user/repo@release.2024.01");

      expect(result.type).toBe("github");
      if (isGitHubSource(result)) {
        expect(result.ref).toBe("release.2024.01");
      }
    });
  });

  describe("GitHub sources with commit SHA ref", () => {
    it("should parse GitHub source with short commit SHA", () => {
      const result = parseSourceSpecifier("github:user/repo@abc1234");

      expect(result.type).toBe("github");
      if (isGitHubSource(result)) {
        expect(result.ref).toBe("abc1234");
      }
    });

    it("should parse GitHub source with full commit SHA", () => {
      const result = parseSourceSpecifier(
        "github:user/repo@abc1234567890def1234567890abc1234567890de",
      );

      expect(result.type).toBe("github");
      if (isGitHubSource(result)) {
        expect(result.ref).toBe("abc1234567890def1234567890abc1234567890de");
      }
    });
  });

  describe("GitHub source error cases", () => {
    it("should throw for github: with no repo", () => {
      expect(() => parseSourceSpecifier("github:")).toThrow(SourceParseError);
      expect(() => parseSourceSpecifier("github:")).toThrow("owner/repo");
    });

    it("should throw for github:owner/ missing repo", () => {
      expect(() => parseSourceSpecifier("github:owner/")).toThrow(SourceParseError);
      expect(() => parseSourceSpecifier("github:owner/")).toThrow("cannot be empty");
    });

    it("should throw for github:/repo missing owner", () => {
      expect(() => parseSourceSpecifier("github:/repo")).toThrow(SourceParseError);
      expect(() => parseSourceSpecifier("github:/repo")).toThrow("cannot be empty");
    });

    it("should throw for github:owner (no slash)", () => {
      expect(() => parseSourceSpecifier("github:owner")).toThrow(SourceParseError);
      expect(() => parseSourceSpecifier("github:owner")).toThrow("owner/repo");
    });

    it("should throw for github:owner/repo@ with empty ref", () => {
      expect(() => parseSourceSpecifier("github:owner/repo@")).toThrow(SourceParseError);
      expect(() => parseSourceSpecifier("github:owner/repo@")).toThrow('cannot be empty after "@"');
    });

    it("should throw for nested paths (github:owner/repo/subdir)", () => {
      expect(() => parseSourceSpecifier("github:owner/repo/subdir")).toThrow(SourceParseError);
      expect(() => parseSourceSpecifier("github:owner/repo/subdir")).toThrow(
        "Nested paths are not supported",
      );
    });

    it("should throw for owner starting with dot", () => {
      expect(() => parseSourceSpecifier("github:.hidden/repo")).toThrow(SourceParseError);
      expect(() => parseSourceSpecifier("github:.hidden/repo")).toThrow("cannot start with a dot");
    });

    it("should throw for repo starting with dot", () => {
      expect(() => parseSourceSpecifier("github:owner/.hidden")).toThrow(SourceParseError);
    });

    it("should throw for owner ending with .git", () => {
      expect(() => parseSourceSpecifier("github:owner.git/repo")).toThrow(SourceParseError);
      expect(() => parseSourceSpecifier("github:owner.git/repo")).toThrow('cannot end with ".git"');
    });

    it("should throw for repo ending with .git", () => {
      expect(() => parseSourceSpecifier("github:owner/repo.git")).toThrow(SourceParseError);
      expect(() => parseSourceSpecifier("github:owner/repo.git")).toThrow('cannot end with ".git"');
    });

    it("should throw for owner with invalid characters", () => {
      expect(() => parseSourceSpecifier("github:owner!/repo")).toThrow(SourceParseError);
      expect(() => parseSourceSpecifier("github:owner@name/repo")).toThrow(SourceParseError);
      expect(() => parseSourceSpecifier("github:owner name/repo")).toThrow(SourceParseError);
    });

    it("should throw for repo with invalid characters", () => {
      expect(() => parseSourceSpecifier("github:owner/repo!")).toThrow(SourceParseError);
      expect(() => parseSourceSpecifier("github:owner/repo name")).toThrow(SourceParseError);
    });
  });
});

// =============================================================================
// Local Source Tests
// =============================================================================

describe("parseSourceSpecifier - Local sources", () => {
  describe("relative paths", () => {
    it("should parse ./ relative path", () => {
      const result = parseSourceSpecifier("./local/path");

      expect(result.type).toBe("local");
      expect(isLocalSource(result)).toBe(true);
      if (isLocalSource(result)) {
        expect(result.path).toBe(path.resolve("./local/path"));
        expect(path.isAbsolute(result.path)).toBe(true);
      }
    });

    it("should parse ../ relative path", () => {
      const result = parseSourceSpecifier("../parent/path");

      expect(result.type).toBe("local");
      if (isLocalSource(result)) {
        expect(result.path).toBe(path.resolve("../parent/path"));
        expect(path.isAbsolute(result.path)).toBe(true);
      }
    });

    it("should parse path with multiple ../", () => {
      const result = parseSourceSpecifier("../../grandparent/path");

      expect(result.type).toBe("local");
      if (isLocalSource(result)) {
        expect(result.path).toBe(path.resolve("../../grandparent/path"));
      }
    });

    it("should resolve . in path components", () => {
      const result = parseSourceSpecifier("./a/./b/./c");

      expect(result.type).toBe("local");
      if (isLocalSource(result)) {
        // path.resolve normalizes away the . components
        expect(result.path).toContain("a");
        expect(result.path).toContain("b");
        expect(result.path).toContain("c");
      }
    });

    it("should resolve .. in path components", () => {
      const result = parseSourceSpecifier("./a/b/../c");

      expect(result.type).toBe("local");
      if (isLocalSource(result)) {
        // path.resolve normalizes a/b/../c to a/c
        expect(result.path).toContain("a");
        expect(result.path).toContain("c");
        expect(result.path).not.toMatch(/a[/\\]b[/\\]c/); // Should not have a/b/c
      }
    });
  });

  describe("absolute paths", () => {
    it("should parse Unix absolute path", () => {
      const result = parseSourceSpecifier("/absolute/path/to/agent");

      expect(result.type).toBe("local");
      if (isLocalSource(result)) {
        expect(result.path).toBe("/absolute/path/to/agent");
        expect(path.isAbsolute(result.path)).toBe(true);
      }
    });

    it("should parse root path", () => {
      const result = parseSourceSpecifier("/");

      expect(result.type).toBe("local");
      if (isLocalSource(result)) {
        expect(result.path).toBe("/");
      }
    });
  });

  describe("edge cases", () => {
    it("should handle path with spaces", () => {
      const result = parseSourceSpecifier("./path with spaces/agent");

      expect(result.type).toBe("local");
      if (isLocalSource(result)) {
        expect(result.path).toContain("path with spaces");
      }
    });

    it("should handle path with special characters", () => {
      const result = parseSourceSpecifier("./path-with_special.chars/agent");

      expect(result.type).toBe("local");
      if (isLocalSource(result)) {
        expect(result.path).toContain("path-with_special.chars");
      }
    });

    it("should handle deeply nested path", () => {
      const result = parseSourceSpecifier("./a/b/c/d/e/f/g/agent");

      expect(result.type).toBe("local");
      if (isLocalSource(result)) {
        expect(result.path).toContain("a");
        expect(result.path).toContain("agent");
      }
    });
  });
});

// =============================================================================
// GitHub Shorthand Tests
// =============================================================================

describe("parseSourceSpecifier - GitHub shorthand", () => {
  describe("valid owner/repo shorthand", () => {
    it("should parse owner/repo as GitHub source", () => {
      const result = parseSourceSpecifier("user/repo");

      expect(result.type).toBe("github");
      expect(isGitHubSource(result)).toBe(true);
      if (isGitHubSource(result)) {
        expect(result.owner).toBe("user");
        expect(result.repo).toBe("repo");
        expect(result.ref).toBeUndefined();
      }
    });

    it("should parse owner/repo with ref", () => {
      const result = parseSourceSpecifier("user/repo@v1.0.0");

      expect(result.type).toBe("github");
      if (isGitHubSource(result)) {
        expect(result.owner).toBe("user");
        expect(result.repo).toBe("repo");
        expect(result.ref).toBe("v1.0.0");
      }
    });

    it("should parse owner/repo with branch ref", () => {
      const result = parseSourceSpecifier("user/repo@main");

      expect(result.type).toBe("github");
      if (isGitHubSource(result)) {
        expect(result.owner).toBe("user");
        expect(result.repo).toBe("repo");
        expect(result.ref).toBe("main");
      }
    });

    it("should parse org/repo with hyphens", () => {
      const result = parseSourceSpecifier("herdctl-examples/website-monitor-agent");

      expect(result.type).toBe("github");
      if (isGitHubSource(result)) {
        expect(result.owner).toBe("herdctl-examples");
        expect(result.repo).toBe("website-monitor-agent");
      }
    });

    it("should parse owner/repo with underscores", () => {
      const result = parseSourceSpecifier("my_org/my_repo");

      expect(result.type).toBe("github");
      if (isGitHubSource(result)) {
        expect(result.owner).toBe("my_org");
        expect(result.repo).toBe("my_repo");
      }
    });

    it("should be equivalent to github: prefix form", () => {
      const shorthand = parseSourceSpecifier("user/repo@v1.0.0");
      const explicit = parseSourceSpecifier("github:user/repo@v1.0.0");

      expect(shorthand).toEqual(explicit);
    });
  });

  describe("unrecognized bare names", () => {
    it("should throw for bare name without slash", () => {
      expect(() => parseSourceSpecifier("competitive-analysis")).toThrow(SourceParseError);
      expect(() => parseSourceSpecifier("competitive-analysis")).toThrow(
        "Unrecognized source format",
      );
    });

    it("should throw for single word", () => {
      expect(() => parseSourceSpecifier("myagent")).toThrow(SourceParseError);
      expect(() => parseSourceSpecifier("myagent")).toThrow("Unrecognized source format");
    });

    it("should throw for name with special characters", () => {
      expect(() => parseSourceSpecifier("invalid!name")).toThrow(SourceParseError);
      expect(() => parseSourceSpecifier("invalid@name")).toThrow(SourceParseError);
    });

    it("should throw for backslash-separated names", () => {
      expect(() => parseSourceSpecifier("invalid\\name")).toThrow(SourceParseError);
    });
  });
});

// =============================================================================
// General Error Cases
// =============================================================================

describe("parseSourceSpecifier - Error cases", () => {
  it("should throw for empty string", () => {
    expect(() => parseSourceSpecifier("")).toThrow(SourceParseError);
    expect(() => parseSourceSpecifier("")).toThrow("cannot be empty");
  });

  it("should throw for whitespace-only string", () => {
    expect(() => parseSourceSpecifier("   ")).toThrow(SourceParseError);
    expect(() => parseSourceSpecifier("   ")).toThrow("cannot be empty");
  });

  it("should throw for null-like values", () => {
    expect(() => parseSourceSpecifier(null as unknown as string)).toThrow(SourceParseError);
    expect(() => parseSourceSpecifier(undefined as unknown as string)).toThrow(SourceParseError);
  });

  it("should trim whitespace from input", () => {
    const result = parseSourceSpecifier("  github:user/repo  ");

    expect(result.type).toBe("github");
    if (isGitHubSource(result)) {
      expect(result.owner).toBe("user");
      expect(result.repo).toBe("repo");
    }
  });

  it("should include source in error for debugging", () => {
    try {
      parseSourceSpecifier("github:invalid!");
    } catch (error) {
      expect(error).toBeInstanceOf(SourceParseError);
      if (error instanceof SourceParseError) {
        expect(error.source).toBe("github:invalid!");
      }
    }
  });
});

// =============================================================================
// Type Guard Tests
// =============================================================================

describe("Type guards", () => {
  describe("isGitHubSource", () => {
    it("should return true for GitHub source", () => {
      const specifier = parseSourceSpecifier("github:user/repo");
      expect(isGitHubSource(specifier)).toBe(true);
    });

    it("should return true for GitHub shorthand", () => {
      const specifier = parseSourceSpecifier("user/repo");
      expect(isGitHubSource(specifier)).toBe(true);
    });

    it("should return false for local source", () => {
      const specifier = parseSourceSpecifier("./local/path");
      expect(isGitHubSource(specifier)).toBe(false);
    });
  });

  describe("isLocalSource", () => {
    it("should return true for local source", () => {
      const specifier = parseSourceSpecifier("./local/path");
      expect(isLocalSource(specifier)).toBe(true);
    });

    it("should return false for GitHub source", () => {
      const specifier = parseSourceSpecifier("github:user/repo");
      expect(isLocalSource(specifier)).toBe(false);
    });

    it("should return false for GitHub shorthand", () => {
      const specifier = parseSourceSpecifier("user/repo");
      expect(isLocalSource(specifier)).toBe(false);
    });
  });
});

// =============================================================================
// stringifySourceSpecifier Tests
// =============================================================================

describe("stringifySourceSpecifier", () => {
  describe("GitHub sources", () => {
    it("should stringify basic GitHub source", () => {
      const specifier: GitHubSource = {
        type: "github",
        owner: "user",
        repo: "repo",
      };

      expect(stringifySourceSpecifier(specifier)).toBe("github:user/repo");
    });

    it("should stringify GitHub source with ref", () => {
      const specifier: GitHubSource = {
        type: "github",
        owner: "user",
        repo: "repo",
        ref: "v1.0.0",
      };

      expect(stringifySourceSpecifier(specifier)).toBe("github:user/repo@v1.0.0");
    });

    it("should stringify GitHub source with branch ref", () => {
      const specifier: GitHubSource = {
        type: "github",
        owner: "user",
        repo: "repo",
        ref: "feature/new-feature",
      };

      expect(stringifySourceSpecifier(specifier)).toBe("github:user/repo@feature/new-feature");
    });
  });

  describe("Local sources", () => {
    it("should stringify local source", () => {
      const specifier: LocalSource = {
        type: "local",
        path: "/absolute/path/to/agent",
      };

      expect(stringifySourceSpecifier(specifier)).toBe("/absolute/path/to/agent");
    });
  });

  describe("Round-trip", () => {
    it("should round-trip GitHub source", () => {
      const original = "github:user/repo@v1.0.0";
      const parsed = parseSourceSpecifier(original);
      const stringified = stringifySourceSpecifier(parsed);

      expect(stringified).toBe(original);
    });

    it("should round-trip GitHub shorthand via explicit form", () => {
      const parsed = parseSourceSpecifier("user/repo@v1.0.0");
      const stringified = stringifySourceSpecifier(parsed);

      // Shorthand round-trips to the explicit github: form
      expect(stringified).toBe("github:user/repo@v1.0.0");
    });

    // Note: Local paths don't round-trip exactly because they're resolved to absolute
    it("should produce valid specifier on local source round-trip", () => {
      const original = "./local/path";
      const parsed = parseSourceSpecifier(original);
      const stringified = stringifySourceSpecifier(parsed);

      // The stringified version is absolute, but should parse back to same path
      const reparsed = parseSourceSpecifier(stringified);
      expect(reparsed.type).toBe("local");
      if (isLocalSource(parsed) && isLocalSource(reparsed)) {
        expect(reparsed.path).toBe(parsed.path);
      }
    });
  });
});

// =============================================================================
// SourceSpecifier Type Tests (compile-time)
// =============================================================================

describe("SourceSpecifier types", () => {
  it("should have correct type structure for GitHubSource", () => {
    const specifier: GitHubSource = {
      type: "github",
      owner: "user",
      repo: "repo",
      ref: "v1.0.0",
    };

    // Type assertions - these are compile-time checks
    const _type: "github" = specifier.type;
    const _owner: string = specifier.owner;
    const _repo: string = specifier.repo;
    const _ref: string | undefined = specifier.ref;

    expect(_type).toBe("github");
    expect(_owner).toBe("user");
    expect(_repo).toBe("repo");
    expect(_ref).toBe("v1.0.0");
  });

  it("should have correct type structure for LocalSource", () => {
    const specifier: LocalSource = {
      type: "local",
      path: "/some/path",
    };

    const _type: "local" = specifier.type;
    const _path: string = specifier.path;

    expect(_type).toBe("local");
    expect(_path).toBe("/some/path");
  });

  it("should allow discrimination via type field", () => {
    const specifier: SourceSpecifier = parseSourceSpecifier("github:user/repo");

    // This tests that the type discriminator works correctly
    switch (specifier.type) {
      case "github":
        expect(specifier.owner).toBe("user");
        expect(specifier.repo).toBe("repo");
        break;
      case "local":
        // TypeScript knows specifier.path exists here
        expect(specifier.path).toBeDefined();
        break;
    }
  });
});
