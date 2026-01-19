import { describe, it, expect } from "vitest";
import {
  deepMerge,
  mergeAgentConfig,
  mergeAllAgentConfigs,
} from "../merge.js";
import type { AgentConfig } from "../schema.js";
import type { ExtendedDefaults, PermissionsInput } from "../merge.js";

describe("deepMerge", () => {
  describe("basic behavior", () => {
    it("returns undefined when both inputs are undefined", () => {
      const result = deepMerge(undefined, undefined);
      expect(result).toBeUndefined();
    });

    it("returns base when override is undefined", () => {
      const base = { a: 1, b: 2 };
      const result = deepMerge(base, undefined);
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it("returns override when base is undefined", () => {
      const override = { a: 1, b: 2 };
      const result = deepMerge(undefined, override);
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it("merges two simple objects", () => {
      const base = { a: 1, b: 2 } as Record<string, unknown>;
      const override = { b: 3, c: 4 } as Record<string, unknown>;
      const result = deepMerge(base, override);
      expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    it("creates a new object (does not mutate inputs)", () => {
      const base = { a: 1 } as Record<string, unknown>;
      const override = { b: 2 } as Record<string, unknown>;
      const result = deepMerge(base, override);
      expect(result).not.toBe(base);
      expect(result).not.toBe(override);
      expect(base).toEqual({ a: 1 });
      expect(override).toEqual({ b: 2 });
    });
  });

  describe("array handling", () => {
    it("replaces arrays entirely (does not merge)", () => {
      const base = { tools: ["Read", "Write", "Edit"] };
      const override = { tools: ["Bash"] };
      const result = deepMerge(base, override);
      expect(result).toEqual({ tools: ["Bash"] });
    });

    it("replaces nested arrays", () => {
      const base = {
        permissions: {
          allowed_tools: ["Read", "Write"],
        },
      };
      const override = {
        permissions: {
          allowed_tools: ["Bash", "Grep"],
        },
      };
      const result = deepMerge(base, override);
      expect(result?.permissions?.allowed_tools).toEqual(["Bash", "Grep"]);
    });

    it("replaces base array with empty override array", () => {
      const base = { items: [1, 2, 3] };
      const override = { items: [] as number[] };
      const result = deepMerge(base, override);
      expect(result).toEqual({ items: [] });
    });

    it("keeps base array when override does not have the key", () => {
      const base = { items: [1, 2, 3], other: "value" };
      const override = { other: "new" };
      const result = deepMerge(base, override);
      expect(result).toEqual({ items: [1, 2, 3], other: "new" });
    });
  });

  describe("nested object merging", () => {
    it("deeply merges nested objects", () => {
      const base = {
        outer: {
          inner: {
            a: 1,
            b: 2,
          },
        },
      } as Record<string, unknown>;
      const override = {
        outer: {
          inner: {
            b: 3,
            c: 4,
          },
        },
      } as Record<string, unknown>;
      const result = deepMerge(base, override);
      expect(result).toEqual({
        outer: {
          inner: {
            a: 1,
            b: 3,
            c: 4,
          },
        },
      });
    });

    it("merges multiple levels of nesting", () => {
      const base = {
        level1: {
          level2: {
            level3: {
              value: "base",
              kept: true,
            },
          },
        },
      } as Record<string, unknown>;
      const override = {
        level1: {
          level2: {
            level3: {
              value: "override",
            },
          },
        },
      } as Record<string, unknown>;
      const result = deepMerge(base, override);
      expect((result as Record<string, unknown>)?.level1).toBeDefined();
      const level3 = (
        (
          (result as Record<string, unknown>)?.level1 as Record<string, unknown>
        )?.level2 as Record<string, unknown>
      )?.level3;
      expect(level3).toEqual({
        value: "override",
        kept: true,
      });
    });

    it("adds new nested keys from override", () => {
      const base = { existing: { a: 1 } } as Record<string, unknown>;
      const override = { newKey: { b: 2 } } as Record<string, unknown>;
      const result = deepMerge(base, override);
      expect(result).toEqual({
        existing: { a: 1 },
        newKey: { b: 2 },
      });
    });
  });

  describe("scalar value handling", () => {
    it("override replaces base string", () => {
      const base = { name: "base" };
      const override = { name: "override" };
      const result = deepMerge(base, override);
      expect(result?.name).toBe("override");
    });

    it("override replaces base number", () => {
      const base = { count: 10 };
      const override = { count: 20 };
      const result = deepMerge(base, override);
      expect(result?.count).toBe(20);
    });

    it("override replaces base boolean", () => {
      const base = { enabled: true };
      const override = { enabled: false };
      const result = deepMerge(base, override);
      expect(result?.enabled).toBe(false);
    });

    it("override null replaces base value", () => {
      const base = { value: "something" };
      const override = { value: null as unknown as string };
      const result = deepMerge(base, override);
      expect(result?.value).toBeNull();
    });

    it("skips undefined values in override", () => {
      const base = { a: 1, b: 2 };
      const override = { a: undefined as unknown as number, b: 3 };
      const result = deepMerge(base, override);
      expect(result).toEqual({ a: 1, b: 3 });
    });
  });

  describe("mixed type handling", () => {
    it("override object replaces base scalar", () => {
      const base = { config: "simple" as unknown };
      const override = { config: { complex: true } };
      const result = deepMerge(base, override);
      expect(result?.config).toEqual({ complex: true });
    });

    it("override scalar replaces base object", () => {
      const base = { config: { complex: true } as unknown };
      const override = { config: "simple" };
      const result = deepMerge(base, override);
      expect(result?.config).toBe("simple");
    });

    it("override array replaces base object", () => {
      const base = { data: { key: "value" } as unknown };
      const override = { data: [1, 2, 3] };
      const result = deepMerge(base, override);
      expect(result?.data).toEqual([1, 2, 3]);
    });
  });
});

describe("mergeAgentConfig", () => {
  describe("no defaults", () => {
    it("returns agent config unchanged when defaults is undefined", () => {
      const agent: AgentConfig = {
        name: "test-agent",
        model: "claude-sonnet-4-20250514",
      };
      const result = mergeAgentConfig(undefined, agent);
      expect(result).toEqual(agent);
    });
  });

  describe("permissions merging", () => {
    it("uses defaults permissions when agent has none", () => {
      const defaults: ExtendedDefaults = {
        permissions: {
          mode: "acceptEdits",
          allowed_tools: ["Read", "Write"],
        },
      };
      const agent: AgentConfig = { name: "test-agent" };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.permissions?.mode).toBe("acceptEdits");
      expect(result.permissions?.allowed_tools).toEqual(["Read", "Write"]);
    });

    it("agent permissions override defaults", () => {
      const defaults: ExtendedDefaults = {
        permissions: {
          mode: "acceptEdits",
          allowed_tools: ["Read", "Write"],
        },
      };
      const agent: AgentConfig = {
        name: "test-agent",
        permissions: {
          mode: "bypassPermissions",
        },
      };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.permissions?.mode).toBe("bypassPermissions");
      // allowed_tools should still come from defaults since agent didn't specify
      expect(result.permissions?.allowed_tools).toEqual(["Read", "Write"]);
    });

    it("agent allowed_tools replaces default allowed_tools", () => {
      const defaults: ExtendedDefaults = {
        permissions: {
          mode: "acceptEdits",
          allowed_tools: ["Read", "Write", "Edit", "Glob", "Grep"],
        },
      };
      const agent: AgentConfig = {
        name: "test-agent",
        permissions: {
          mode: "acceptEdits",
          allowed_tools: ["Bash"],
        },
      };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.permissions?.allowed_tools).toEqual(["Bash"]);
    });

    it("merges bash permissions deeply", () => {
      const defaults: ExtendedDefaults = {
        permissions: {
          mode: "acceptEdits",
          bash: {
            allowed_commands: ["git", "npm"],
            denied_patterns: ["rm -rf /"],
          },
        },
      };
      const agent: AgentConfig = {
        name: "test-agent",
        permissions: {
          mode: "acceptEdits",
          bash: {
            allowed_commands: ["pnpm"],
          },
        },
      };
      const result = mergeAgentConfig(defaults, agent);
      // allowed_commands should be replaced
      expect(result.permissions?.bash?.allowed_commands).toEqual(["pnpm"]);
      // denied_patterns should be kept from defaults
      expect(result.permissions?.bash?.denied_patterns).toEqual(["rm -rf /"]);
    });
  });

  describe("work_source merging", () => {
    it("uses defaults work_source when agent has none", () => {
      const defaults: ExtendedDefaults = {
        work_source: {
          type: "github",
          labels: { ready: "ready", in_progress: "in-progress" },
        },
      };
      const agent: AgentConfig = { name: "test-agent" };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.work_source?.type).toBe("github");
      expect(result.work_source?.labels?.ready).toBe("ready");
    });

    it("agent work_source labels override defaults", () => {
      const defaults: ExtendedDefaults = {
        work_source: {
          type: "github",
          labels: { ready: "ready", in_progress: "in-progress" },
        },
      };
      const agent: AgentConfig = {
        name: "test-agent",
        work_source: {
          type: "github",
          labels: { ready: "custom-ready" },
        },
      };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.work_source?.labels?.ready).toBe("custom-ready");
      expect(result.work_source?.labels?.in_progress).toBe("in-progress");
    });
  });

  describe("session merging", () => {
    it("uses defaults session when agent has none", () => {
      const defaults: ExtendedDefaults = {
        session: {
          max_turns: 50,
          timeout: "30m",
          model: "claude-sonnet-4-20250514",
        },
      };
      const agent: AgentConfig = { name: "test-agent" };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.session?.max_turns).toBe(50);
      expect(result.session?.timeout).toBe("30m");
      expect(result.session?.model).toBe("claude-sonnet-4-20250514");
    });

    it("agent session values override defaults", () => {
      const defaults: ExtendedDefaults = {
        session: {
          max_turns: 50,
          timeout: "30m",
        },
      };
      const agent: AgentConfig = {
        name: "test-agent",
        session: {
          max_turns: 100,
        },
      };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.session?.max_turns).toBe(100);
      expect(result.session?.timeout).toBe("30m");
    });
  });

  describe("docker merging", () => {
    it("uses defaults docker when agent has none", () => {
      const defaults: ExtendedDefaults = {
        docker: {
          enabled: true,
          base_image: "herdctl-base:latest",
        },
      };
      const agent: AgentConfig = { name: "test-agent" };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.docker?.enabled).toBe(true);
      expect(result.docker?.base_image).toBe("herdctl-base:latest");
    });

    it("agent docker values override defaults", () => {
      const defaults: ExtendedDefaults = {
        docker: {
          enabled: true,
          base_image: "herdctl-base:latest",
        },
      };
      const agent: AgentConfig = {
        name: "test-agent",
        docker: {
          enabled: false,
        },
      };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.docker?.enabled).toBe(false);
      expect(result.docker?.base_image).toBe("herdctl-base:latest");
    });
  });

  describe("scalar value merging", () => {
    it("uses defaults model when agent has none", () => {
      const defaults: ExtendedDefaults = {
        model: "claude-sonnet-4-20250514",
      };
      const agent: AgentConfig = { name: "test-agent" };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.model).toBe("claude-sonnet-4-20250514");
    });

    it("agent model overrides defaults", () => {
      const defaults: ExtendedDefaults = {
        model: "claude-sonnet-4-20250514",
      };
      const agent: AgentConfig = {
        name: "test-agent",
        model: "claude-opus-4-20250514",
      };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.model).toBe("claude-opus-4-20250514");
    });

    it("uses defaults max_turns when agent has none", () => {
      const defaults: ExtendedDefaults = {
        max_turns: 50,
      };
      const agent: AgentConfig = { name: "test-agent" };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.max_turns).toBe(50);
    });

    it("agent max_turns overrides defaults", () => {
      const defaults: ExtendedDefaults = {
        max_turns: 50,
      };
      const agent: AgentConfig = {
        name: "test-agent",
        max_turns: 100,
      };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.max_turns).toBe(100);
    });

    it("uses defaults permission_mode when agent has none", () => {
      const defaults: ExtendedDefaults = {
        permission_mode: "acceptEdits",
      };
      const agent: AgentConfig = { name: "test-agent" };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.permission_mode).toBe("acceptEdits");
    });

    it("agent permission_mode overrides defaults", () => {
      const defaults: ExtendedDefaults = {
        permission_mode: "acceptEdits",
      };
      const agent: AgentConfig = {
        name: "test-agent",
        permission_mode: "bypassPermissions",
      };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.permission_mode).toBe("bypassPermissions");
    });
  });

  describe("preserves non-mergeable fields", () => {
    it("preserves agent name", () => {
      const defaults: ExtendedDefaults = { model: "default-model" };
      const agent: AgentConfig = { name: "my-agent" };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.name).toBe("my-agent");
    });

    it("preserves agent description", () => {
      const defaults: ExtendedDefaults = { model: "default-model" };
      const agent: AgentConfig = {
        name: "my-agent",
        description: "A test agent",
      };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.description).toBe("A test agent");
    });

    it("preserves agent workspace", () => {
      const defaults: ExtendedDefaults = { model: "default-model" };
      const agent: AgentConfig = {
        name: "my-agent",
        workspace: "/path/to/workspace",
      };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.workspace).toBe("/path/to/workspace");
    });

    it("preserves agent identity", () => {
      const defaults: ExtendedDefaults = { model: "default-model" };
      const agent: AgentConfig = {
        name: "my-agent",
        identity: { name: "Claude", role: "assistant" },
      };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.identity?.name).toBe("Claude");
      expect(result.identity?.role).toBe("assistant");
    });

    it("preserves agent schedules", () => {
      const defaults: ExtendedDefaults = { model: "default-model" };
      const agent: AgentConfig = {
        name: "my-agent",
        schedules: {
          main: { type: "interval", interval: "5m" },
        },
      };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.schedules?.main.type).toBe("interval");
      expect(result.schedules?.main.interval).toBe("5m");
    });

    it("preserves agent mcp_servers", () => {
      const defaults: ExtendedDefaults = { model: "default-model" };
      const agent: AgentConfig = {
        name: "my-agent",
        mcp_servers: {
          github: { command: "npx", args: ["-y", "@mcp/github"] },
        },
      };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.mcp_servers?.github.command).toBe("npx");
    });

    it("preserves agent chat", () => {
      const defaults: ExtendedDefaults = { model: "default-model" };
      const agent: AgentConfig = {
        name: "my-agent",
        chat: { discord: { channel_ids: ["123"], respond_to_mentions: true } },
      };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.chat?.discord?.channel_ids).toContain("123");
    });

    it("preserves agent system_prompt", () => {
      const defaults: ExtendedDefaults = { model: "default-model" };
      const agent: AgentConfig = {
        name: "my-agent",
        system_prompt: "You are helpful.",
      };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.system_prompt).toBe("You are helpful.");
    });

    it("preserves agent repo", () => {
      const defaults: ExtendedDefaults = { model: "default-model" };
      const agent: AgentConfig = {
        name: "my-agent",
        repo: "https://github.com/example/repo",
      };
      const result = mergeAgentConfig(defaults, agent);
      expect(result.repo).toBe("https://github.com/example/repo");
    });
  });

  describe("comprehensive merging scenario", () => {
    it("merges a complete fleet defaults into agent config", () => {
      const defaults: ExtendedDefaults = {
        docker: {
          enabled: false,
        },
        permissions: {
          mode: "acceptEdits",
          allowed_tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
          bash: {
            allowed_commands: ["git", "npm", "pnpm"],
            denied_patterns: ["rm -rf /", "sudo *"],
          },
        },
        work_source: {
          type: "github",
          labels: {
            ready: "ready",
            in_progress: "in-progress",
          },
          cleanup_in_progress: true,
        },
        session: {
          max_turns: 50,
          timeout: "30m",
        },
        model: "claude-sonnet-4-20250514",
        max_turns: 100,
        permission_mode: "acceptEdits",
      };

      const agent: AgentConfig = {
        name: "specialized-agent",
        description: "An agent with specific overrides",
        permissions: {
          mode: "acceptEdits",
          allowed_tools: ["Bash", "Read"],
        },
        work_source: {
          type: "github",
          labels: {
            ready: "urgent",
          },
        },
        model: "claude-opus-4-20250514",
      };

      const result = mergeAgentConfig(defaults, agent);

      // Check agent-specific values preserved
      expect(result.name).toBe("specialized-agent");
      expect(result.description).toBe("An agent with specific overrides");
      expect(result.model).toBe("claude-opus-4-20250514");

      // Check permissions merged correctly
      expect(result.permissions?.mode).toBe("acceptEdits"); // from defaults
      expect(result.permissions?.allowed_tools).toEqual(["Bash", "Read"]); // replaced by agent
      expect(result.permissions?.bash?.allowed_commands).toEqual([
        "git",
        "npm",
        "pnpm",
      ]); // from defaults

      // Check work_source merged correctly
      expect(result.work_source?.type).toBe("github");
      expect(result.work_source?.labels?.ready).toBe("urgent"); // overridden by agent
      expect(result.work_source?.labels?.in_progress).toBe("in-progress"); // from defaults
      expect(result.work_source?.cleanup_in_progress).toBe(true); // from defaults

      // Check session from defaults
      expect(result.session?.max_turns).toBe(50);
      expect(result.session?.timeout).toBe("30m");

      // Check scalar values
      expect(result.max_turns).toBe(100); // from defaults (agent didn't override)
      expect(result.permission_mode).toBe("acceptEdits"); // from defaults
    });
  });
});

