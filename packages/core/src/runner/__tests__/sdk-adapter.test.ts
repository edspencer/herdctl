import { describe, expect, it } from "vitest";
import type { McpServer, ResolvedAgent } from "../../config/index.js";
import {
  buildSystemPrompt,
  toSDKOptions,
  transformMcpServer,
  transformMcpServers,
} from "../sdk-adapter.js";

// =============================================================================
// Helper to create a minimal ResolvedAgent
// =============================================================================

function createTestAgent(overrides: Partial<ResolvedAgent> = {}): ResolvedAgent {
  return {
    name: "test-agent",
    configPath: "/path/to/agent.yaml",
    fleetPath: [],
    qualifiedName: overrides.name ?? "test-agent",
    ...overrides,
  };
}

// =============================================================================
// toSDKOptions tests
// =============================================================================

describe("toSDKOptions", () => {
  describe("permission mode mapping", () => {
    it("maps permission_mode to SDK permissionMode", () => {
      const agent = createTestAgent({
        permission_mode: "bypassPermissions",
      });
      const result = toSDKOptions(agent);
      expect(result.permissionMode).toBe("bypassPermissions");
    });

    it("defaults to acceptEdits when mode not specified", () => {
      const agent = createTestAgent();
      const result = toSDKOptions(agent);
      expect(result.permissionMode).toBe("acceptEdits");
    });

    it("supports default mode", () => {
      const agent = createTestAgent({
        permission_mode: "default",
      });
      const result = toSDKOptions(agent);
      expect(result.permissionMode).toBe("default");
    });

    it("supports acceptEdits mode", () => {
      const agent = createTestAgent({
        permission_mode: "acceptEdits",
      });
      const result = toSDKOptions(agent);
      expect(result.permissionMode).toBe("acceptEdits");
    });

    it("supports bypassPermissions mode", () => {
      const agent = createTestAgent({
        permission_mode: "bypassPermissions",
      });
      const result = toSDKOptions(agent);
      expect(result.permissionMode).toBe("bypassPermissions");
    });

    it("supports plan mode", () => {
      const agent = createTestAgent({
        permission_mode: "plan",
      });
      const result = toSDKOptions(agent);
      expect(result.permissionMode).toBe("plan");
    });
  });

  describe("allowed and denied tools", () => {
    it("passes allowed_tools as allowedTools (direct passthrough)", () => {
      const agent = createTestAgent({
        allowed_tools: ["Read", "Write", "Edit"],
      });
      const result = toSDKOptions(agent);
      expect(result.allowedTools).toEqual(["Read", "Write", "Edit"]);
    });

    it("passes denied_tools as deniedTools (direct passthrough)", () => {
      const agent = createTestAgent({
        denied_tools: ["Bash(rm *)", "WebFetch"],
      });
      const result = toSDKOptions(agent);
      expect(result.deniedTools).toEqual(["Bash(rm *)", "WebFetch"]);
    });

    it("does not include allowedTools when empty array", () => {
      const agent = createTestAgent({
        allowed_tools: [],
      });
      const result = toSDKOptions(agent);
      expect(result.allowedTools).toBeUndefined();
    });

    it("does not include deniedTools when empty array", () => {
      const agent = createTestAgent({
        denied_tools: [],
      });
      const result = toSDKOptions(agent);
      expect(result.deniedTools).toBeUndefined();
    });

    it("does not include allowedTools when not specified", () => {
      const agent = createTestAgent();
      const result = toSDKOptions(agent);
      expect(result.allowedTools).toBeUndefined();
    });

    it("supports MCP tool wildcards", () => {
      const agent = createTestAgent({
        allowed_tools: ["Read", "mcp__posthog__*", "mcp__github__*"],
      });
      const result = toSDKOptions(agent);
      expect(result.allowedTools).toContain("mcp__posthog__*");
      expect(result.allowedTools).toContain("mcp__github__*");
    });

    it("supports Bash() patterns (standard Claude Code format)", () => {
      const agent = createTestAgent({
        allowed_tools: ["Read", "Bash(git *)", "Bash(npm *)"],
        denied_tools: ["Bash(sudo *)", "Bash(rm -rf *)"],
      });
      const result = toSDKOptions(agent);
      expect(result.allowedTools).toEqual(["Read", "Bash(git *)", "Bash(npm *)"]);
      expect(result.deniedTools).toEqual(["Bash(sudo *)", "Bash(rm -rf *)"]);
    });
  });

  describe("system prompt", () => {
    it("uses claude_code preset for system prompt by default", () => {
      const agent = createTestAgent();
      const result = toSDKOptions(agent);
      expect(result.systemPrompt).toEqual({
        type: "preset",
        preset: "claude_code",
      });
    });

    it("uses custom system prompt when specified in agent config", () => {
      const agent = createTestAgent({
        system_prompt: "You are a helpful assistant specialized in testing.",
      });
      const result = toSDKOptions(agent);
      // Custom system prompts are passed as plain strings to the SDK
      expect(result.systemPrompt).toBe("You are a helpful assistant specialized in testing.");
    });

    it("handles empty system prompt by using preset", () => {
      const agent = createTestAgent({
        system_prompt: "",
      });
      const result = toSDKOptions(agent);
      // Empty string is falsy, so it should fall back to preset
      expect(result.systemPrompt).toEqual({
        type: "preset",
        preset: "claude_code",
      });
    });
  });

  describe("setting sources", () => {
    it("sets settingSources to empty for standalone agents (no workspace)", () => {
      const agent = createTestAgent();
      const result = toSDKOptions(agent);
      // Empty by default - standalone agents should NOT load CLAUDE.md or local settings
      expect(result.settingSources).toEqual([]);
    });

    it("sets settingSources to project for project-embedded agents (with workspace)", () => {
      const agent = createTestAgent({ working_directory: "/path/to/existing/project" });
      const result = toSDKOptions(agent);
      // Project-embedded agents should load project settings (CLAUDE.md, skills, etc.)
      expect(result.settingSources).toEqual(["project"]);
    });

    it("uses explicit setting_sources when configured", () => {
      const agent = createTestAgent({
        setting_sources: ["project", "local"],
      });
      const result = toSDKOptions(agent);
      expect(result.settingSources).toEqual(["project", "local"]);
    });

    it("explicit setting_sources overrides workspace default", () => {
      const agent = createTestAgent({
        working_directory: "/path/to/project",
        setting_sources: [], // Explicitly disable settings discovery
      });
      const result = toSDKOptions(agent);
      expect(result.settingSources).toEqual([]);
    });

    it("explicit setting_sources can add local to standalone agent", () => {
      const agent = createTestAgent({
        setting_sources: ["local"], // No workspace, but load user's local settings
      });
      const result = toSDKOptions(agent);
      expect(result.settingSources).toEqual(["local"]);
    });
  });

  describe("session resume and fork", () => {
    it("passes resume option when provided", () => {
      const agent = createTestAgent();
      const result = toSDKOptions(agent, { resume: "session-abc123" });
      expect(result.resume).toBe("session-abc123");
    });

    it("sets forkSession true when fork option provided", () => {
      const agent = createTestAgent();
      const result = toSDKOptions(agent, { fork: true });
      expect(result.forkSession).toBe(true);
    });

    it("does not include resume when not provided", () => {
      const agent = createTestAgent();
      const result = toSDKOptions(agent);
      expect(result.resume).toBeUndefined();
    });

    it("does not include forkSession when not forking", () => {
      const agent = createTestAgent();
      const result = toSDKOptions(agent, { fork: false });
      expect(result.forkSession).toBeUndefined();
    });

    it("supports both resume and fork together", () => {
      const agent = createTestAgent();
      const result = toSDKOptions(agent, { resume: "session-abc123", fork: true });
      expect(result.resume).toBe("session-abc123");
      expect(result.forkSession).toBe(true);
    });
  });

  describe("MCP servers", () => {
    it("includes mcpServers when agent has MCP servers configured", () => {
      const agent = createTestAgent({
        mcp_servers: {
          github: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
          },
        },
      });
      const result = toSDKOptions(agent);
      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers?.github).toBeDefined();
    });

    it("includes empty mcpServers object when not configured", () => {
      const agent = createTestAgent();
      const result = toSDKOptions(agent);
      expect(result.mcpServers).toEqual({});
    });

    it("includes empty mcpServers object for empty mcp_servers object", () => {
      const agent = createTestAgent({
        mcp_servers: {},
      });
      const result = toSDKOptions(agent);
      expect(result.mcpServers).toEqual({});
    });
  });

  describe("model", () => {
    it("passes model when specified in agent config", () => {
      const agent = createTestAgent({
        model: "claude-opus-4",
      });
      const result = toSDKOptions(agent);
      expect(result.model).toBe("claude-opus-4");
    });

    it("does not include model when not specified", () => {
      const agent = createTestAgent();
      const result = toSDKOptions(agent);
      expect(result.model).toBeUndefined();
    });

    it("handles various model identifiers", () => {
      const models = ["claude-sonnet-4", "claude-opus-4", "claude-haiku-4"];

      for (const model of models) {
        const agent = createTestAgent({ model });
        const result = toSDKOptions(agent);
        expect(result.model).toBe(model);
      }
    });
  });

  describe("complete configuration", () => {
    it("produces correct SDK options for a fully configured agent", () => {
      const agent = createTestAgent({
        name: "full-agent",
        system_prompt: "You are a specialized test agent.",
        permission_mode: "bypassPermissions",
        allowed_tools: ["Read", "Write", "Bash(git *)"],
        denied_tools: ["WebFetch", "Bash(sudo *)"],
        mcp_servers: {
          posthog: {
            url: "https://mcp.posthog.com",
          },
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
            env: { SAFE_MODE: "true" },
          },
        },
      });

      const result = toSDKOptions(agent, { resume: "session-123" });

      expect(result).toEqual({
        permissionMode: "bypassPermissions",
        allowedTools: ["Read", "Write", "Bash(git *)"],
        deniedTools: ["WebFetch", "Bash(sudo *)"],
        systemPrompt: "You are a specialized test agent.", // Custom prompts are plain strings
        settingSources: [], // Empty - autonomous agents don't load project settings
        mcpServers: {
          posthog: {
            type: "http",
            url: "https://mcp.posthog.com",
          },
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
            env: { SAFE_MODE: "true" },
          },
        },
        resume: "session-123",
      });
    });
  });
});

