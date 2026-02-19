import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  PathTraversalError,
  SAFE_IDENTIFIER_PATTERN,
  isValidIdentifier,
  buildSafeFilePath,
} from "../path-safety.js";

describe("PathTraversalError", () => {
  it("creates error with correct properties", () => {
    const error = new PathTraversalError("/base/dir", "bad-id", "/escaped/path");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("PathTraversalError");
    expect(error.baseDir).toBe("/base/dir");
    expect(error.identifier).toBe("bad-id");
    expect(error.resultPath).toBe("/escaped/path");
  });

  it("creates descriptive error message", () => {
    const error = new PathTraversalError("/base/dir", "../evil", "/evil");

    expect(error.message).toContain("Path traversal detected");
    expect(error.message).toContain("../evil");
    expect(error.message).toContain("/evil");
    expect(error.message).toContain("/base/dir");
  });
});

describe("SAFE_IDENTIFIER_PATTERN", () => {
  describe("valid identifiers", () => {
    const validCases = [
      "agent",
      "my-agent",
      "my_agent",
      "agent123",
      "Agent",
      "AGENT",
      "a",
      "A",
      "0",
      "1agent",
      "agent-with-many-hyphens",
      "agent_with_many_underscores",
      "MixedCase-And_Symbols123",
      "job-2024-01-15-abc123", // Job ID format
      "herdctl.security-auditor", // Qualified name (dot-separated)
      "project.sub-fleet.agent", // Deeply nested qualified name
      "a.b", // Minimal qualified name
    ];

    it.each(validCases)("accepts '%s'", (identifier) => {
      expect(SAFE_IDENTIFIER_PATTERN.test(identifier)).toBe(true);
    });
  });

  describe("invalid identifiers", () => {
    const invalidCases = [
      ["../parent", "path traversal with .."],
      ["..\\parent", "Windows path traversal"],
      ["/absolute", "absolute path"],
      ["with/slash", "contains forward slash"],
      ["with\\backslash", "contains backslash"],
      ["with space", "contains space"],
      ["-starts-with-hyphen", "starts with hyphen"],
      ["_starts-with-underscore", "starts with underscore"],
      ["", "empty string"],
      [".starts-with-dot", "starts with dot"],
      ["ends-with-dot.", "ends with dot"],
      ["has:colon", "contains colon"],
      ["has@at", "contains at symbol"],
      ["has$dollar", "contains dollar sign"],
      ["has%percent", "contains percent"],
      ["日本語", "non-ASCII characters"],
    ];

    it.each(invalidCases)("rejects '%s' (%s)", (identifier) => {
      expect(SAFE_IDENTIFIER_PATTERN.test(identifier)).toBe(false);
    });
  });
});

describe("isValidIdentifier", () => {
  it("returns true for valid identifiers", () => {
    expect(isValidIdentifier("my-agent")).toBe(true);
    expect(isValidIdentifier("agent_1")).toBe(true);
    expect(isValidIdentifier("Agent")).toBe(true);
    expect(isValidIdentifier("herdctl.security-auditor")).toBe(true);
  });

  it("returns false for invalid identifiers", () => {
    expect(isValidIdentifier("../evil")).toBe(false);
    expect(isValidIdentifier("")).toBe(false);
    expect(isValidIdentifier("with space")).toBe(false);
    expect(isValidIdentifier(".starts-with-dot")).toBe(false);
  });
});