describe("mergeAllAgentConfigs", () => {
  it("returns empty array for empty agents array", () => {
    const defaults: ExtendedDefaults = { model: "default-model" };
    const result = mergeAllAgentConfigs(defaults, []);
    expect(result).toEqual([]);
  });

  it("merges defaults into all agents", () => {
    const defaults: ExtendedDefaults = {
      model: "claude-sonnet-4-20250514",
      max_turns: 50,
    };
    const agents: AgentConfig[] = [
      { name: "agent-1" },
      { name: "agent-2", model: "claude-opus-4-20250514" },
      { name: "agent-3", max_turns: 100 },
    ];

    const result = mergeAllAgentConfigs(defaults, agents);

    expect(result).toHaveLength(3);

    // agent-1: inherits both defaults
    expect(result[0].name).toBe("agent-1");
    expect(result[0].model).toBe("claude-sonnet-4-20250514");
    expect(result[0].max_turns).toBe(50);

    // agent-2: overrides model, inherits max_turns
    expect(result[1].name).toBe("agent-2");
    expect(result[1].model).toBe("claude-opus-4-20250514");
    expect(result[1].max_turns).toBe(50);

    // agent-3: inherits model, overrides max_turns
    expect(result[2].name).toBe("agent-3");
    expect(result[2].model).toBe("claude-sonnet-4-20250514");
    expect(result[2].max_turns).toBe(100);
  });

  it("returns agents unchanged when defaults is undefined", () => {
    const agents: AgentConfig[] = [
      { name: "agent-1", model: "model-1" },
      { name: "agent-2", model: "model-2" },
    ];

    const result = mergeAllAgentConfigs(undefined, agents);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "agent-1", model: "model-1" });
    expect(result[1]).toEqual({ name: "agent-2", model: "model-2" });
  });

  it("does not mutate original agents array", () => {
    const defaults: ExtendedDefaults = { model: "default-model" };
    const agents: AgentConfig[] = [{ name: "agent-1" }];

    const result = mergeAllAgentConfigs(defaults, agents);

    expect(result).not.toBe(agents);
    expect(agents[0]).toEqual({ name: "agent-1" });
    expect(result[0].model).toBe("default-model");
  });
});