// =============================================================================
// transformMcpServer tests
// =============================================================================

describe("transformMcpServer", () => {
  it("transforms HTTP MCP server config", () => {
    const server: McpServer = {
      url: "https://mcp.example.com",
    };
    const result = transformMcpServer(server);
    expect(result).toEqual({
      type: "http",
      url: "https://mcp.example.com",
    });
  });

  it("transforms process MCP server config", () => {
    const server: McpServer = {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
    };
    const result = transformMcpServer(server);
    expect(result).toEqual({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
    });
  });

  it("transforms MCP server with env vars", () => {
    const server: McpServer = {
      command: "node",
      args: ["server.js"],
      env: {
        API_KEY: "secret123",
        DEBUG: "true",
      },
    };
    const result = transformMcpServer(server);
    expect(result).toEqual({
      command: "node",
      args: ["server.js"],
      env: {
        API_KEY: "secret123",
        DEBUG: "true",
      },
    });
  });

  it("handles mixed HTTP and process config (HTTP takes precedence)", () => {
    const server: McpServer = {
      url: "https://mcp.example.com",
      command: "npx",
      args: ["something"],
    };
    const result = transformMcpServer(server);
    // Both URL and command are included
    expect(result.type).toBe("http");
    expect(result.url).toBe("https://mcp.example.com");
    expect(result.command).toBe("npx");
  });

  it("does not include empty env object", () => {
    const server: McpServer = {
      command: "node",
      env: {},
    };
    const result = transformMcpServer(server);
    expect(result.env).toBeUndefined();
  });

  it("does not include empty args array", () => {
    const server: McpServer = {
      command: "node",
      args: [],
    };
    const result = transformMcpServer(server);
    expect(result.args).toBeUndefined();
  });

  it("handles server with only command", () => {
    const server: McpServer = {
      command: "my-mcp-server",
    };
    const result = transformMcpServer(server);
    expect(result).toEqual({
      command: "my-mcp-server",
    });
  });
});

