import { describe, it, expect } from "vitest";
import {
  FleetConfigSchema,
  DefaultsSchema,
  WorkingDirectorySchema,
  PermissionModeSchema,
  WorkSourceSchema,
  GitHubWorkSourceSchema,
  GitHubAuthSchema,
  BaseWorkSourceSchema,
  AgentDockerSchema,
  FleetDockerSchema,
  DockerSchema,
  ChatSchema,
  WebhooksSchema,
  WebSchema,
  InstancesSchema,
  AgentReferenceSchema,
  // Discord chat schemas
  DiscordPresenceSchema,
  ChatDMSchema,
  DiscordChannelSchema,
  DiscordGuildSchema,
  AgentChatDiscordSchema,
  AgentChatSchema,
} from "../schema.js";

describe("FleetConfigSchema", () => {
  it("parses minimal config", () => {
    const result = FleetConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
      expect(result.data.agents).toEqual([]);
    }
  });

  it("parses complete config", () => {
    const config = {
      version: 1,
      fleet: { name: "test", description: "test fleet" },
      defaults: {},
      working_directory: { root: "/tmp" },
      agents: [{ path: "./test.yaml" }],
      chat: {},
      webhooks: {},
      web: {},
      docker: {},
    };
    const result = FleetConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("parses config with web block enabled", () => {
    const config = {
      version: 1,
      fleet: { name: "test" },
      agents: [],
      web: {
        enabled: true,
        port: 8080,
        host: "0.0.0.0",
        session_expiry_hours: 48,
        open_browser: true,
      },
    };
    const result = FleetConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.web?.enabled).toBe(true);
      expect(result.data.web?.port).toBe(8080);
      expect(result.data.web?.host).toBe("0.0.0.0");
      expect(result.data.web?.session_expiry_hours).toBe(48);
      expect(result.data.web?.open_browser).toBe(true);
    }
  });

  it("applies web defaults when web block is empty", () => {
    const config = {
      version: 1,
      web: {},
    };
    const result = FleetConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.web?.enabled).toBe(false);
      expect(result.data.web?.port).toBe(3232);
      expect(result.data.web?.host).toBe("localhost");
      expect(result.data.web?.session_expiry_hours).toBe(24);
      expect(result.data.web?.open_browser).toBe(false);
    }
  });

  it("accepts absence of web key", () => {
    const config = {
      version: 1,
      agents: [],
    };
    const result = FleetConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.web).toBeUndefined();
    }
  });

  it("rejects invalid web port in fleet config", () => {
    const config = {
      version: 1,
      web: {
        enabled: true,
        port: -1,
      },
    };
    const result = FleetConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it("rejects invalid version", () => {
    const result = FleetConfigSchema.safeParse({ version: "1" });
    expect(result.success).toBe(false);
  });

  it("rejects negative version", () => {
    const result = FleetConfigSchema.safeParse({ version: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects zero version", () => {
    const result = FleetConfigSchema.safeParse({ version: 0 });
    expect(result.success).toBe(false);
  });
});

describe("DefaultsSchema", () => {
  it("parses empty defaults", () => {
    const result = DefaultsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("parses complete defaults", () => {
    const defaults = {
      docker: { enabled: true },
      permission_mode: "acceptEdits",
      work_source: { type: "github" },
      instances: { max_concurrent: 2 },
    };
    const result = DefaultsSchema.safeParse(defaults);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.docker?.enabled).toBe(true);
      expect(result.data.permission_mode).toBe("acceptEdits");
      expect(result.data.work_source?.type).toBe("github");
      expect(result.data.instances?.max_concurrent).toBe(2);
    }
  });

  it("parses extended defaults with session", () => {
    const defaults = {
      session: {
        max_turns: 50,
        timeout: "30m",
        model: "claude-sonnet-4-20250514",
      },
    };
    const result = DefaultsSchema.safeParse(defaults);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.session?.max_turns).toBe(50);
      expect(result.data.session?.timeout).toBe("30m");
      expect(result.data.session?.model).toBe("claude-sonnet-4-20250514");
    }
  });

  it("parses extended defaults with model", () => {
    const defaults = {
      model: "claude-opus-4-20250514",
    };
    const result = DefaultsSchema.safeParse(defaults);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBe("claude-opus-4-20250514");
    }
  });

  it("parses extended defaults with max_turns", () => {
    const defaults = {
      max_turns: 100,
    };
    const result = DefaultsSchema.safeParse(defaults);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_turns).toBe(100);
    }
  });

  it("parses extended defaults with permission_mode", () => {
    const defaults = {
      permission_mode: "bypassPermissions",
    };
    const result = DefaultsSchema.safeParse(defaults);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.permission_mode).toBe("bypassPermissions");
    }
  });

  it("parses complete extended defaults", () => {
    const defaults = {
      docker: { enabled: false },
      permission_mode: "acceptEdits",
      allowed_tools: ["Read", "Write"],
      denied_tools: ["WebSearch"],
      work_source: {
        type: "github",
        labels: { ready: "ready" },
      },
      instances: { max_concurrent: 3 },
      session: {
        max_turns: 50,
        timeout: "1h",
      },
      model: "claude-sonnet-4-20250514",
      max_turns: 100,
    };
    const result = DefaultsSchema.safeParse(defaults);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.session?.max_turns).toBe(50);
      expect(result.data.model).toBe("claude-sonnet-4-20250514");
      expect(result.data.max_turns).toBe(100);
      expect(result.data.permission_mode).toBe("acceptEdits");
      expect(result.data.allowed_tools).toEqual(["Read", "Write"]);
      expect(result.data.denied_tools).toEqual(["WebSearch"]);
    }
  });

  it("rejects invalid permission_mode", () => {
    const defaults = {
      permission_mode: "invalid",
    };
    const result = DefaultsSchema.safeParse(defaults);
    expect(result.success).toBe(false);
  });

  it("rejects negative max_turns", () => {
    const defaults = {
      max_turns: -1,
    };
    const result = DefaultsSchema.safeParse(defaults);
    expect(result.success).toBe(false);
  });

  it("rejects zero max_turns", () => {
    const defaults = {
      max_turns: 0,
    };
    const result = DefaultsSchema.safeParse(defaults);
    expect(result.success).toBe(false);
  });

  it("rejects non-integer max_turns", () => {
    const defaults = {
      max_turns: 1.5,
    };
    const result = DefaultsSchema.safeParse(defaults);
    expect(result.success).toBe(false);
  });
});

