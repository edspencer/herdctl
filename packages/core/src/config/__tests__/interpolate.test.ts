import { describe, expect, it } from "vitest";
import {
  interpolateConfig,
  interpolateString,
  interpolateValue,
  UndefinedVariableError,
} from "../interpolate.js";
import { ConfigError } from "../parser.js";

describe("interpolateString", () => {
  const mockEnv = {
    DB_HOST: "localhost",
    DB_PORT: "5432",
    DB_PASSWORD: "secret123",
    EMPTY_VAR: "",
    API_KEY: "abc-123-xyz",
  };

  describe("basic variable interpolation", () => {
    it("interpolates a single variable", () => {
      const result = interpolateString("${DB_HOST}", "test.host", mockEnv);
      expect(result).toBe("localhost");
    });

    it("interpolates multiple variables", () => {
      const result = interpolateString("${DB_HOST}:${DB_PORT}", "test.connection", mockEnv);
      expect(result).toBe("localhost:5432");
    });

    it("interpolates variable in the middle of a string", () => {
      const result = interpolateString(
        "postgresql://${DB_HOST}:${DB_PORT}/mydb",
        "test.url",
        mockEnv,
      );
      expect(result).toBe("postgresql://localhost:5432/mydb");
    });

    it("preserves strings without variables", () => {
      const result = interpolateString("no variables here", "test.plain", mockEnv);
      expect(result).toBe("no variables here");
    });

    it("preserves empty strings", () => {
      const result = interpolateString("", "test.empty", mockEnv);
      expect(result).toBe("");
    });

    it("interpolates empty environment variable value", () => {
      const result = interpolateString("value=${EMPTY_VAR}", "test.empty", mockEnv);
      expect(result).toBe("value=");
    });

    it("handles variable names with underscores", () => {
      const result = interpolateString("${API_KEY}", "test.key", mockEnv);
      expect(result).toBe("abc-123-xyz");
    });

    it("handles variable names starting with underscore", () => {
      const env = { _PRIVATE: "private_value" };
      const result = interpolateString("${_PRIVATE}", "test.private", env);
      expect(result).toBe("private_value");
    });
  });

  describe("default value syntax", () => {
    it("uses default when variable is undefined", () => {
      const result = interpolateString("${UNDEFINED_VAR:-default_value}", "test.default", mockEnv);
      expect(result).toBe("default_value");
    });

    it("uses environment value over default when defined", () => {
      const result = interpolateString("${DB_HOST:-fallback}", "test.override", mockEnv);
      expect(result).toBe("localhost");
    });

    it("uses default with empty string", () => {
      const result = interpolateString("${UNDEFINED:-}", "test.emptydefault", mockEnv);
      expect(result).toBe("");
    });

    it("handles default with special characters", () => {
      const result = interpolateString("${UNDEFINED:-http://localhost:8080}", "test.url", mockEnv);
      expect(result).toBe("http://localhost:8080");
    });

    it("handles default with spaces", () => {
      const result = interpolateString("${UNDEFINED:-hello world}", "test.spaces", mockEnv);
      expect(result).toBe("hello world");
    });

    it("handles multiple defaults in one string", () => {
      const result = interpolateString("${HOST:-localhost}:${PORT:-3000}", "test.multi", mockEnv);
      expect(result).toBe("localhost:3000");
    });

    it("mixes defined and undefined variables with defaults", () => {
      const result = interpolateString("${DB_HOST}:${PORT:-3000}", "test.mixed", mockEnv);
      expect(result).toBe("localhost:3000");
    });

    it("prefers empty string env value over default", () => {
      const result = interpolateString("${EMPTY_VAR:-fallback}", "test.emptypreferred", mockEnv);
      expect(result).toBe("");
    });
  });

  describe("error handling", () => {
    it("throws UndefinedVariableError for undefined variable without default", () => {
      expect(() => interpolateString("${UNDEFINED_VAR}", "test.path", mockEnv)).toThrow(
        UndefinedVariableError,
      );
    });

    it("includes variable name in error", () => {
      try {
        interpolateString("${MY_UNDEFINED_VAR}", "test.path", mockEnv);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(UndefinedVariableError);
        const undefinedError = error as UndefinedVariableError;
        expect(undefinedError.variableName).toBe("MY_UNDEFINED_VAR");
      }
    });

    it("includes path in error", () => {
      try {
        interpolateString("${UNDEFINED}", "config.database.password", mockEnv);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(UndefinedVariableError);
        const undefinedError = error as UndefinedVariableError;
        expect(undefinedError.path).toBe("config.database.password");
      }
    });

    it("includes helpful error message", () => {
      try {
        interpolateString("${SECRET}", "db.password", mockEnv);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(UndefinedVariableError);
        expect((error as Error).message).toContain("SECRET");
        expect((error as Error).message).toContain("db.password");
        expect((error as Error).message).toContain("no default");
      }
    });
  });

  describe("edge cases", () => {
    it("handles consecutive variables", () => {
      const result = interpolateString("${DB_HOST}${DB_PORT}", "test", mockEnv);
      expect(result).toBe("localhost5432");
    });

    it("does not match $VAR without braces", () => {
      const result = interpolateString("$DB_HOST", "test", mockEnv);
      expect(result).toBe("$DB_HOST");
    });

    it("does not match ${} with empty name", () => {
      const result = interpolateString("${}", "test", mockEnv);
      expect(result).toBe("${}");
    });

    it("does not match malformed patterns", () => {
      const result = interpolateString("${DB_HOST", "test", mockEnv);
      expect(result).toBe("${DB_HOST");
    });

    it("handles numeric-looking variable names", () => {
      const env = { VAR123: "numeric" };
      const result = interpolateString("${VAR123}", "test", env);
      expect(result).toBe("numeric");
    });

    it("does not match variable names starting with number", () => {
      const env = { "123VAR": "should not match" };
      const result = interpolateString("${123VAR}", "test", env);
      expect(result).toBe("${123VAR}");
    });

    it("handles nested braces in default value", () => {
      const result = interpolateString("${UNDEFINED:-{key: value}}", "test", mockEnv);
      expect(result).toBe("{key: value}");
    });
  });
});

