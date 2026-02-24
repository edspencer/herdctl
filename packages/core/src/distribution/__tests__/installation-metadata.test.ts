import { describe, expect, it } from "vitest";
import {
  type InstallationMetadata,
  InstallationMetadataSchema,
  InstallationSourceSchema,
  ISO8601TimestampSchema,
  type SourceType,
  SourceTypeSchema,
} from "../installation-metadata.js";

describe("SourceTypeSchema", () => {
  it("accepts valid source types", () => {
    expect(SourceTypeSchema.parse("github")).toBe("github");
    expect(SourceTypeSchema.parse("local")).toBe("local");
    expect(() => SourceTypeSchema.parse("registry")).toThrow();
  });

  it("rejects invalid source types", () => {
    expect(() => SourceTypeSchema.parse("npm")).toThrow();
    expect(() => SourceTypeSchema.parse("git")).toThrow();
    expect(() => SourceTypeSchema.parse("")).toThrow();
    expect(() => SourceTypeSchema.parse(123)).toThrow();
  });
});

describe("ISO8601TimestampSchema", () => {
  it("accepts valid ISO 8601 timestamps with Z timezone", () => {
    expect(ISO8601TimestampSchema.parse("2024-01-15T10:30:00Z")).toBe("2024-01-15T10:30:00Z");
  });

  it("accepts timestamps with milliseconds", () => {
    expect(ISO8601TimestampSchema.parse("2024-01-15T10:30:00.123Z")).toBe(
      "2024-01-15T10:30:00.123Z",
    );
    expect(ISO8601TimestampSchema.parse("2024-01-15T10:30:00.123456Z")).toBe(
      "2024-01-15T10:30:00.123456Z",
    );
  });

  it("accepts timestamps with positive timezone offset", () => {
    expect(ISO8601TimestampSchema.parse("2024-01-15T10:30:00+05:30")).toBe(
      "2024-01-15T10:30:00+05:30",
    );
  });

  it("accepts timestamps with negative timezone offset", () => {
    expect(ISO8601TimestampSchema.parse("2024-01-15T10:30:00-08:00")).toBe(
      "2024-01-15T10:30:00-08:00",
    );
  });

  it("rejects invalid timestamp formats", () => {
    // Missing timezone
    expect(() => ISO8601TimestampSchema.parse("2024-01-15T10:30:00")).toThrow();

    // Date only
    expect(() => ISO8601TimestampSchema.parse("2024-01-15")).toThrow();

    // Invalid format
    expect(() => ISO8601TimestampSchema.parse("January 15, 2024 10:30:00")).toThrow();

    // Unix timestamp
    expect(() => ISO8601TimestampSchema.parse("1705313400")).toThrow();

    // Empty string
    expect(() => ISO8601TimestampSchema.parse("")).toThrow();
  });
});

describe("InstallationSourceSchema", () => {
  it("accepts source with only required type field", () => {
    const result = InstallationSourceSchema.parse({ type: "github" });
    expect(result).toEqual({ type: "github" });
  });

  it("accepts source with all optional fields", () => {
    const result = InstallationSourceSchema.parse({
      type: "github",
      url: "https://github.com/user/repo",
      ref: "v1.0.0",
      version: "1.0.0",
    });
    expect(result).toEqual({
      type: "github",
      url: "https://github.com/user/repo",
      ref: "v1.0.0",
      version: "1.0.0",
    });
  });

  it("accepts local source type", () => {
    const result = InstallationSourceSchema.parse({
      type: "local",
      url: "/home/user/agents/my-agent",
    });
    expect(result).toEqual({
      type: "local",
      url: "/home/user/agents/my-agent",
    });
  });

  it("rejects registry source type", () => {
    expect(() =>
      InstallationSourceSchema.parse({
        type: "registry",
        version: "2.0.0",
      }),
    ).toThrow();
  });

  it("rejects source without type", () => {
    expect(() => InstallationSourceSchema.parse({})).toThrow();
    expect(() => InstallationSourceSchema.parse({ url: "https://example.com" })).toThrow();
  });

  it("rejects invalid type", () => {
    expect(() => InstallationSourceSchema.parse({ type: "invalid" })).toThrow();
  });
});