// =============================================================================
// transformMcpServers tests
// =============================================================================

describe("transformMcpServers", () => {
  it("transforms multiple MCP server configs", () => {
    const servers: Record<string, McpServer> = {
      github: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "token123" },
      },
      posthog: {
        url: "https://mcp.posthog.com",
      },
    };
    const result = transformMcpServers(servers);

    expect(result).toBeDefined();
    expect(result?.github).toEqual({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "token123" },
    });
    expect(result?.posthog).toEqual({
      type: "http",
      url: "https://mcp.posthog.com",
    });
  });

  it("returns empty object for empty config", () => {
    const result = transformMcpServers({});
    expect(result).toEqual({});
  });

  it("returns empty object for undefined config", () => {
    const result = transformMcpServers(undefined);
    expect(result).toEqual({});
  });

  it("handles single server", () => {
    const servers: Record<string, McpServer> = {
      solo: { command: "mcp-server" },
    };
    const result = transformMcpServers(servers);
    expect(result).toEqual({
      solo: { command: "mcp-server" },
    });
  });

  it("handles mixed HTTP and process servers", () => {
    const servers: Record<string, McpServer> = {
      http1: { url: "https://a.com" },
      process1: { command: "cmd1" },
      http2: { url: "https://b.com" },
      process2: { command: "cmd2", args: ["-v"] },
    };
    const result = transformMcpServers(servers);

    expect(result?.http1?.type).toBe("http");
    expect(result?.http1?.url).toBe("https://a.com");
    expect(result?.process1?.command).toBe("cmd1");
    expect(result?.http2?.type).toBe("http");
    expect(result?.process2?.command).toBe("cmd2");
  });
});