describe("interpolateValue", () => {
  const mockEnv = {
    HOST: "example.com",
    PORT: "8080",
    ENABLED: "true",
  };

  describe("string values", () => {
    it("interpolates string values", () => {
      const result = interpolateValue("${HOST}", "test", mockEnv);
      expect(result).toBe("example.com");
    });
  });

  describe("non-string primitives", () => {
    it("preserves numbers", () => {
      const result = interpolateValue(42, "test.num", mockEnv);
      expect(result).toBe(42);
    });

    it("preserves floating point numbers", () => {
      const result = interpolateValue(3.14, "test.float", mockEnv);
      expect(result).toBe(3.14);
    });

    it("preserves booleans - true", () => {
      const result = interpolateValue(true, "test.bool", mockEnv);
      expect(result).toBe(true);
    });

    it("preserves booleans - false", () => {
      const result = interpolateValue(false, "test.bool", mockEnv);
      expect(result).toBe(false);
    });

    it("preserves null", () => {
      const result = interpolateValue(null, "test.null", mockEnv);
      expect(result).toBe(null);
    });

    it("preserves undefined", () => {
      const result = interpolateValue(undefined, "test.undefined", mockEnv);
      expect(result).toBe(undefined);
    });

    it("preserves zero", () => {
      const result = interpolateValue(0, "test.zero", mockEnv);
      expect(result).toBe(0);
    });

    it("preserves negative numbers", () => {
      const result = interpolateValue(-5, "test.negative", mockEnv);
      expect(result).toBe(-5);
    });
  });

  describe("arrays", () => {
    it("interpolates strings in arrays", () => {
      const result = interpolateValue(["${HOST}", "static"], "test.arr", mockEnv);
      expect(result).toEqual(["example.com", "static"]);
    });

    it("preserves non-string values in arrays", () => {
      const result = interpolateValue(["str", 42, true, null], "test.arr", mockEnv);
      expect(result).toEqual(["str", 42, true, null]);
    });

    it("interpolates nested arrays", () => {
      const result = interpolateValue([["${HOST}"], ["${PORT}"]], "test.nested", mockEnv);
      expect(result).toEqual([["example.com"], ["8080"]]);
    });

    it("handles empty arrays", () => {
      const result = interpolateValue([], "test.empty", mockEnv);
      expect(result).toEqual([]);
    });

    it("builds correct path for array elements", () => {
      expect(() => interpolateValue(["${UNDEFINED}"], "", mockEnv)).toThrowError(/\[0\]/);
    });
  });

  describe("objects", () => {
    it("interpolates string values in objects", () => {
      const result = interpolateValue({ host: "${HOST}" }, "test", mockEnv);
      expect(result).toEqual({ host: "example.com" });
    });

    it("preserves non-string values in objects", () => {
      const result = interpolateValue({ str: "text", num: 42, bool: true }, "test", mockEnv);
      expect(result).toEqual({ str: "text", num: 42, bool: true });
    });

    it("handles nested objects", () => {
      const input = {
        level1: {
          level2: {
            host: "${HOST}",
          },
        },
      };
      const result = interpolateValue(input, "config", mockEnv);
      expect(result).toEqual({
        level1: {
          level2: {
            host: "example.com",
          },
        },
      });
    });

    it("handles empty objects", () => {
      const result = interpolateValue({}, "test.empty", mockEnv);
      expect(result).toEqual({});
    });

    it("handles mixed objects with arrays", () => {
      const input = {
        hosts: ["${HOST}", "localhost"],
        config: {
          port: 8080,
          tags: ["${ENABLED}", "prod"],
        },
      };
      const result = interpolateValue(input, "test", mockEnv);
      expect(result).toEqual({
        hosts: ["example.com", "localhost"],
        config: {
          port: 8080,
          tags: ["true", "prod"],
        },
      });
    });

    it("builds correct path for nested properties", () => {
      try {
        interpolateValue({ db: { password: "${UNDEFINED}" } }, "config", mockEnv);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(UndefinedVariableError);
        expect((error as UndefinedVariableError).path).toBe("config.db.password");
      }
    });
  });

  describe("deeply nested structures", () => {
    it("works at arbitrary nesting depth", () => {
      const input = {
        l1: {
          l2: {
            l3: {
              l4: {
                l5: {
                  value: "${HOST}",
                },
              },
            },
          },
        },
      };
      const result = interpolateValue(input, "", mockEnv) as typeof input;
      expect(result.l1.l2.l3.l4.l5.value).toBe("example.com");
    });

    it("handles complex mixed structures", () => {
      const input = {
        servers: [
          {
            host: "${HOST}",
            port: 8080,
            enabled: true,
            tags: ["${ENABLED:-false}", "primary"],
          },
          {
            host: "${BACKUP_HOST:-backup.example.com}",
            port: 8081,
            enabled: false,
            tags: ["backup"],
          },
        ],
        metadata: {
          version: 1,
          description: "Config for ${HOST}",
        },
      };

      const result = interpolateValue(input, "", mockEnv);
      expect(result).toEqual({
        servers: [
          {
            host: "example.com",
            port: 8080,
            enabled: true,
            tags: ["true", "primary"],
          },
          {
            host: "backup.example.com",
            port: 8081,
            enabled: false,
            tags: ["backup"],
          },
        ],
        metadata: {
          version: 1,
          description: "Config for example.com",
        },
      });
    });
  });

  describe("path building", () => {
    it("starts with empty path at root", () => {
      expect(() => interpolateValue({ key: "${UNDEFINED}" }, "", mockEnv)).toThrow(
        /^Undefined environment variable 'UNDEFINED' at 'key'/,
      );
    });

    it("builds path correctly from root", () => {
      try {
        interpolateValue({ a: { b: { c: "${UNDEFINED}" } } }, "", mockEnv);
        expect.fail("Should have thrown");
      } catch (error) {
        expect((error as UndefinedVariableError).path).toBe("a.b.c");
      }
    });

    it("handles array indices in path", () => {
      try {
        interpolateValue({ arr: [{ val: "${UNDEFINED}" }] }, "root", mockEnv);
        expect.fail("Should have thrown");
      } catch (error) {
        expect((error as UndefinedVariableError).path).toBe("root.arr[0].val");
      }
    });
  });
});