describe("InstallationMetadataSchema", () => {
  describe("valid metadata", () => {
    it("accepts metadata with all fields", () => {
      const metadata = {
        source: {
          type: "github",
          url: "https://github.com/user/agent-repo",
          ref: "v1.0.0",
          version: "1.0.0",
        },
        installed_at: "2024-01-15T10:30:00Z",
        installed_by: "herdctl@0.5.0",
      };

      const result = InstallationMetadataSchema.parse(metadata);
      expect(result).toEqual(metadata);
    });

    it("accepts minimal valid metadata (only required fields)", () => {
      const metadata = {
        source: {
          type: "local",
        },
        installed_at: "2024-01-15T10:30:00Z",
      };

      const result = InstallationMetadataSchema.parse(metadata);
      expect(result).toEqual(metadata);
    });

    it("accepts metadata without installed_by", () => {
      const metadata = {
        source: {
          type: "github",
          url: "https://github.com/user/repo",
        },
        installed_at: "2024-06-20T14:45:30.500Z",
      };

      const result = InstallationMetadataSchema.parse(metadata);
      expect(result).toEqual(metadata);
    });
  });

  describe("source type variations", () => {
    it("accepts github source with ref", () => {
      const metadata = {
        source: {
          type: "github",
          url: "https://github.com/herdctl/example-agent",
          ref: "main",
        },
        installed_at: "2024-01-15T10:30:00Z",
      };

      const result = InstallationMetadataSchema.parse(metadata);
      expect(result.source.type).toBe("github");
      expect(result.source.ref).toBe("main");
    });

    it("accepts github source with commit SHA ref", () => {
      const metadata = {
        source: {
          type: "github",
          url: "https://github.com/herdctl/example-agent",
          ref: "abc123def456",
        },
        installed_at: "2024-01-15T10:30:00Z",
      };

      const result = InstallationMetadataSchema.parse(metadata);
      expect(result.source.ref).toBe("abc123def456");
    });

    it("accepts local source with path", () => {
      const metadata = {
        source: {
          type: "local",
          url: "./agents/my-custom-agent",
        },
        installed_at: "2024-01-15T10:30:00Z",
      };

      const result = InstallationMetadataSchema.parse(metadata);
      expect(result.source.type).toBe("local");
      expect(result.source.url).toBe("./agents/my-custom-agent");
    });
  });

  describe("missing required fields", () => {
    it("rejects metadata without source", () => {
      const metadata = {
        installed_at: "2024-01-15T10:30:00Z",
      };

      expect(() => InstallationMetadataSchema.parse(metadata)).toThrow();
    });

    it("rejects metadata without installed_at", () => {
      const metadata = {
        source: {
          type: "github",
        },
      };

      expect(() => InstallationMetadataSchema.parse(metadata)).toThrow();
    });

    it("rejects metadata without source.type", () => {
      const metadata = {
        source: {
          url: "https://github.com/user/repo",
        },
        installed_at: "2024-01-15T10:30:00Z",
      };

      expect(() => InstallationMetadataSchema.parse(metadata)).toThrow();
    });

    it("rejects empty object", () => {
      expect(() => InstallationMetadataSchema.parse({})).toThrow();
    });
  });

  describe("invalid field values", () => {
    it("rejects invalid source type", () => {
      const metadata = {
        source: {
          type: "npm",
        },
        installed_at: "2024-01-15T10:30:00Z",
      };

      expect(() => InstallationMetadataSchema.parse(metadata)).toThrow();
    });

    it("rejects invalid installed_at format", () => {
      const invalidTimestamps = [
        "2024-01-15", // date only
        "2024-01-15T10:30:00", // missing timezone
        "invalid-date",
        "1705313400", // unix timestamp
        "",
      ];

      for (const timestamp of invalidTimestamps) {
        const metadata = {
          source: { type: "github" },
          installed_at: timestamp,
        };

        expect(
          () => InstallationMetadataSchema.parse(metadata),
          `Expected "${timestamp}" to be rejected`,
        ).toThrow();
      }
    });

    it("rejects non-string installed_by", () => {
      const metadata = {
        source: { type: "github" },
        installed_at: "2024-01-15T10:30:00Z",
        installed_by: 123,
      };

      expect(() => InstallationMetadataSchema.parse(metadata)).toThrow();
    });
  });

  describe("schema extensibility", () => {
    it("allows unknown fields for future compatibility", () => {
      const metadata = {
        source: {
          type: "github",
          url: "https://github.com/user/repo",
        },
        installed_at: "2024-01-15T10:30:00Z",
        // Future fields that might be added for agentic init
        initialization: {
          required: true,
          completed_at: "2024-01-15T11:00:00Z",
        },
        custom_field: "some-value",
      };

      // Schema should not throw on unknown fields
      const result = InstallationMetadataSchema.parse(metadata);

      // Required fields should still be validated
      expect(result.source.type).toBe("github");
      expect(result.installed_at).toBe("2024-01-15T10:30:00Z");

      // Unknown fields should pass through (not stripped)
      expect((result as Record<string, unknown>).initialization).toEqual({
        required: true,
        completed_at: "2024-01-15T11:00:00Z",
      });
      expect((result as Record<string, unknown>).custom_field).toBe("some-value");
    });

    it("allows unknown fields in source object", () => {
      const metadata = {
        source: {
          type: "github",
          url: "https://github.com/user/repo",
          // Future source fields
          digest: "sha256:abc123",
          verified: true,
        },
        installed_at: "2024-01-15T10:30:00Z",
      };

      const result = InstallationMetadataSchema.parse(metadata);
      expect(result.source.type).toBe("github");
      expect((result.source as Record<string, unknown>).digest).toBe("sha256:abc123");
      expect((result.source as Record<string, unknown>).verified).toBe(true);
    });
  });

  describe("type inference", () => {
    it("correctly infers InstallationMetadata type", () => {
      const metadata: InstallationMetadata = {
        source: {
          type: "github",
          url: "https://github.com/user/repo",
          ref: "v1.0.0",
          version: "1.0.0",
        },
        installed_at: "2024-01-15T10:30:00Z",
        installed_by: "herdctl@0.5.0",
      };

      // This test verifies TypeScript type inference
      expect(metadata.source.type).toBe("github");
      expect(metadata.installed_at).toBe("2024-01-15T10:30:00Z");
    });

    it("correctly infers SourceType union", () => {
      const types: SourceType[] = ["github", "local"];
      expect(types).toHaveLength(2);
    });
  });
});