describe("buildSafeFilePath", () => {
  const baseDir = "/home/user/.herdctl/sessions";

  describe("valid identifiers", () => {
    it("builds path for simple agent name", () => {
      const result = buildSafeFilePath(baseDir, "my-agent", ".json");
      expect(result).toBe(join(baseDir, "my-agent.json"));
    });

    it("builds path for agent name with underscores", () => {
      const result = buildSafeFilePath(baseDir, "my_agent_v2", ".json");
      expect(result).toBe(join(baseDir, "my_agent_v2.json"));
    });

    it("builds path for job ID format", () => {
      const result = buildSafeFilePath(baseDir, "job-2024-01-15-abc123", ".yaml");
      expect(result).toBe(join(baseDir, "job-2024-01-15-abc123.yaml"));
    });

    it("handles different file extensions", () => {
      expect(buildSafeFilePath(baseDir, "agent", ".json")).toBe(
        join(baseDir, "agent.json")
      );
      expect(buildSafeFilePath(baseDir, "agent", ".yaml")).toBe(
        join(baseDir, "agent.yaml")
      );
      expect(buildSafeFilePath(baseDir, "agent", ".yml")).toBe(
        join(baseDir, "agent.yml")
      );
    });

    it("handles single character identifiers", () => {
      const result = buildSafeFilePath(baseDir, "a", ".json");
      expect(result).toBe(join(baseDir, "a.json"));
    });

    it("handles numeric identifiers", () => {
      const result = buildSafeFilePath(baseDir, "123", ".json");
      expect(result).toBe(join(baseDir, "123.json"));
    });

    it("builds path for qualified agent name (dot-separated)", () => {
      const result = buildSafeFilePath(baseDir, "herdctl.security-auditor", ".json");
      expect(result).toBe(join(baseDir, "herdctl.security-auditor.json"));
    });

    it("builds path for deeply nested qualified name", () => {
      const result = buildSafeFilePath(baseDir, "project.frontend.designer", ".yaml");
      expect(result).toBe(join(baseDir, "project.frontend.designer.yaml"));
    });
  });

  describe("path traversal attempts", () => {
    it("throws for parent directory traversal (../)", () => {
      expect(() => buildSafeFilePath(baseDir, "../evil", ".json")).toThrow(
        PathTraversalError
      );
    });

    it("throws for deep parent traversal (../../..)", () => {
      expect(() =>
        buildSafeFilePath(baseDir, "../../../etc/passwd", ".json")
      ).toThrow(PathTraversalError);
    });

    it("throws for Windows-style traversal (..\\)", () => {
      expect(() => buildSafeFilePath(baseDir, "..\\evil", ".json")).toThrow(
        PathTraversalError
      );
    });

    it("throws for absolute paths", () => {
      expect(() => buildSafeFilePath(baseDir, "/etc/passwd", ".json")).toThrow(
        PathTraversalError
      );
    });

    it("throws for paths with forward slashes", () => {
      expect(() => buildSafeFilePath(baseDir, "sub/dir", ".json")).toThrow(
        PathTraversalError
      );
    });

    it("throws for paths with backslashes", () => {
      expect(() => buildSafeFilePath(baseDir, "sub\\dir", ".json")).toThrow(
        PathTraversalError
      );
    });

    it("includes helpful info in the error", () => {
      try {
        buildSafeFilePath(baseDir, "../evil", ".json");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(PathTraversalError);
        const pathError = error as PathTraversalError;
        expect(pathError.baseDir).toBe(baseDir);
        expect(pathError.identifier).toBe("../evil");
        expect(pathError.message).toContain("invalid identifier");
      }
    });
  });

  describe("other invalid identifiers", () => {
    it("throws for empty identifier", () => {
      expect(() => buildSafeFilePath(baseDir, "", ".json")).toThrow(
        PathTraversalError
      );
    });

    it("throws for identifier starting with hyphen", () => {
      expect(() => buildSafeFilePath(baseDir, "-agent", ".json")).toThrow(
        PathTraversalError
      );
    });

    it("throws for identifier starting with underscore", () => {
      expect(() => buildSafeFilePath(baseDir, "_agent", ".json")).toThrow(
        PathTraversalError
      );
    });

    it("throws for identifier with spaces", () => {
      expect(() => buildSafeFilePath(baseDir, "my agent", ".json")).toThrow(
        PathTraversalError
      );
    });

    it("accepts identifiers with dots (qualified names)", () => {
      const result = buildSafeFilePath(baseDir, "herdctl.security-auditor", ".json");
      expect(result).toBe(join(baseDir, "herdctl.security-auditor.json"));
    });

    it("throws for identifier with special characters", () => {
      expect(() => buildSafeFilePath(baseDir, "agent@home", ".json")).toThrow(
        PathTraversalError
      );
      expect(() => buildSafeFilePath(baseDir, "agent$var", ".json")).toThrow(
        PathTraversalError
      );
      expect(() => buildSafeFilePath(baseDir, "agent%20", ".json")).toThrow(
        PathTraversalError
      );
    });
  });

  describe("edge cases", () => {
    it("handles relative base directory", () => {
      const result = buildSafeFilePath("./sessions", "agent", ".json");
      expect(result).toBe(join("./sessions", "agent.json"));
    });

    it("handles base directory with trailing slash", () => {
      const result = buildSafeFilePath("/base/dir/", "agent", ".json");
      expect(result).toBe(join("/base/dir/", "agent.json"));
    });

    it("handles extension without leading dot", () => {
      // This is technically valid usage even if unconventional
      const result = buildSafeFilePath(baseDir, "agent", "json");
      expect(result).toBe(join(baseDir, "agentjson"));
    });

    it("handles empty extension", () => {
      const result = buildSafeFilePath(baseDir, "agent", "");
      expect(result).toBe(join(baseDir, "agent"));
    });
  });
});