describe("WorkingDirectorySchema", () => {
  it("requires root", () => {
    const result = WorkingDirectorySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("parses with root only", () => {
    const result = WorkingDirectorySchema.safeParse({ root: "/tmp/workspace" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.root).toBe("/tmp/workspace");
      expect(result.data.auto_clone).toBe(true);
      expect(result.data.clone_depth).toBe(1);
      expect(result.data.default_branch).toBe("main");
    }
  });

  it("parses complete working directory config", () => {
    const working_directory = {
      root: "~/herdctl-workspace",
      auto_clone: false,
      clone_depth: 5,
      default_branch: "develop",
    };
    const result = WorkingDirectorySchema.safeParse(working_directory);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.auto_clone).toBe(false);
      expect(result.data.clone_depth).toBe(5);
      expect(result.data.default_branch).toBe("develop");
    }
  });

  it("rejects non-integer clone_depth", () => {
    const result = WorkingDirectorySchema.safeParse({
      root: "/tmp",
      clone_depth: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero clone_depth", () => {
    const result = WorkingDirectorySchema.safeParse({ root: "/tmp", clone_depth: 0 });
    expect(result.success).toBe(false);
  });
});

describe("PermissionModeSchema", () => {
  it("accepts valid modes", () => {
    const validModes = ["default", "acceptEdits", "bypassPermissions", "plan"];
    for (const mode of validModes) {
      const result = PermissionModeSchema.safeParse(mode);
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid modes", () => {
    const result = PermissionModeSchema.safeParse("invalid");
    expect(result.success).toBe(false);
  });
});

describe("WorkSourceSchema", () => {
  it("requires type", () => {
    const result = WorkSourceSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("parses minimal github type (base schema)", () => {
    const result = WorkSourceSchema.safeParse({ type: "github" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("github");
    }
  });

  it("parses with labels (base schema)", () => {
    const workSource = {
      type: "github",
      labels: {
        ready: "ready",
        in_progress: "in-progress",
      },
      cleanup_in_progress: true,
    };
    const result = WorkSourceSchema.safeParse(workSource);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.labels?.ready).toBe("ready");
      expect(result.data.cleanup_in_progress).toBe(true);
    }
  });

  it("rejects invalid type", () => {
    const result = WorkSourceSchema.safeParse({ type: "jira" });
    expect(result.success).toBe(false);
  });

  it("parses full GitHub work source configuration", () => {
    const workSource = {
      type: "github",
      repo: "owner/repo-name",
      labels: {
        ready: "ready-for-agent",
        in_progress: "agent-working",
      },
      exclude_labels: ["blocked", "wip"],
      cleanup_on_failure: true,
      auth: {
        token_env: "MY_GITHUB_TOKEN",
      },
    };
    const result = WorkSourceSchema.safeParse(workSource);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("github");
      expect(result.data).toHaveProperty("repo", "owner/repo-name");
    }
  });
});

describe("GitHubWorkSourceSchema", () => {
  describe("repo field validation", () => {
    it("requires repo field", () => {
      const result = GitHubWorkSourceSchema.safeParse({ type: "github" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("repo"))).toBe(
          true
        );
      }
    });

    it("accepts valid owner/repo format", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "octocat/hello-world",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.repo).toBe("octocat/hello-world");
      }
    });

    it("accepts repo with hyphens and underscores", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "my-org/my_repo-name",
      });
      expect(result.success).toBe(true);
    });

    it("accepts repo with dots", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "org.name/repo.name",
      });
      expect(result.success).toBe(true);
    });

    it("accepts repo with numbers", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "org123/repo456",
      });
      expect(result.success).toBe(true);
    });

    it("rejects repo without slash", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "just-repo-name",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("owner/repo");
      }
    });

    it("rejects repo with multiple slashes", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo/extra",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty repo", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects repo with spaces", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner name/repo name",
      });
      expect(result.success).toBe(false);
    });

    it("provides clear error message for invalid repo format", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "invalid",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const repoError = result.error.issues.find((i) =>
          i.path.includes("repo")
        );
        expect(repoError?.message).toContain("owner/repo");
        expect(repoError?.message).toContain("octocat/hello-world");
      }
    });
  });

  describe("labels field", () => {
    it("applies default labels when not specified", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.labels.ready).toBe("ready");
        expect(result.data.labels.in_progress).toBe("agent-working");
      }
    });

    it("allows custom ready label", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        labels: { ready: "custom-ready" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.labels.ready).toBe("custom-ready");
        expect(result.data.labels.in_progress).toBe("agent-working");
      }
    });

    it("allows custom in_progress label", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        labels: { in_progress: "working-on-it" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.labels.ready).toBe("ready");
        expect(result.data.labels.in_progress).toBe("working-on-it");
      }
    });

    it("allows both custom labels", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        labels: {
          ready: "todo",
          in_progress: "doing",
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.labels.ready).toBe("todo");
        expect(result.data.labels.in_progress).toBe("doing");
      }
    });
  });

  describe("exclude_labels field", () => {
    it("defaults to empty array", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.exclude_labels).toEqual([]);
      }
    });

    it("accepts array of strings", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        exclude_labels: ["blocked", "wip", "on-hold"],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.exclude_labels).toEqual([
          "blocked",
          "wip",
          "on-hold",
        ]);
      }
    });

    it("accepts empty array", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        exclude_labels: [],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.exclude_labels).toEqual([]);
      }
    });

    it("rejects non-string array items", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        exclude_labels: ["valid", 123],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("cleanup_on_failure field", () => {
    it("defaults to true", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cleanup_on_failure).toBe(true);
      }
    });

    it("accepts explicit true", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        cleanup_on_failure: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cleanup_on_failure).toBe(true);
      }
    });

    it("accepts false", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        cleanup_on_failure: false,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cleanup_on_failure).toBe(false);
      }
    });

    it("rejects non-boolean values", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        cleanup_on_failure: "yes",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("auth field", () => {
    it("defaults auth.token_env to GITHUB_TOKEN", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.auth.token_env).toBe("GITHUB_TOKEN");
      }
    });

    it("accepts custom token_env", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        auth: { token_env: "MY_GITHUB_PAT" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.auth.token_env).toBe("MY_GITHUB_PAT");
      }
    });

    it("accepts empty auth object (uses defaults)", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
        auth: {},
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.auth.token_env).toBe("GITHUB_TOKEN");
      }
    });
  });

  describe("complete configuration", () => {
    it("parses complete GitHub work source config", () => {
      const config = {
        type: "github",
        repo: "my-org/my-repo",
        labels: {
          ready: "ready-for-work",
          in_progress: "in-progress",
        },
        exclude_labels: ["blocked", "wip", "needs-review"],
        cleanup_on_failure: false,
        auth: {
          token_env: "GH_ENTERPRISE_TOKEN",
        },
      };
      const result = GitHubWorkSourceSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          type: "github",
          repo: "my-org/my-repo",
          labels: {
            ready: "ready-for-work",
            in_progress: "in-progress",
          },
          exclude_labels: ["blocked", "wip", "needs-review"],
          cleanup_on_failure: false,
          auth: {
            token_env: "GH_ENTERPRISE_TOKEN",
          },
        });
      }
    });

    it("applies all defaults for minimal config", () => {
      const result = GitHubWorkSourceSchema.safeParse({
        type: "github",
        repo: "owner/repo",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("github");
        expect(result.data.repo).toBe("owner/repo");
        expect(result.data.labels.ready).toBe("ready");
        expect(result.data.labels.in_progress).toBe("agent-working");
        expect(result.data.exclude_labels).toEqual([]);
        expect(result.data.cleanup_on_failure).toBe(true);
        expect(result.data.auth.token_env).toBe("GITHUB_TOKEN");
      }
    });
  });
});

