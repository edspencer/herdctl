import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AgentValidationError,
  AgentYamlSyntaxError,
  FileReadError,
  loadAgentConfig,
  parseAgentConfig,
  resolveAgentPath,
  safeParseAgentConfig,
  validateAgentConfig,
} from "../parser.js";
import type { AgentConfig } from "../schema.js";
import {
  AgentChatSchema,
  AgentConfigSchema,
  IdentitySchema,
  McpServerSchema,
  ScheduleSchema,
  SessionSchema,
} from "../schema.js";

describe("AgentConfigSchema", () => {
  it("validates minimal agent config with just name", () => {
    const result = AgentConfigSchema.safeParse({ name: "test-agent" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("test-agent");
    }
  });

  describe("agent name validation (path traversal protection)", () => {
    const validNames = [
      "agent",
      "my-agent",
      "my_agent",
      "agent123",
      "Agent",
      "AGENT",
      "a",
      "1agent",
      "job-2024-01-15-abc123",
    ];

    it.each(validNames)("accepts valid name: %s", (name) => {
      const result = AgentConfigSchema.safeParse({ name });
      expect(result.success).toBe(true);
    });

    const invalidNames = [
      ["../parent", "path traversal"],
      ["/absolute/path", "absolute path"],
      ["with/slash", "forward slash"],
      ["with\\backslash", "backslash"],
      ["with space", "space"],
      ["-starts-hyphen", "starts with hyphen"],
      ["_starts-underscore", "starts with underscore"],
      ["", "empty string"],
      ["has.dot", "dot character"],
      ["has@symbol", "at symbol"],
    ];

    it.each(invalidNames)("rejects invalid name: %s (%s)", (name) => {
      const result = AgentConfigSchema.safeParse({ name });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain("name");
      }
    });
  });

  it("validates complete agent config with all fields", () => {
    const config = {
      name: "bragdoc-coder",
      description: "A coding assistant agent",
      working_directory: "/home/agent/workspace",
      repo: "https://github.com/example/repo",
      identity: {
        name: "Cody",
        role: "developer",
        personality: "helpful and concise",
      },
      system_prompt: "You are a helpful coding assistant.",
      work_source: {
        type: "github",
        labels: {
          ready: "ready",
          in_progress: "in-progress",
        },
        cleanup_in_progress: true,
      },
      schedules: {
        main: {
          type: "interval",
          interval: "5m",
          prompt: "Check for new issues",
        },
        daily: {
          type: "cron",
          cron: "0 9 * * *",
          prompt: "Daily check",
        },
      },
      session: {
        max_turns: 50,
        timeout: "30m",
        model: "claude-sonnet-4-20250514",
      },
      permission_mode: "acceptEdits",
      allowed_tools: ["Read", "Edit", "Write", "Bash(git *)", "Bash(npm *)"],
      denied_tools: ["WebSearch", "Bash(rm -rf *)"],
      mcp_servers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: {
            GITHUB_TOKEN: "${GITHUB_TOKEN}",
          },
        },
        filesystem: {
          url: "http://localhost:3000/mcp",
        },
      },
      chat: {
        discord: {
          bot_token_env: "DISCORD_BOT_TOKEN",
          guilds: [
            {
              id: "123456789",
              channels: [{ id: "987654321", name: "#general", mode: "mention" }],
            },
          ],
        },
      },
      model: "claude-sonnet-4-20250514",
      max_turns: 100,
    };

    const result = AgentConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("bragdoc-coder");
      expect(result.data.description).toBe("A coding assistant agent");
      expect(result.data.identity?.name).toBe("Cody");
      expect(result.data.schedules?.main.type).toBe("interval");
      expect(result.data.schedules?.daily.type).toBe("cron");
      expect(result.data.mcp_servers?.github.command).toBe("npx");
      expect(result.data.chat?.discord?.guilds[0].id).toBe("123456789");
    }
  });

  it("rejects agent config without name", () => {
    const result = AgentConfigSchema.safeParse({
      description: "An agent without a name",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid permission mode", () => {
    const result = AgentConfigSchema.safeParse({
      name: "test-agent",
      permission_mode: "invalid-mode",
    });
    expect(result.success).toBe(false);
  });

  it("accepts workspace as string path", () => {
    const result = AgentConfigSchema.safeParse({
      name: "test-agent",
      working_directory: "/path/to/workspace",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.working_directory).toBe("/path/to/workspace");
    }
  });

  it("accepts workspace as full workspace object", () => {
    const result = AgentConfigSchema.safeParse({
      name: "test-agent",
      working_directory: {
        root: "/path/to/workspace",
        auto_clone: false,
        clone_depth: 5,
        default_branch: "develop",
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const working_directory = result.data.working_directory;
      expect(typeof working_directory).toBe("object");
      if (typeof working_directory === "object" && working_directory !== null) {
        expect(working_directory.root).toBe("/path/to/workspace");
        expect(working_directory.auto_clone).toBe(false);
      }
    }
  });

  it("rejects negative max_turns", () => {
    const result = AgentConfigSchema.safeParse({
      name: "test-agent",
      max_turns: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer max_turns", () => {
    const result = AgentConfigSchema.safeParse({
      name: "test-agent",
      max_turns: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("accepts allowed_tools and denied_tools at root level", () => {
    const result = AgentConfigSchema.safeParse({
      name: "test-agent",
      allowed_tools: ["WebSearch", "WebFetch", "Bash(git *)"],
      denied_tools: ["Bash(rm *)"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allowed_tools).toEqual(["WebSearch", "WebFetch", "Bash(git *)"]);
      expect(result.data.denied_tools).toEqual(["Bash(rm *)"]);
    }
  });

  it("accepts permission_mode at root level", () => {
    const result = AgentConfigSchema.safeParse({
      name: "test-agent",
      permission_mode: "bypassPermissions",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.permission_mode).toBe("bypassPermissions");
    }
  });
});

describe("IdentitySchema", () => {
  it("parses empty identity", () => {
    const result = IdentitySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("parses complete identity", () => {
    const identity = {
      name: "Claude",
      role: "assistant",
      personality: "helpful and friendly",
    };
    const result = IdentitySchema.safeParse(identity);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Claude");
      expect(result.data.role).toBe("assistant");
      expect(result.data.personality).toBe("helpful and friendly");
    }
  });
});

describe("SessionSchema", () => {
  it("parses empty session", () => {
    const result = SessionSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("parses complete session", () => {
    const session = {
      max_turns: 100,
      timeout: "1h",
      model: "claude-opus-4-20250514",
    };
    const result = SessionSchema.safeParse(session);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_turns).toBe(100);
      expect(result.data.timeout).toBe("1h");
      expect(result.data.model).toBe("claude-opus-4-20250514");
    }
  });

  it("rejects non-positive max_turns", () => {
    const result = SessionSchema.safeParse({ max_turns: 0 });
    expect(result.success).toBe(false);
  });
});

describe("ScheduleSchema", () => {
  it("parses interval schedule", () => {
    const schedule = {
      type: "interval",
      interval: "5m",
      prompt: "Check for updates",
    };
    const result = ScheduleSchema.safeParse(schedule);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("interval");
      expect(result.data.interval).toBe("5m");
    }
  });

  it("parses cron schedule", () => {
    const schedule = {
      type: "cron",
      cron: "0 9 * * 1-5",
      prompt: "Morning check",
    };
    const result = ScheduleSchema.safeParse(schedule);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("cron");
      expect(result.data.cron).toBe("0 9 * * 1-5");
    }
  });

  it("accepts expression as backward-compat alias for cron", () => {
    const schedule = {
      type: "cron",
      expression: "0 9 * * 1-5",
      prompt: "Morning check",
    };
    const result = ScheduleSchema.safeParse(schedule);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("cron");
      expect(result.data.cron).toBe("0 9 * * 1-5");
      expect("expression" in result.data).toBe(false);
    }
  });

  it("parses webhook schedule", () => {
    const schedule = {
      type: "webhook",
      prompt: "Handle webhook",
    };
    const result = ScheduleSchema.safeParse(schedule);
    expect(result.success).toBe(true);
  });

  it("parses chat schedule", () => {
    const schedule = {
      type: "chat",
    };
    const result = ScheduleSchema.safeParse(schedule);
    expect(result.success).toBe(true);
  });

  it("parses schedule with work_source override", () => {
    const schedule = {
      type: "interval",
      interval: "10m",
      work_source: {
        type: "github",
        labels: {
          ready: "urgent",
        },
      },
    };
    const result = ScheduleSchema.safeParse(schedule);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.work_source?.labels?.ready).toBe("urgent");
    }
  });

  it("rejects invalid schedule type", () => {
    const result = ScheduleSchema.safeParse({
      type: "invalid",
    });
    expect(result.success).toBe(false);
  });
});

describe("McpServerSchema", () => {
  it("parses command-based MCP server", () => {
    const server = {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_TOKEN: "token",
      },
    };
    const result = McpServerSchema.safeParse(server);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.command).toBe("npx");
      expect(result.data.args).toContain("-y");
    }
  });

  it("parses URL-based MCP server", () => {
    const server = {
      url: "http://localhost:3000/mcp",
    };
    const result = McpServerSchema.safeParse(server);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe("http://localhost:3000/mcp");
    }
  });

  it("parses empty MCP server config", () => {
    const result = McpServerSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("AgentChatSchema", () => {
  it("parses empty chat config", () => {
    const result = AgentChatSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("parses discord chat config", () => {
    const chat = {
      discord: {
        bot_token_env: "DISCORD_BOT_TOKEN",
        guilds: [
          {
            id: "123",
            channels: [
              { id: "456", mode: "auto" },
              { id: "789", mode: "mention" },
            ],
          },
        ],
      },
    };
    const result = AgentChatSchema.safeParse(chat);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discord?.guilds).toHaveLength(1);
      expect(result.data.discord?.guilds[0].channels).toHaveLength(2);
    }
  });

  it("applies default session_expiry_hours", () => {
    const chat = {
      discord: {
        bot_token_env: "DISCORD_BOT_TOKEN",
        guilds: [{ id: "123" }],
      },
    };
    const result = AgentChatSchema.safeParse(chat);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discord?.session_expiry_hours).toBe(24);
    }
  });
});

describe("parseAgentConfig", () => {
  it("parses valid agent YAML", () => {
    const yaml = `
name: test-agent
description: A test agent
`;
    const config = parseAgentConfig(yaml);
    expect(config.name).toBe("test-agent");
    expect(config.description).toBe("A test agent");
  });

  it("parses complete agent YAML from SPEC example", () => {
    const yaml = `
name: bragdoc-coder
description: A coding assistant for the bragdoc project
working_directory: ~/projects/bragdoc
repo: https://github.com/example/bragdoc

identity:
  name: Cody
  role: developer

work_source:
  type: github
  labels:
    ready: "ready"
    in_progress: "in-progress"

schedules:
  main:
    type: interval
    interval: "5m"
    prompt: Check for new issues

permission_mode: acceptEdits
allowed_tools:
  - Read
  - Edit
  - Write
  - "Bash(git *)"
  - "Bash(npm *)"
  - "Bash(pnpm *)"

mcp_servers:
  github:
    command: npx
    args:
      - "-y"
      - "@modelcontextprotocol/server-github"

model: claude-sonnet-4-20250514
max_turns: 100
`;
    const config = parseAgentConfig(yaml, "/path/to/agent.yaml");
    expect(config.name).toBe("bragdoc-coder");
    expect(config.working_directory).toBe("~/projects/bragdoc");
    expect(config.repo).toBe("https://github.com/example/bragdoc");
    expect(config.identity?.name).toBe("Cody");
    expect(config.work_source?.type).toBe("github");
    expect(config.schedules?.main.type).toBe("interval");
    expect(config.permission_mode).toBe("acceptEdits");
    expect(config.mcp_servers?.github.command).toBe("npx");
    expect(config.model).toBe("claude-sonnet-4-20250514");
    expect(config.max_turns).toBe(100);
  });

  it("throws AgentYamlSyntaxError for invalid YAML", () => {
    const yaml = `
name: test-agent
  bad: indentation
`;
    expect(() => parseAgentConfig(yaml, "/path/to/agent.yaml")).toThrow(AgentYamlSyntaxError);
  });

  it("includes file path in AgentYamlSyntaxError", () => {
    const yaml = `name: test
  bad: indent`;
    try {
      parseAgentConfig(yaml, "/path/to/agent.yaml");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentYamlSyntaxError);
      const yamlError = error as AgentYamlSyntaxError;
      expect(yamlError.filePath).toBe("/path/to/agent.yaml");
      expect(yamlError.message).toContain("/path/to/agent.yaml");
    }
  });

  it("throws AgentValidationError for missing required fields", () => {
    const yaml = `
description: An agent without a name
`;
    expect(() => parseAgentConfig(yaml, "/path/to/agent.yaml")).toThrow(AgentValidationError);
  });

  it("includes file path and field info in AgentValidationError", () => {
    const yaml = `
description: Missing name field
`;
    try {
      parseAgentConfig(yaml, "/path/to/agent.yaml");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentValidationError);
      const validationError = error as AgentValidationError;
      expect(validationError.filePath).toBe("/path/to/agent.yaml");
      expect(validationError.message).toContain("/path/to/agent.yaml");
      expect(validationError.issues).toHaveLength(1);
      expect(validationError.issues[0].path).toBe("name");
    }
  });

  it("throws AgentValidationError for empty file", () => {
    const yaml = "";
    expect(() => parseAgentConfig(yaml, "/path/to/agent.yaml")).toThrow(AgentValidationError);
  });

  it("throws AgentValidationError for invalid permission mode", () => {
    const yaml = `
name: test-agent
permission_mode: invalid
`;
    expect(() => parseAgentConfig(yaml)).toThrow(AgentValidationError);
  });

  it("reports multiple validation errors", () => {
    const yaml = `
max_turns: "not-a-number"
permission_mode: invalid
`;
    try {
      parseAgentConfig(yaml);
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentValidationError);
      const validationError = error as AgentValidationError;
      expect(validationError.issues.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("uses default file path when not provided", () => {
    const yaml = `description: missing name`;
    try {
      parseAgentConfig(yaml);
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentValidationError);
      const validationError = error as AgentValidationError;
      expect(validationError.filePath).toBe("<unknown>");
    }
  });
});

describe("validateAgentConfig", () => {
  it("validates a valid config object", () => {
    const config = {
      name: "test-agent",
      description: "A test agent",
    };
    const validated = validateAgentConfig(config);
    expect(validated.name).toBe("test-agent");
  });

  it("throws AgentValidationError for invalid object", () => {
    const config = {
      description: "Missing name",
    };
    expect(() => validateAgentConfig(config, "/path/to/agent.yaml")).toThrow(AgentValidationError);
  });

  it("includes file path in error", () => {
    try {
      validateAgentConfig({}, "/custom/path.yaml");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentValidationError);
      const validationError = error as AgentValidationError;
      expect(validationError.filePath).toBe("/custom/path.yaml");
    }
  });
});

describe("safeParseAgentConfig", () => {
  it("returns success for valid YAML", () => {
    const yaml = `
name: test-agent
description: Test
`;
    const result = safeParseAgentConfig(yaml);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("test-agent");
    }
  });

  it("returns error for invalid YAML syntax", () => {
    const yaml = `
name: test
  bad: indent
`;
    const result = safeParseAgentConfig(yaml, "/path/to/agent.yaml");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(AgentYamlSyntaxError);
    }
  });

  it("returns error for schema validation failure", () => {
    const yaml = `
description: missing name
`;
    const result = safeParseAgentConfig(yaml, "/path/to/agent.yaml");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(AgentValidationError);
    }
  });
});