describe("interpolateConfig", () => {
  describe("basic usage", () => {
    it("interpolates a configuration object", () => {
      const config = {
        database: {
          host: "${DB_HOST:-localhost}",
          port: 5432,
          password: "${DB_PASS}",
        },
      };

      const result = interpolateConfig(config, {
        env: { DB_PASS: "secret" },
      });

      expect(result).toEqual({
        database: {
          host: "localhost",
          port: 5432,
          password: "secret",
        },
      });
    });

    it("uses process.env by default", () => {
      const originalEnv = process.env.TEST_INTERPOLATE_VAR;
      process.env.TEST_INTERPOLATE_VAR = "test_value";

      try {
        const config = { key: "${TEST_INTERPOLATE_VAR}" };
        const result = interpolateConfig(config);
        expect(result.key).toBe("test_value");
      } finally {
        if (originalEnv === undefined) {
          delete process.env.TEST_INTERPOLATE_VAR;
        } else {
          process.env.TEST_INTERPOLATE_VAR = originalEnv;
        }
      }
    });

    it("accepts custom env object via options", () => {
      const config = { key: "${CUSTOM_VAR}" };
      const result = interpolateConfig(config, {
        env: { CUSTOM_VAR: "custom_value" },
      });
      expect(result.key).toBe("custom_value");
    });
  });

  describe("type preservation", () => {
    it("preserves the type of the config object", () => {
      interface MyConfig {
        host: string;
        port: number;
        enabled: boolean;
      }

      const config: MyConfig = {
        host: "${HOST:-localhost}",
        port: 3000,
        enabled: true,
      };

      const result: MyConfig = interpolateConfig(config, { env: {} });

      expect(result.host).toBe("localhost");
      expect(result.port).toBe(3000);
      expect(result.enabled).toBe(true);
    });
  });

  describe("real-world config examples", () => {
    it("interpolates a fleet configuration", () => {
      const fleetConfig = {
        version: 1,
        workspace: {
          root: "${WORKSPACE_ROOT:-/tmp/herdctl}",
        },
        defaults: {
          docker: {
            enabled: true,
            base_image: "${DOCKER_IMAGE:-herdctl:latest}",
          },
        },
        chat: {
          discord: {
            enabled: true,
            token_env: "DISCORD_BOT_TOKEN",
          },
        },
      };

      const result = interpolateConfig(fleetConfig, {
        env: {
          WORKSPACE_ROOT: "/home/user/workspace",
        },
      });

      expect(result.workspace.root).toBe("/home/user/workspace");
      expect(result.defaults.docker.base_image).toBe("herdctl:latest");
      expect(result.chat.discord.token_env).toBe("DISCORD_BOT_TOKEN");
    });

    it("interpolates an agent configuration", () => {
      const agentConfig = {
        name: "test-agent",
        workspace: "${AGENT_WORKSPACE}",
        session: {
          max_turns: 100,
          timeout: "${SESSION_TIMEOUT:-30m}",
          model: "${MODEL:-claude-sonnet-4-20250514}",
        },
        mcp_servers: {
          github: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: {
              GITHUB_TOKEN: "${GITHUB_TOKEN}",
            },
          },
        },
      };

      const result = interpolateConfig(agentConfig, {
        env: {
          AGENT_WORKSPACE: "/workspace/agent1",
          GITHUB_TOKEN: "ghp_xxxxx",
        },
      });

      expect(result.name).toBe("test-agent");
      expect(result.workspace).toBe("/workspace/agent1");
      expect(result.session.timeout).toBe("30m");
      expect(result.session.model).toBe("claude-sonnet-4-20250514");
      expect(result.mcp_servers.github.env.GITHUB_TOKEN).toBe("ghp_xxxxx");
    });
  });
});

describe("UndefinedVariableError", () => {
  it("extends ConfigError", () => {
    const error = new UndefinedVariableError("VAR", "path");
    expect(error).toBeInstanceOf(ConfigError);
  });

  it("has correct name", () => {
    const error = new UndefinedVariableError("VAR", "path");
    expect(error.name).toBe("UndefinedVariableError");
  });

  it("exposes variableName property", () => {
    const error = new UndefinedVariableError("MY_VAR", "some.path");
    expect(error.variableName).toBe("MY_VAR");
  });

  it("exposes path property", () => {
    const error = new UndefinedVariableError("MY_VAR", "some.path");
    expect(error.path).toBe("some.path");
  });

  it("includes helpful message", () => {
    const error = new UndefinedVariableError("SECRET_KEY", "config.api.key");
    expect(error.message).toContain("SECRET_KEY");
    expect(error.message).toContain("config.api.key");
    expect(error.message).toContain("no default");
  });
});