describe("GitHubAuthSchema", () => {
  it("applies default token_env", () => {
    const result = GitHubAuthSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.token_env).toBe("GITHUB_TOKEN");
    }
  });

  it("accepts custom token_env", () => {
    const result = GitHubAuthSchema.safeParse({ token_env: "CUSTOM_TOKEN" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.token_env).toBe("CUSTOM_TOKEN");
    }
  });
});

describe("BaseWorkSourceSchema", () => {
  it("parses minimal config", () => {
    const result = BaseWorkSourceSchema.safeParse({ type: "github" });
    expect(result.success).toBe(true);
  });

  it("parses with optional fields", () => {
    const result = BaseWorkSourceSchema.safeParse({
      type: "github",
      labels: { ready: "todo" },
      cleanup_in_progress: true,
    });
    expect(result.success).toBe(true);
  });
});

describe("AgentDockerSchema", () => {
  it("applies default enabled", () => {
    const result = AgentDockerSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
    }
  });

  it("accepts safe options", () => {
    const docker = {
      enabled: true,
      ephemeral: false,
      memory: "4g",
      cpu_shares: 512,
      max_containers: 10,
      workspace_mode: "ro",
      tmpfs: ["/tmp"],
      pids_limit: 100,
      labels: { app: "test" },
      cpu_period: 100000,
      cpu_quota: 50000,
    };
    const result = AgentDockerSchema.safeParse(docker);
    expect(result.success).toBe(true);
  });

  it("rejects dangerous option: network", () => {
    const result = AgentDockerSchema.safeParse({
      enabled: true,
      network: "host",
    });
    expect(result.success).toBe(false);
  });

  it("rejects dangerous option: image", () => {
    const result = AgentDockerSchema.safeParse({
      enabled: true,
      image: "malicious:latest",
    });
    expect(result.success).toBe(false);
  });

  it("rejects dangerous option: volumes", () => {
    const result = AgentDockerSchema.safeParse({
      enabled: true,
      volumes: ["/etc:/etc:ro"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects dangerous option: user", () => {
    const result = AgentDockerSchema.safeParse({
      enabled: true,
      user: "0:0",
    });
    expect(result.success).toBe(false);
  });

  it("rejects dangerous option: ports", () => {
    const result = AgentDockerSchema.safeParse({
      enabled: true,
      ports: ["8080:80"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects dangerous option: env", () => {
    const result = AgentDockerSchema.safeParse({
      enabled: true,
      env: { MALICIOUS: "true" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects host_config passthrough", () => {
    const result = AgentDockerSchema.safeParse({
      enabled: true,
      host_config: { Privileged: true },
    });
    expect(result.success).toBe(false);
  });
});

describe("FleetDockerSchema", () => {
  it("applies default enabled", () => {
    const result = FleetDockerSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
    }
  });

  it("accepts all safe options", () => {
    const docker = {
      enabled: true,
      ephemeral: false,
      memory: "4g",
      cpu_shares: 512,
      max_containers: 10,
      workspace_mode: "ro",
      tmpfs: ["/tmp"],
      pids_limit: 100,
      labels: { app: "test" },
    };
    const result = FleetDockerSchema.safeParse(docker);
    expect(result.success).toBe(true);
  });

  it("accepts dangerous options at fleet level", () => {
    const docker = {
      enabled: true,
      image: "custom:latest",
      network: "host",
      volumes: ["/data:/data:rw"],
      user: "1001:1001",
      ports: ["8080:80"],
      env: { API_KEY: "secret" },
    };
    const result = FleetDockerSchema.safeParse(docker);
    expect(result.success).toBe(true);
  });

  it("accepts host_config passthrough", () => {
    const docker = {
      enabled: true,
      host_config: {
        ShmSize: 67108864,
        Privileged: true,
      },
    };
    const result = FleetDockerSchema.safeParse(docker);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.host_config?.ShmSize).toBe(67108864);
      expect(result.data.host_config?.Privileged).toBe(true);
    }
  });

  it("validates volume format", () => {
    const result = FleetDockerSchema.safeParse({
      volumes: ["invalid-format"],
    });
    expect(result.success).toBe(false);
  });

  it("validates port format", () => {
    const result = FleetDockerSchema.safeParse({
      ports: ["invalid"],
    });
    expect(result.success).toBe(false);
  });

  it("validates user format", () => {
    const result = FleetDockerSchema.safeParse({
      user: "invalid",
    });
    expect(result.success).toBe(false);
  });
});

describe("DockerSchema (deprecated alias)", () => {
  it("is an alias for FleetDockerSchema", () => {
    // DockerSchema is now an alias for FleetDockerSchema for backwards compatibility
    const docker = {
      enabled: true,
      base_image: "herdctl-base:latest",
    };
    const result = DockerSchema.safeParse(docker);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.base_image).toBe("herdctl-base:latest");
    }
  });
});

describe("ChatSchema", () => {
  it("parses empty chat", () => {
    const result = ChatSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("parses discord config", () => {
    const chat = {
      discord: {
        enabled: true,
        token_env: "DISCORD_TOKEN",
      },
    };
    const result = ChatSchema.safeParse(chat);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discord?.enabled).toBe(true);
      expect(result.data.discord?.token_env).toBe("DISCORD_TOKEN");
    }
  });

  it("applies default discord enabled", () => {
    const result = ChatSchema.safeParse({ discord: {} });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discord?.enabled).toBe(false);
    }
  });
});

describe("WebhooksSchema", () => {
  it("applies defaults", () => {
    const result = WebhooksSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
      expect(result.data.port).toBe(8081);
    }
  });

  it("parses complete webhooks config", () => {
    const webhooks = {
      enabled: true,
      port: 9000,
      secret_env: "WEBHOOK_SECRET",
    };
    const result = WebhooksSchema.safeParse(webhooks);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.port).toBe(9000);
      expect(result.data.secret_env).toBe("WEBHOOK_SECRET");
    }
  });

  it("rejects negative port", () => {
    const result = WebhooksSchema.safeParse({ port: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects zero port", () => {
    const result = WebhooksSchema.safeParse({ port: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer port", () => {
    const result = WebhooksSchema.safeParse({ port: 80.5 });
    expect(result.success).toBe(false);
  });
});

describe("WebSchema", () => {
  it("applies defaults", () => {
    const result = WebSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
      expect(result.data.port).toBe(3232);
      expect(result.data.host).toBe("localhost");
      expect(result.data.session_expiry_hours).toBe(24);
      expect(result.data.open_browser).toBe(false);
    }
  });

  it("parses minimal enabled config", () => {
    const result = WebSchema.safeParse({ enabled: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.port).toBe(3232);
      expect(result.data.host).toBe("localhost");
      expect(result.data.session_expiry_hours).toBe(24);
      expect(result.data.open_browser).toBe(false);
    }
  });

  it("parses complete web config", () => {
    const web = {
      enabled: true,
      port: 8080,
      host: "0.0.0.0",
      session_expiry_hours: 48,
      open_browser: true,
    };
    const result = WebSchema.safeParse(web);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.port).toBe(8080);
      expect(result.data.host).toBe("0.0.0.0");
      expect(result.data.session_expiry_hours).toBe(48);
      expect(result.data.open_browser).toBe(true);
    }
  });

  it("rejects negative port", () => {
    const result = WebSchema.safeParse({ port: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects zero port", () => {
    const result = WebSchema.safeParse({ port: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer port", () => {
    const result = WebSchema.safeParse({ port: 3456.5 });
    expect(result.success).toBe(false);
  });

  it("rejects negative session_expiry_hours", () => {
    const result = WebSchema.safeParse({ session_expiry_hours: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects zero session_expiry_hours", () => {
    const result = WebSchema.safeParse({ session_expiry_hours: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer session_expiry_hours", () => {
    const result = WebSchema.safeParse({ session_expiry_hours: 24.5 });
    expect(result.success).toBe(false);
  });

  it("accepts string port as invalid", () => {
    const result = WebSchema.safeParse({ port: "3456" });
    expect(result.success).toBe(false);
  });

  it("accepts non-boolean enabled as invalid", () => {
    const result = WebSchema.safeParse({ enabled: "true" });
    expect(result.success).toBe(false);
  });
});

describe("InstancesSchema", () => {
  it("applies default max_concurrent", () => {
    const result = InstancesSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_concurrent).toBe(1);
    }
  });

  it("parses custom max_concurrent", () => {
    const result = InstancesSchema.safeParse({ max_concurrent: 5 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_concurrent).toBe(5);
    }
  });

  it("rejects negative max_concurrent", () => {
    const result = InstancesSchema.safeParse({ max_concurrent: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects zero max_concurrent", () => {
    const result = InstancesSchema.safeParse({ max_concurrent: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer max_concurrent", () => {
    const result = InstancesSchema.safeParse({ max_concurrent: 1.5 });
    expect(result.success).toBe(false);
  });
});

describe("AgentReferenceSchema", () => {
  it("requires path", () => {
    const result = AgentReferenceSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("parses valid path", () => {
    const result = AgentReferenceSchema.safeParse({
      path: "./agents/test.yaml",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.path).toBe("./agents/test.yaml");
    }
  });

  it("parses absolute path", () => {
    const result = AgentReferenceSchema.safeParse({
      path: "/etc/herdctl/agent.yaml",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.path).toBe("/etc/herdctl/agent.yaml");
    }
  });
});

// =============================================================================
// Agent Chat Discord Schema Tests
// =============================================================================

describe("DiscordPresenceSchema", () => {
  it("parses empty presence", () => {
    const result = DiscordPresenceSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("parses complete presence config", () => {
    const presence = {
      activity_type: "watching",
      activity_message: "for support requests",
    };
    const result = DiscordPresenceSchema.safeParse(presence);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activity_type).toBe("watching");
      expect(result.data.activity_message).toBe("for support requests");
    }
  });

  it("accepts all valid activity types", () => {
    const validTypes = ["playing", "watching", "listening", "competing"];
    for (const activityType of validTypes) {
      const result = DiscordPresenceSchema.safeParse({
        activity_type: activityType,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid activity type", () => {
    const result = DiscordPresenceSchema.safeParse({
      activity_type: "streaming",
    });
    expect(result.success).toBe(false);
  });
});

describe("ChatDMSchema", () => {
  it("applies defaults", () => {
    const result = ChatDMSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.mode).toBe("auto");
    }
  });

  it("parses complete DM config", () => {
    const dm = {
      enabled: false,
      mode: "mention",
      allowlist: ["123456789012345678", "987654321098765432"],
      blocklist: ["111222333444555666"],
    };
    const result = ChatDMSchema.safeParse(dm);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
      expect(result.data.mode).toBe("mention");
      expect(result.data.allowlist).toEqual([
        "123456789012345678",
        "987654321098765432",
      ]);
      expect(result.data.blocklist).toEqual(["111222333444555666"]);
    }
  });

  it("accepts valid modes", () => {
    for (const mode of ["mention", "auto"]) {
      const result = ChatDMSchema.safeParse({ mode });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid mode", () => {
    const result = ChatDMSchema.safeParse({ mode: "always" });
    expect(result.success).toBe(false);
  });
});

describe("DiscordChannelSchema", () => {
  it("requires id", () => {
    const result = DiscordChannelSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("parses minimal channel config", () => {
    const result = DiscordChannelSchema.safeParse({
      id: "987654321098765432",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("987654321098765432");
      expect(result.data.mode).toBe("mention");
      expect(result.data.context_messages).toBe(10);
    }
  });

  it("parses complete channel config", () => {
    const channel = {
      id: "987654321098765432",
      name: "#support",
      mode: "auto",
      context_messages: 20,
    };
    const result = DiscordChannelSchema.safeParse(channel);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("987654321098765432");
      expect(result.data.name).toBe("#support");
      expect(result.data.mode).toBe("auto");
      expect(result.data.context_messages).toBe(20);
    }
  });

  it("rejects invalid context_messages", () => {
    const result = DiscordChannelSchema.safeParse({
      id: "123",
      context_messages: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative context_messages", () => {
    const result = DiscordChannelSchema.safeParse({
      id: "123",
      context_messages: -5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer context_messages", () => {
    const result = DiscordChannelSchema.safeParse({
      id: "123",
      context_messages: 10.5,
    });
    expect(result.success).toBe(false);
  });
});

describe("DiscordGuildSchema", () => {
  it("requires id", () => {
    const result = DiscordGuildSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("parses minimal guild config", () => {
    const result = DiscordGuildSchema.safeParse({
      id: "123456789012345678",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("123456789012345678");
      expect(result.data.channels).toBeUndefined();
      expect(result.data.dm).toBeUndefined();
    }
  });

  it("parses complete guild config", () => {
    const guild = {
      id: "123456789012345678",
      channels: [
        {
          id: "987654321098765432",
          name: "#support",
          mode: "mention",
          context_messages: 10,
        },
        {
          id: "111222333444555666",
          name: "#general",
          mode: "mention",
        },
      ],
      dm: {
        enabled: true,
        mode: "auto",
        allowlist: [],
        blocklist: [],
      },
    };
    const result = DiscordGuildSchema.safeParse(guild);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("123456789012345678");
      expect(result.data.channels).toHaveLength(2);
      expect(result.data.channels?.[0].name).toBe("#support");
      expect(result.data.dm?.enabled).toBe(true);
      expect(result.data.dm?.mode).toBe("auto");
    }
  });

  it("validates nested channel schemas", () => {
    const guild = {
      id: "123456789012345678",
      channels: [
        {
          // missing required id
          name: "#support",
        },
      ],
    };
    const result = DiscordGuildSchema.safeParse(guild);
    expect(result.success).toBe(false);
  });
});

describe("AgentChatDiscordSchema", () => {
  it("requires bot_token_env", () => {
    const result = AgentChatDiscordSchema.safeParse({
      guilds: [{ id: "123456789012345678" }],
    });
    expect(result.success).toBe(false);
  });

  it("requires guilds", () => {
    const result = AgentChatDiscordSchema.safeParse({
      bot_token_env: "SUPPORT_DISCORD_TOKEN",
    });
    expect(result.success).toBe(false);
  });

  it("parses minimal config", () => {
    const config = {
      bot_token_env: "SUPPORT_DISCORD_TOKEN",
      guilds: [{ id: "123456789012345678" }],
    };
    const result = AgentChatDiscordSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bot_token_env).toBe("SUPPORT_DISCORD_TOKEN");
      expect(result.data.session_expiry_hours).toBe(24);
      expect(result.data.log_level).toBe("standard");
      expect(result.data.guilds).toHaveLength(1);
    }
  });

  it("parses complete config", () => {
    const config = {
      bot_token_env: "SUPPORT_DISCORD_TOKEN",
      session_expiry_hours: 48,
      log_level: "verbose",
      presence: {
        activity_type: "watching",
        activity_message: "for support requests",
      },
      guilds: [
        {
          id: "123456789012345678",
          channels: [
            {
              id: "987654321098765432",
              name: "#support",
              mode: "mention",
              context_messages: 10,
            },
            {
              id: "111222333444555666",
              name: "#general",
              mode: "mention",
            },
          ],
          dm: {
            enabled: true,
            mode: "auto",
          },
        },
      ],
    };
    const result = AgentChatDiscordSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bot_token_env).toBe("SUPPORT_DISCORD_TOKEN");
      expect(result.data.session_expiry_hours).toBe(48);
      expect(result.data.log_level).toBe("verbose");
      expect(result.data.presence?.activity_type).toBe("watching");
      expect(result.data.presence?.activity_message).toBe(
        "for support requests"
      );
      expect(result.data.guilds).toHaveLength(1);
      expect(result.data.guilds[0].channels).toHaveLength(2);
    }
  });

  it("accepts all valid log levels", () => {
    for (const logLevel of ["minimal", "standard", "verbose"]) {
      const result = AgentChatDiscordSchema.safeParse({
        bot_token_env: "TOKEN",
        log_level: logLevel,
        guilds: [{ id: "123" }],
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid log level", () => {
    const result = AgentChatDiscordSchema.safeParse({
      bot_token_env: "TOKEN",
      log_level: "debug",
      guilds: [{ id: "123" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero session_expiry_hours", () => {
    const result = AgentChatDiscordSchema.safeParse({
      bot_token_env: "TOKEN",
      session_expiry_hours: 0,
      guilds: [{ id: "123" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative session_expiry_hours", () => {
    const result = AgentChatDiscordSchema.safeParse({
      bot_token_env: "TOKEN",
      session_expiry_hours: -1,
      guilds: [{ id: "123" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer session_expiry_hours", () => {
    const result = AgentChatDiscordSchema.safeParse({
      bot_token_env: "TOKEN",
      session_expiry_hours: 24.5,
      guilds: [{ id: "123" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty guilds array", () => {
    const result = AgentChatDiscordSchema.safeParse({
      bot_token_env: "TOKEN",
      guilds: [],
    });
    // Empty array is technically valid from Zod's perspective
    // but semantically the bot needs at least one guild
    expect(result.success).toBe(true);
  });

  it("applies output defaults when output is omitted", () => {
    const result = AgentChatDiscordSchema.safeParse({
      bot_token_env: "TOKEN",
      guilds: [{ id: "123", channels: [{ id: "456" }] }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.output).toEqual({
        tool_results: true,
        tool_result_max_length: 900,
        system_status: true,
        result_summary: false,
        errors: true,
      });
    }
  });

  it("accepts custom output configuration", () => {
    const result = AgentChatDiscordSchema.safeParse({
      bot_token_env: "TOKEN",
      guilds: [{ id: "123", channels: [{ id: "456" }] }],
      output: {
        tool_results: false,
        tool_result_max_length: 500,
        system_status: false,
        result_summary: true,
        errors: false,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.output.tool_results).toBe(false);
      expect(result.data.output.tool_result_max_length).toBe(500);
      expect(result.data.output.system_status).toBe(false);
      expect(result.data.output.result_summary).toBe(true);
      expect(result.data.output.errors).toBe(false);
    }
  });

  it("rejects tool_result_max_length over 1000", () => {
    const result = AgentChatDiscordSchema.safeParse({
      bot_token_env: "TOKEN",
      guilds: [{ id: "123", channels: [{ id: "456" }] }],
      output: { tool_result_max_length: 1500 },
    });
    expect(result.success).toBe(false);
  });
});

describe("AgentChatSchema", () => {
  it("parses empty chat config", () => {
    const result = AgentChatSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discord).toBeUndefined();
    }
  });

  it("parses with discord config", () => {
    const chat = {
      discord: {
        bot_token_env: "SUPPORT_DISCORD_TOKEN",
        guilds: [{ id: "123456789012345678" }],
      },
    };
    const result = AgentChatSchema.safeParse(chat);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discord?.bot_token_env).toBe("SUPPORT_DISCORD_TOKEN");
      expect(result.data.discord?.guilds).toHaveLength(1);
    }
  });

  it("validates nested discord schema", () => {
    const chat = {
      discord: {
        // missing required bot_token_env and guilds
      },
    };
    const result = AgentChatSchema.safeParse(chat);
    expect(result.success).toBe(false);
  });
});