describe("resolveAgentPath", () => {
  it("returns absolute paths unchanged", () => {
    const result = resolveAgentPath("/absolute/path/agent.yaml", "/base/dir");
    expect(result).toBe("/absolute/path/agent.yaml");
  });

  it("resolves relative paths from base path", () => {
    const result = resolveAgentPath("./agents/test.yaml", "/base/dir");
    expect(result).toBe("/base/dir/agents/test.yaml");
  });

  it("resolves paths without ./ prefix", () => {
    const result = resolveAgentPath("agents/test.yaml", "/base/dir");
    expect(result).toBe("/base/dir/agents/test.yaml");
  });

  it("handles parent directory references", () => {
    const result = resolveAgentPath("../other/agent.yaml", "/base/dir");
    expect(result).toBe("/base/other/agent.yaml");
  });
});

describe("loadAgentConfig", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `herdctl-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("loads and parses an agent file", async () => {
    const agentPath = join(testDir, "agent.yaml");
    await writeFile(
      agentPath,
      `
name: test-agent
description: A test agent
model: claude-sonnet-4-20250514
`,
    );

    const config = await loadAgentConfig(agentPath);
    expect(config.name).toBe("test-agent");
    expect(config.model).toBe("claude-sonnet-4-20250514");
  });

  it("resolves relative path from fleet config", async () => {
    const agentsDir = join(testDir, "agents");
    await mkdir(agentsDir, { recursive: true });

    const agentPath = join(agentsDir, "test.yaml");
    await writeFile(
      agentPath,
      `
name: relative-agent
`,
    );

    const fleetConfigPath = join(testDir, "herdctl.yaml");
    const config = await loadAgentConfig("./agents/test.yaml", fleetConfigPath);
    expect(config.name).toBe("relative-agent");
  });

  it("throws FileReadError for non-existent file", async () => {
    await expect(loadAgentConfig("/non/existent/agent.yaml")).rejects.toThrow(FileReadError);
  });

  it("includes file path in FileReadError", async () => {
    const nonExistentPath = "/non/existent/agent.yaml";
    try {
      await loadAgentConfig(nonExistentPath);
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(FileReadError);
      const fileError = error as FileReadError;
      expect(fileError.filePath).toBe(nonExistentPath);
      expect(fileError.message).toContain(nonExistentPath);
    }
  });

  it("throws AgentYamlSyntaxError for invalid YAML file", async () => {
    const agentPath = join(testDir, "invalid.yaml");
    await writeFile(
      agentPath,
      `
name: test
  bad: indent
`,
    );

    await expect(loadAgentConfig(agentPath)).rejects.toThrow(AgentYamlSyntaxError);
  });

  it("throws AgentValidationError for invalid config file", async () => {
    const agentPath = join(testDir, "invalid-config.yaml");
    await writeFile(
      agentPath,
      `
description: Missing name field
`,
    );

    await expect(loadAgentConfig(agentPath)).rejects.toThrow(AgentValidationError);
  });

  it("handles complex agent with all fields", async () => {
    const agentPath = join(testDir, "complex.yaml");
    await writeFile(
      agentPath,
      `
name: complex-agent
description: A fully configured agent
working_directory: ~/workspace
repo: https://github.com/example/repo

identity:
  name: Ava
  role: assistant
  personality: helpful

work_source:
  type: github
  labels:
    ready: "ready"

schedules:
  polling:
    type: interval
    interval: "10m"

session:
  max_turns: 50
  timeout: "1h"
  model: claude-opus-4-20250514

permission_mode: bypassPermissions
allowed_tools:
  - Read
  - Write

mcp_servers:
  test:
    command: node
    args:
      - server.js

chat:
  discord:
    bot_token_env: DISCORD_BOT_TOKEN
    guilds:
      - id: "123456789"
        channels:
          - id: "123456"
            name: "#general"

model: claude-sonnet-4-20250514
max_turns: 100
`,
    );

    const config = await loadAgentConfig(agentPath);
    expect(config.name).toBe("complex-agent");
    expect(config.identity?.name).toBe("Ava");
    expect(config.schedules?.polling.type).toBe("interval");
    expect(config.session?.max_turns).toBe(50);
    expect(config.permission_mode).toBe("bypassPermissions");
    expect(config.mcp_servers?.test.command).toBe("node");
    expect(config.chat?.discord?.guilds[0].channels?.[0].id).toBe("123456");
  });
});

describe("Error classes", () => {
  it("AgentValidationError has correct properties", () => {
    const mockZodError = {
      issues: [
        { path: ["name"], message: "Required", code: "invalid_type" },
        { path: ["max_turns"], message: "Expected number", code: "invalid_type" },
      ],
    } as never;

    const error = new AgentValidationError(mockZodError, "/path/to/agent.yaml");
    expect(error.name).toBe("AgentValidationError");
    expect(error.filePath).toBe("/path/to/agent.yaml");
    expect(error.issues).toHaveLength(2);
    expect(error.message).toContain("/path/to/agent.yaml");
    expect(error.message).toContain("name: Required");
    expect(error.message).toContain("max_turns: Expected number");
  });

  it("AgentYamlSyntaxError has correct properties", () => {
    const mockYamlError = {
      message: "Bad indentation",
      linePos: [{ line: 5, col: 3 }],
    } as never;

    const error = new AgentYamlSyntaxError(mockYamlError, "/path/to/agent.yaml");
    expect(error.name).toBe("AgentYamlSyntaxError");
    expect(error.filePath).toBe("/path/to/agent.yaml");
    expect(error.line).toBe(5);
    expect(error.column).toBe(3);
    expect(error.message).toContain("/path/to/agent.yaml");
    expect(error.message).toContain("line 5");
    expect(error.message).toContain("column 3");
  });

  it("AgentYamlSyntaxError handles missing position", () => {
    const mockYamlError = {
      message: "Unknown error",
      linePos: undefined,
    } as never;

    const error = new AgentYamlSyntaxError(mockYamlError, "/path/to/agent.yaml");
    expect(error.line).toBeUndefined();
    expect(error.column).toBeUndefined();
    expect(error.message).toContain("/path/to/agent.yaml");
  });

  it("FileReadError has correct properties", () => {
    const cause = new Error("ENOENT: no such file");
    const error = new FileReadError("/path/to/agent.yaml", cause);
    expect(error.name).toBe("FileReadError");
    expect(error.filePath).toBe("/path/to/agent.yaml");
    expect(error.message).toContain("/path/to/agent.yaml");
    expect(error.message).toContain("ENOENT");
  });

  it("FileReadError works without cause", () => {
    const error = new FileReadError("/path/to/agent.yaml");
    expect(error.name).toBe("FileReadError");
    expect(error.message).toContain("/path/to/agent.yaml");
  });
});

describe("type safety", () => {
  it("returns properly typed AgentConfig", () => {
    const yaml = `
name: test-agent
description: A test
model: claude-sonnet-4-20250514
max_turns: 50
permission_mode: acceptEdits
`;
    const config: AgentConfig = parseAgentConfig(yaml);

    // TypeScript compilation verifies these types
    const _name: string = config.name;
    const _description: string | undefined = config.description;
    const _model: string | undefined = config.model;
    const _maxTurns: number | undefined = config.max_turns;

    expect(_name).toBe("test-agent");
    expect(_description).toBe("A test");
    expect(_model).toBe("claude-sonnet-4-20250514");
    expect(_maxTurns).toBe(50);
  });
});
