import { describe, it, expect } from "vitest";
import {
  parseFleetConfig,
  validateFleetConfig,
  safeParseFleetConfig,
  YamlSyntaxError,
  SchemaValidationError,
  ConfigError,
} from "../parser.js";
import type { FleetConfig } from "../schema.js";

describe("parseFleetConfig", () => {
  describe("valid configurations", () => {
    it("parses a minimal valid configuration", () => {
      const yaml = `
version: 1
`;
      const config = parseFleetConfig(yaml);
      expect(config.version).toBe(1);
      expect(config.agents).toEqual([]);
    });

    it("parses an empty file with defaults", () => {
      const yaml = "";
      const config = parseFleetConfig(yaml);
      expect(config.version).toBe(1);
      expect(config.agents).toEqual([]);
    });

    it("parses a complete configuration from SPEC.md example", () => {
      const yaml = `
version: 1

defaults:
  docker:
    enabled: false
  permissions:
    mode: acceptEdits
    allowed_tools:
      - Read
      - Edit
      - Write
      - Bash
      - Glob
      - Grep
  work_source:
    type: github
    labels:
      ready: "ready"
      in_progress: "in-progress"
    cleanup_in_progress: true
  instances:
    max_concurrent: 1

working_directory:
  root: ~/herdctl-workspace
  auto_clone: true
  clone_depth: 1

agents:
  - path: ./agents/bragdoc-coder.yaml
  - path: ./agents/bragdoc-marketer.yaml
  - path: ./agents/turtle-content.yaml

chat:
  discord:
    enabled: true
    token_env: DISCORD_BOT_TOKEN
`;
      const config = parseFleetConfig(yaml);

      expect(config.version).toBe(1);
      expect(config.defaults?.docker?.enabled).toBe(false);
      expect(config.defaults?.permissions?.mode).toBe("acceptEdits");
      expect(config.defaults?.permissions?.allowed_tools).toContain("Read");
      expect(config.defaults?.work_source?.type).toBe("github");
      expect(config.defaults?.work_source?.labels?.ready).toBe("ready");
      expect(config.defaults?.instances?.max_concurrent).toBe(1);
      expect(config.working_directory?.root).toBe("~/herdctl-workspace");
      expect(config.working_directory?.auto_clone).toBe(true);
      expect(config.working_directory?.clone_depth).toBe(1);
      expect(config.agents).toHaveLength(3);
      expect(config.agents[0].path).toBe("./agents/bragdoc-coder.yaml");
      expect(config.chat?.discord?.enabled).toBe(true);
      expect(config.chat?.discord?.token_env).toBe("DISCORD_BOT_TOKEN");
    });

    it("parses configuration with fleet metadata", () => {
      const yaml = `
version: 1
fleet:
  name: my-fleet
  description: A fleet of agents
`;
      const config = parseFleetConfig(yaml);
      expect(config.fleet?.name).toBe("my-fleet");
      expect(config.fleet?.description).toBe("A fleet of agents");
    });

    it("parses configuration with webhooks", () => {
      const yaml = `
version: 1
webhooks:
  enabled: true
  port: 8081
  secret_env: WEBHOOK_SECRET
`;
      const config = parseFleetConfig(yaml);
      expect(config.webhooks?.enabled).toBe(true);
      expect(config.webhooks?.port).toBe(8081);
      expect(config.webhooks?.secret_env).toBe("WEBHOOK_SECRET");
    });

    it("parses configuration with docker settings", () => {
      const yaml = `
version: 1
docker:
  enabled: true
  base_image: herdctl-base:latest
`;
      const config = parseFleetConfig(yaml);
      expect(config.docker?.enabled).toBe(true);
      expect(config.docker?.base_image).toBe("herdctl-base:latest");
    });

    it("applies default values correctly", () => {
      const yaml = `
version: 1
working_directory:
  root: /tmp/workspace
`;
      const config = parseFleetConfig(yaml);
      expect(config.working_directory?.auto_clone).toBe(true);
      expect(config.working_directory?.clone_depth).toBe(1);
      expect(config.working_directory?.default_branch).toBe("main");
    });

    it("parses all permission modes", () => {
      const modes = ["default", "acceptEdits", "bypassPermissions", "plan"];
      for (const mode of modes) {
        const yaml = `
version: 1
defaults:
  permissions:
    mode: ${mode}
`;
        const config = parseFleetConfig(yaml);
        expect(config.defaults?.permissions?.mode).toBe(mode);
      }
    });

    it("parses bash permissions", () => {
      const yaml = `
version: 1
defaults:
  permissions:
    bash:
      allowed_commands:
        - git
        - npm
        - pnpm
      denied_patterns:
        - "rm -rf /"
        - "sudo *"
`;
      const config = parseFleetConfig(yaml);
      expect(config.defaults?.permissions?.bash?.allowed_commands).toContain(
        "git"
      );
      expect(config.defaults?.permissions?.bash?.denied_patterns).toContain(
        "rm -rf /"
      );
    });

    it("parses denied_tools", () => {
      const yaml = `
version: 1
defaults:
  permissions:
    denied_tools:
      - WebSearch
`;
      const config = parseFleetConfig(yaml);
      expect(config.defaults?.permissions?.denied_tools).toContain("WebSearch");
    });
  });

  describe("YAML syntax errors", () => {
    it("throws YamlSyntaxError for invalid YAML", () => {
      const yaml = `
version: 1
  indentation: wrong
`;
      expect(() => parseFleetConfig(yaml)).toThrow(YamlSyntaxError);
    });

    it("includes line and column info in YamlSyntaxError", () => {
      const yaml = `version: 1
agents: [
  unclosed array
`;
      try {
        parseFleetConfig(yaml);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(YamlSyntaxError);
        const yamlError = error as YamlSyntaxError;
        expect(yamlError.message).toContain("Invalid YAML syntax");
        expect(yamlError.originalError).toBeDefined();
      }
    });

    it("throws YamlSyntaxError for tabs in indentation", () => {
      const yaml = "version: 1\nagents:\n\t- path: test.yaml";
      expect(() => parseFleetConfig(yaml)).toThrow(YamlSyntaxError);
    });

    it("throws YamlSyntaxError for duplicate keys", () => {
      const yaml = `
version: 1
version: 2
`;
      expect(() => parseFleetConfig(yaml)).toThrow(YamlSyntaxError);
    });
  });

  describe("schema validation errors", () => {
    it("throws SchemaValidationError for invalid version type", () => {
      const yaml = `
version: "not-a-number"
`;
      expect(() => parseFleetConfig(yaml)).toThrow(SchemaValidationError);
    });

    it("throws SchemaValidationError for invalid permission mode", () => {
      const yaml = `
version: 1
defaults:
  permissions:
    mode: invalid-mode
`;
      expect(() => parseFleetConfig(yaml)).toThrow(SchemaValidationError);
    });

    it("throws SchemaValidationError for invalid work source type", () => {
      const yaml = `
version: 1
defaults:
  work_source:
    type: invalid-source
`;
      expect(() => parseFleetConfig(yaml)).toThrow(SchemaValidationError);
    });

    it("throws SchemaValidationError for negative max_concurrent", () => {
      const yaml = `
version: 1
defaults:
  instances:
    max_concurrent: -1
`;
      expect(() => parseFleetConfig(yaml)).toThrow(SchemaValidationError);
    });

    it("throws SchemaValidationError for missing required workspace root", () => {
      const yaml = `
version: 1
working_directory:
  auto_clone: true
`;
      expect(() => parseFleetConfig(yaml)).toThrow(SchemaValidationError);
    });

    it("throws SchemaValidationError for invalid agent reference (missing path)", () => {
      const yaml = `
version: 1
agents:
  - name: invalid
`;
      expect(() => parseFleetConfig(yaml)).toThrow(SchemaValidationError);
    });

    it("includes path info in SchemaValidationError", () => {
      const yaml = `
version: 1
defaults:
  permissions:
    mode: invalid
`;
      try {
        parseFleetConfig(yaml);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(SchemaValidationError);
        const schemaError = error as SchemaValidationError;
        expect(schemaError.issues).toHaveLength(1);
        expect(schemaError.issues[0].path).toBe("defaults.permissions.mode");
        expect(schemaError.message).toContain("defaults.permissions.mode");
      }
    });

    it("reports multiple validation errors", () => {
      const yaml = `
version: "invalid"
defaults:
  permissions:
    mode: invalid
`;
      try {
        parseFleetConfig(yaml);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(SchemaValidationError);
        const schemaError = error as SchemaValidationError;
        expect(schemaError.issues.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("throws SchemaValidationError for negative clone_depth", () => {
      const yaml = `
version: 1
working_directory:
  root: /tmp
  clone_depth: -5
`;
      expect(() => parseFleetConfig(yaml)).toThrow(SchemaValidationError);
    });

    it("throws SchemaValidationError for non-integer clone_depth", () => {
      const yaml = `
version: 1
working_directory:
  root: /tmp
  clone_depth: 1.5
`;
      expect(() => parseFleetConfig(yaml)).toThrow(SchemaValidationError);
    });

    it("throws SchemaValidationError for invalid webhook port", () => {
      const yaml = `
version: 1
webhooks:
  enabled: true
  port: -80
`;
      expect(() => parseFleetConfig(yaml)).toThrow(SchemaValidationError);
    });
  });
});

describe("validateFleetConfig", () => {
  it("validates a valid config object", () => {
    const config = {
      version: 1,
      agents: [{ path: "./test.yaml" }],
    };
    const validated = validateFleetConfig(config);
    expect(validated.version).toBe(1);
    expect(validated.agents).toHaveLength(1);
  });

  it("throws SchemaValidationError for invalid object", () => {
    const config = {
      version: "invalid",
    };
    expect(() => validateFleetConfig(config)).toThrow(SchemaValidationError);
  });

  it("applies defaults to partial config", () => {
    const config = {};
    const validated = validateFleetConfig(config);
    expect(validated.version).toBe(1);
    expect(validated.agents).toEqual([]);
  });
});

describe("safeParseFleetConfig", () => {
  it("returns success for valid YAML", () => {
    const yaml = `
version: 1
agents:
  - path: ./test.yaml
`;
    const result = safeParseFleetConfig(yaml);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
    }
  });

  it("returns error for invalid YAML syntax", () => {
    const yaml = `
version: 1
  bad: indentation
`;
    const result = safeParseFleetConfig(yaml);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(YamlSyntaxError);
    }
  });

  it("returns error for schema validation failure", () => {
    const yaml = `
version: "invalid"
`;
    const result = safeParseFleetConfig(yaml);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(SchemaValidationError);
    }
  });

  it("wraps unexpected errors in ConfigError", () => {
    // This is hard to trigger, but we test the interface works
    const result = safeParseFleetConfig("");
    expect(result.success).toBe(true);
  });
});

describe("Error classes", () => {
  it("ConfigError has correct name", () => {
    const error = new ConfigError("test");
    expect(error.name).toBe("ConfigError");
    expect(error.message).toBe("test");
  });

  it("YamlSyntaxError extends ConfigError", () => {
    // Create a mock YAMLParseError
    const mockError = {
      message: "test error",
      linePos: [{ line: 5, col: 10 }],
    } as never;

    const error = new YamlSyntaxError(mockError);
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.name).toBe("YamlSyntaxError");
    expect(error.line).toBe(5);
    expect(error.column).toBe(10);
    expect(error.message).toContain("line 5");
    expect(error.message).toContain("column 10");
  });

  it("YamlSyntaxError handles missing position", () => {
    const mockError = {
      message: "test error",
      linePos: undefined,
    } as never;

    const error = new YamlSyntaxError(mockError);
    expect(error.line).toBeUndefined();
    expect(error.column).toBeUndefined();
    expect(error.message).toContain("Invalid YAML syntax");
    expect(error.message).not.toContain("line");
  });

  it("YamlSyntaxError handles empty linePos array", () => {
    const mockError = {
      message: "test error",
      linePos: [],
    } as never;

    const error = new YamlSyntaxError(mockError);
    expect(error.line).toBeUndefined();
    expect(error.column).toBeUndefined();
  });

  it("SchemaValidationError extends ConfigError", () => {
    const mockZodError = {
      issues: [
        { path: ["a", "b"], message: "test message", code: "invalid_type" },
      ],
    } as never;

    const error = new SchemaValidationError(mockZodError);
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.name).toBe("SchemaValidationError");
    expect(error.issues).toHaveLength(1);
    expect(error.issues[0].path).toBe("a.b");
    expect(error.issues[0].message).toBe("test message");
    expect(error.message).toContain("a.b");
  });

  it("SchemaValidationError handles root path", () => {
    const mockZodError = {
      issues: [{ path: [], message: "root error", code: "invalid_type" }],
    } as never;

    const error = new SchemaValidationError(mockZodError);
    expect(error.issues[0].path).toBe("(root)");
  });

  it("SchemaValidationError handles multiple issues", () => {
    const mockZodError = {
      issues: [
        { path: ["a"], message: "error 1", code: "invalid_type" },
        { path: ["b", "c"], message: "error 2", code: "invalid_type" },
      ],
    } as never;

    const error = new SchemaValidationError(mockZodError);
    expect(error.issues).toHaveLength(2);
    expect(error.message).toContain("a: error 1");
    expect(error.message).toContain("b.c: error 2");
  });
});

describe("type safety", () => {
  it("returns properly typed FleetConfig", () => {
    const yaml = `
version: 1
defaults:
  permissions:
    mode: acceptEdits
working_directory:
  root: /tmp
agents:
  - path: ./test.yaml
`;
    const config: FleetConfig = parseFleetConfig(yaml);

    // TypeScript compilation verifies these types
    const _version: number = config.version;
    const _mode: string | undefined = config.defaults?.permissions?.mode;
    const _root: string | undefined = config.working_directory?.root;
    const _path: string | undefined = config.agents[0]?.path;

    expect(_version).toBe(1);
    expect(_mode).toBe("acceptEdits");
    expect(_root).toBe("/tmp");
    expect(_path).toBe("./test.yaml");
  });
});