// =============================================================================
// buildSystemPrompt tests
// =============================================================================

// =============================================================================
// MCP Server Environment Variable Interpolation tests
// =============================================================================

describe("MCP server environment variable interpolation", () => {
  it("accepts pre-interpolated env vars in MCP server config", () => {
    // This test verifies that interpolation happens BEFORE toSDKOptions is called
    // (in loader.ts via interpolateConfig), so the SDK adapter receives
    // already-resolved values
    const agent = createTestAgent({
      mcp_servers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: {
            GITHUB_TOKEN: "ghp_already_interpolated_token",
          },
        },
      },
    });
    const result = toSDKOptions(agent);
    expect(result.mcpServers?.github.env?.GITHUB_TOKEN).toBe("ghp_already_interpolated_token");
  });

  it("passes URL with pre-interpolated env vars for HTTP MCP server", () => {
    // Environment variables in URLs should be interpolated before SDK transformation
    const agent = createTestAgent({
      mcp_servers: {
        analytics: {
          url: "https://mcp.example.com/api?key=resolved_api_key",
        },
      },
    });
    const result = toSDKOptions(agent);
    expect(result.mcpServers?.analytics.url).toBe(
      "https://mcp.example.com/api?key=resolved_api_key",
    );
  });

  it("passes multiple env vars in process-based MCP server", () => {
    const agent = createTestAgent({
      mcp_servers: {
        custom: {
          command: "my-mcp-server",
          args: ["--verbose"],
          env: {
            API_KEY: "key123",
            API_SECRET: "secret456",
            DEBUG: "true",
          },
        },
      },
    });
    const result = toSDKOptions(agent);
    expect(result.mcpServers?.custom.env).toEqual({
      API_KEY: "key123",
      API_SECRET: "secret456",
      DEBUG: "true",
    });
  });

  it("handles mixed MCP servers with different interpolated values", () => {
    const agent = createTestAgent({
      mcp_servers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_TOKEN: "ghp_token123" },
        },
        posthog: {
          url: "https://mcp.posthog.com",
        },
        filesystem: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
          env: { ALLOWED_PATHS: "/workspace,/home/user" },
        },
      },
    });
    const result = toSDKOptions(agent);

    expect(result.mcpServers?.github.env?.GITHUB_TOKEN).toBe("ghp_token123");
    expect(result.mcpServers?.posthog.type).toBe("http");
    expect(result.mcpServers?.posthog.url).toBe("https://mcp.posthog.com");
    expect(result.mcpServers?.filesystem.env?.ALLOWED_PATHS).toBe("/workspace,/home/user");
  });
});

// =============================================================================
// buildSystemPrompt tests
// =============================================================================

describe("buildSystemPrompt", () => {
  it("returns preset when no system_prompt specified", () => {
    const agent = createTestAgent();
    const result = buildSystemPrompt(agent);
    expect(result).toEqual({
      type: "preset",
      preset: "claude_code",
    });
  });

  it("returns plain string when system_prompt is specified", () => {
    const agent = createTestAgent({
      system_prompt: "Custom instructions for the agent.",
    });
    const result = buildSystemPrompt(agent);
    // SDK expects custom prompts as plain strings
    expect(result).toBe("Custom instructions for the agent.");
  });

  it("returns preset for empty string system_prompt", () => {
    const agent = createTestAgent({
      system_prompt: "",
    });
    const result = buildSystemPrompt(agent);
    expect(result).toEqual({
      type: "preset",
      preset: "claude_code",
    });
  });

  it("preserves multiline system prompts", () => {
    const multilinePrompt = `You are a helpful assistant.
You specialize in code review.
Always be thorough and constructive.`;
    const agent = createTestAgent({
      system_prompt: multilinePrompt,
    });
    const result = buildSystemPrompt(agent);
    // SDK expects custom prompts as plain strings
    expect(result).toBe(multilinePrompt);
  });

  it("handles system prompt with special characters", () => {
    const agent = createTestAgent({
      system_prompt: "Handle ${VARIABLES} and 'quotes' correctly",
    });
    const result = buildSystemPrompt(agent);
    // SDK expects custom prompts as plain strings
    expect(result).toBe("Handle ${VARIABLES} and 'quotes' correctly");
  });
});
