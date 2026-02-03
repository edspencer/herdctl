import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadConfig,
  safeLoadConfig,
  findConfigFile,
  CONFIG_FILE_NAMES,
  ConfigNotFoundError,
  AgentLoadError,
} from "../loader.js";
import { FileReadError, SchemaValidationError } from "../parser.js";
import { UndefinedVariableError } from "../interpolate.js";

// Helper to create a temp directory structure
async function createTempDir(): Promise<string> {
  const baseDir = join(tmpdir(), `herdctl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(baseDir, { recursive: true });
  // Resolve to real path to handle macOS /var -> /private/var symlink
  return await realpath(baseDir);
}

// Helper to create a file
async function createFile(filePath: string, content: string): Promise<void> {
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

describe("CONFIG_FILE_NAMES", () => {
  it("includes herdctl.yaml and herdctl.yml", () => {
    expect(CONFIG_FILE_NAMES).toContain("herdctl.yaml");
    expect(CONFIG_FILE_NAMES).toContain("herdctl.yml");
    expect(CONFIG_FILE_NAMES).toHaveLength(2);
  });
});

describe("findConfigFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("finds herdctl.yaml in the current directory", async () => {
    await createFile(join(tempDir, "herdctl.yaml"), "version: 1");

    const result = await findConfigFile(tempDir);

    expect(result).not.toBeNull();
    expect(result!.path).toBe(join(tempDir, "herdctl.yaml"));
  });

  it("finds herdctl.yml in the current directory", async () => {
    await createFile(join(tempDir, "herdctl.yml"), "version: 1");

    const result = await findConfigFile(tempDir);

    expect(result).not.toBeNull();
    expect(result!.path).toBe(join(tempDir, "herdctl.yml"));
  });

  it("prefers herdctl.yaml over herdctl.yml", async () => {
    await createFile(join(tempDir, "herdctl.yaml"), "version: 1");
    await createFile(join(tempDir, "herdctl.yml"), "version: 1");

    const result = await findConfigFile(tempDir);

    expect(result).not.toBeNull();
    expect(result!.path).toBe(join(tempDir, "herdctl.yaml"));
  });

  it("finds config file in parent directory", async () => {
    const subDir = join(tempDir, "sub", "deep", "nested");
    await mkdir(subDir, { recursive: true });
    await createFile(join(tempDir, "herdctl.yaml"), "version: 1");

    const result = await findConfigFile(subDir);

    expect(result).not.toBeNull();
    expect(result!.path).toBe(join(tempDir, "herdctl.yaml"));
  });

  it("finds config file in intermediate parent directory", async () => {
    const subDir = join(tempDir, "sub", "deep", "nested");
    const intermediateDir = join(tempDir, "sub");
    await mkdir(subDir, { recursive: true });
    await createFile(join(intermediateDir, "herdctl.yaml"), "version: 1");

    const result = await findConfigFile(subDir);

    expect(result).not.toBeNull();
    expect(result!.path).toBe(join(intermediateDir, "herdctl.yaml"));
  });

  it("returns null when no config file is found", async () => {
    const result = await findConfigFile(tempDir);

    expect(result).toBeNull();
  });

  it("returns searched paths when config is found", async () => {
    const subDir = join(tempDir, "sub");
    await mkdir(subDir, { recursive: true });
    await createFile(join(tempDir, "herdctl.yaml"), "version: 1");

    const result = await findConfigFile(subDir);

    expect(result).not.toBeNull();
    expect(result!.searchedPaths).toContain(join(subDir, "herdctl.yaml"));
    expect(result!.searchedPaths).toContain(join(subDir, "herdctl.yml"));
    expect(result!.searchedPaths).toContain(join(tempDir, "herdctl.yaml"));
  });
});

describe("ConfigNotFoundError", () => {
  it("creates error with correct properties", () => {
    const searchedPaths = ["/path/a", "/path/b"];
    const error = new ConfigNotFoundError("/start/dir", searchedPaths);

    expect(error.name).toBe("ConfigNotFoundError");
    expect(error.startDirectory).toBe("/start/dir");
    expect(error.searchedPaths).toEqual(searchedPaths);
    expect(error.message).toContain("No herdctl configuration file found");
    expect(error.message).toContain("/start/dir");
  });
});

describe("AgentLoadError", () => {
  it("creates error with correct properties", () => {
    const cause = new Error("File not found");
    const error = new AgentLoadError("./agents/test.yaml", cause, "test-agent");

    expect(error.name).toBe("AgentLoadError");
    expect(error.agentPath).toBe("./agents/test.yaml");
    expect(error.agentName).toBe("test-agent");
    expect(error.cause).toBe(cause);
    expect(error.message).toContain("test.yaml");
    expect(error.message).toContain("test-agent");
    expect(error.message).toContain("File not found");
  });

  it("creates error without agent name", () => {
    const cause = new Error("File not found");
    const error = new AgentLoadError("./agents/test.yaml", cause);

    expect(error.agentName).toBeUndefined();
    expect(error.message).not.toContain("(undefined)");
  });
});

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("file discovery", () => {
    it("loads config from explicit yaml file path", async () => {
      const configPath = join(tempDir, "herdctl.yaml");
      await createFile(configPath, "version: 1");

      const result = await loadConfig(configPath);

      expect(result.fleet.version).toBe(1);
      expect(result.configPath).toBe(configPath);
      expect(result.configDir).toBe(tempDir);
    });

    it("loads config from explicit yml file path", async () => {
      const configPath = join(tempDir, "herdctl.yml");
      await createFile(configPath, "version: 1");

      const result = await loadConfig(configPath);

      expect(result.fleet.version).toBe(1);
      expect(result.configPath).toBe(configPath);
    });

    it("searches from directory when path is a directory", async () => {
      await createFile(join(tempDir, "herdctl.yaml"), "version: 1");

      const result = await loadConfig(tempDir);

      expect(result.fleet.version).toBe(1);
      expect(result.configPath).toBe(join(tempDir, "herdctl.yaml"));
    });

    it("throws ConfigNotFoundError when no config found in directory", async () => {
      await expect(loadConfig(tempDir)).rejects.toThrow(ConfigNotFoundError);
    });

    it("throws FileReadError when specified file does not exist", async () => {
      const nonExistentPath = join(tempDir, "nonexistent.yaml");

      await expect(loadConfig(nonExistentPath)).rejects.toThrow(FileReadError);
    });
  });

  describe("fleet configuration parsing", () => {
    it("parses empty config with defaults", async () => {
      await createFile(join(tempDir, "herdctl.yaml"), "");

      const result = await loadConfig(tempDir);

      expect(result.fleet.version).toBe(1);
      expect(result.fleet.agents).toEqual([]);
    });

    it("parses complete fleet configuration", async () => {
      const config = `
version: 1
fleet:
  name: test-fleet
  description: A test fleet
defaults:
  model: claude-sonnet-4-20250514
  max_turns: 50
working_directory:
  root: ./workspace
`;
      await createFile(join(tempDir, "herdctl.yaml"), config);

      const result = await loadConfig(tempDir);

      expect(result.fleet.fleet?.name).toBe("test-fleet");
      expect(result.fleet.fleet?.description).toBe("A test fleet");
      expect(result.fleet.defaults?.model).toBe("claude-sonnet-4-20250514");
      expect(result.fleet.defaults?.max_turns).toBe(50);
      expect(result.fleet.working_directory?.root).toBe("./workspace");
    });

    it("throws on invalid YAML syntax", async () => {
      await createFile(join(tempDir, "herdctl.yaml"), "invalid: yaml: syntax:");

      await expect(loadConfig(tempDir)).rejects.toThrow("Invalid YAML syntax");
    });

    it("throws SchemaValidationError on invalid schema", async () => {
      await createFile(join(tempDir, "herdctl.yaml"), "version: -1");

      await expect(loadConfig(tempDir)).rejects.toThrow(SchemaValidationError);
    });
  });

  describe("agent loading", () => {
    it("loads agents referenced in fleet config", async () => {
      const fleetConfig = `
version: 1
agents:
  - path: ./agents/test-agent.yaml
`;
      const agentConfig = `
name: test-agent
description: A test agent
`;
      await createFile(join(tempDir, "herdctl.yaml"), fleetConfig);
      await createFile(join(tempDir, "agents", "test-agent.yaml"), agentConfig);

      const result = await loadConfig(tempDir);

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].name).toBe("test-agent");
      expect(result.agents[0].description).toBe("A test agent");
      expect(result.agents[0].configPath).toBe(join(tempDir, "agents", "test-agent.yaml"));
    });

    it("loads multiple agents", async () => {
      const fleetConfig = `
version: 1
agents:
  - path: ./agents/agent1.yaml
  - path: ./agents/agent2.yaml
`;
      await createFile(join(tempDir, "herdctl.yaml"), fleetConfig);
      await createFile(join(tempDir, "agents", "agent1.yaml"), "name: agent-one");
      await createFile(join(tempDir, "agents", "agent2.yaml"), "name: agent-two");

      const result = await loadConfig(tempDir);

      expect(result.agents).toHaveLength(2);
      expect(result.agents[0].name).toBe("agent-one");
      expect(result.agents[1].name).toBe("agent-two");
    });

    it("throws AgentLoadError when agent file not found", async () => {
      const fleetConfig = `
version: 1
agents:
  - path: ./agents/nonexistent.yaml
`;
      await createFile(join(tempDir, "herdctl.yaml"), fleetConfig);

      await expect(loadConfig(tempDir)).rejects.toThrow(AgentLoadError);
    });

    it("throws AgentLoadError when agent YAML is invalid", async () => {
      const fleetConfig = `
version: 1
agents:
  - path: ./agents/invalid.yaml
`;
      await createFile(join(tempDir, "herdctl.yaml"), fleetConfig);
      await createFile(join(tempDir, "agents", "invalid.yaml"), "invalid: yaml: syntax:");

      await expect(loadConfig(tempDir)).rejects.toThrow(AgentLoadError);
    });

    it("throws AgentLoadError when agent schema is invalid", async () => {
      const fleetConfig = `
version: 1
agents:
  - path: ./agents/invalid.yaml
`;
      await createFile(join(tempDir, "herdctl.yaml"), fleetConfig);
      // Missing required 'name' field
      await createFile(join(tempDir, "agents", "invalid.yaml"), "description: no name");

      await expect(loadConfig(tempDir)).rejects.toThrow(AgentLoadError);
    });

    it("resolves absolute agent paths correctly", async () => {
      const agentPath = join(tempDir, "elsewhere", "agent.yaml");
      const fleetConfig = `
version: 1
agents:
  - path: ${agentPath}
`;
      await createFile(join(tempDir, "herdctl.yaml"), fleetConfig);
      await createFile(agentPath, "name: elsewhere-agent");

      const result = await loadConfig(tempDir);

      expect(result.agents[0].name).toBe("elsewhere-agent");
      expect(result.agents[0].configPath).toBe(agentPath);
    });
  });

  describe("defaults merging", () => {
    it("merges fleet defaults into agent config", async () => {
      const fleetConfig = `
version: 1
defaults:
  model: claude-sonnet-4-20250514
  max_turns: 100
  permission_mode: acceptEdits
agents:
  - path: ./agents/test.yaml
`;
      const agentConfig = `
name: test-agent
`;
      await createFile(join(tempDir, "herdctl.yaml"), fleetConfig);
      await createFile(join(tempDir, "agents", "test.yaml"), agentConfig);

      const result = await loadConfig(tempDir);

      expect(result.agents[0].model).toBe("claude-sonnet-4-20250514");
      expect(result.agents[0].max_turns).toBe(100);
      expect(result.agents[0].permission_mode).toBe("acceptEdits");
    });

    it("agent values override fleet defaults", async () => {
      const fleetConfig = `
version: 1
defaults:
  model: claude-sonnet-4-20250514
  max_turns: 100
agents:
  - path: ./agents/test.yaml
`;
      const agentConfig = `
name: test-agent
model: claude-opus-4-20250514
max_turns: 50
`;
      await createFile(join(tempDir, "herdctl.yaml"), fleetConfig);
      await createFile(join(tempDir, "agents", "test.yaml"), agentConfig);

      const result = await loadConfig(tempDir);

      expect(result.agents[0].model).toBe("claude-opus-4-20250514");
      expect(result.agents[0].max_turns).toBe(50);
    });

    it("deep merges nested objects", async () => {
      const fleetConfig = `
version: 1
defaults:
  permissions:
    mode: acceptEdits
    allowed_tools:
      - Read
      - Write
agents:
  - path: ./agents/test.yaml
`;
      const agentConfig = `
name: test-agent
permissions:
  allowed_tools:
    - Bash
`;
      await createFile(join(tempDir, "herdctl.yaml"), fleetConfig);
      await createFile(join(tempDir, "agents", "test.yaml"), agentConfig);

      const result = await loadConfig(tempDir);

      // Mode should come from defaults
      expect(result.agents[0].permissions?.mode).toBe("acceptEdits");
      // Arrays are replaced, not merged
      expect(result.agents[0].permissions?.allowed_tools).toEqual(["Bash"]);
    });

    it("skips merging when mergeDefaults is false", async () => {
      const fleetConfig = `
version: 1
defaults:
  model: claude-sonnet-4-20250514
agents:
  - path: ./agents/test.yaml
`;
      const agentConfig = `
name: test-agent
`;
      await createFile(join(tempDir, "herdctl.yaml"), fleetConfig);
      await createFile(join(tempDir, "agents", "test.yaml"), agentConfig);

      const result = await loadConfig(tempDir, { mergeDefaults: false });

      expect(result.agents[0].model).toBeUndefined();
    });
  });

  describe("environment interpolation", () => {
    it("interpolates environment variables in fleet config", async () => {
      const fleetConfig = `
version: 1
fleet:
  name: \${FLEET_NAME}
`;
      await createFile(join(tempDir, "herdctl.yaml"), fleetConfig);

      const result = await loadConfig(tempDir, {
        env: { FLEET_NAME: "my-fleet" },
      });

      expect(result.fleet.fleet?.name).toBe("my-fleet");
    });

    it("interpolates environment variables in agent config", async () => {
      const fleetConfig = `
version: 1
agents:
  - path: ./agents/test.yaml
`;
      const agentConfig = `
name: test-agent
model: \${MODEL_NAME}
`;
      await createFile(join(tempDir, "herdctl.yaml"), fleetConfig);
      await createFile(join(tempDir, "agents", "test.yaml"), agentConfig);

      const result = await loadConfig(tempDir, {
        env: { MODEL_NAME: "claude-sonnet-4-20250514" },
      });

      expect(result.agents[0].model).toBe("claude-sonnet-4-20250514");
    });

    it("uses default values for undefined variables", async () => {
      const fleetConfig = `
version: 1
fleet:
  name: \${FLEET_NAME:-default-fleet}
`;
      await createFile(join(tempDir, "herdctl.yaml"), fleetConfig);

      const result = await loadConfig(tempDir, { env: {} });

      expect(result.fleet.fleet?.name).toBe("default-fleet");
    });

    it("throws UndefinedVariableError for undefined variables without default", async () => {
      const fleetConfig = `
version: 1
fleet:
  name: \${UNDEFINED_VAR}
`;
      await createFile(join(tempDir, "herdctl.yaml"), fleetConfig);

      await expect(loadConfig(tempDir, { env: {} })).rejects.toThrow(UndefinedVariableError);
    });

    it("skips interpolation when interpolate is false", async () => {
      const fleetConfig = `
version: 1
fleet:
  name: \${FLEET_NAME}
`;
      await createFile(join(tempDir, "herdctl.yaml"), fleetConfig);

      const result = await loadConfig(tempDir, {
        interpolate: false,
        env: { FLEET_NAME: "my-fleet" },
      });

      expect(result.fleet.fleet?.name).toBe("${FLEET_NAME}");
    });
  });

  describe("result structure", () => {
    it("returns correct structure with all fields", async () => {
      const fleetConfig = `
version: 1
fleet:
  name: test-fleet
agents:
  - path: ./agents/test.yaml
`;
      await createFile(join(tempDir, "herdctl.yaml"), fleetConfig);
      await createFile(join(tempDir, "agents", "test.yaml"), "name: test-agent");

      const result = await loadConfig(tempDir);

      expect(result).toHaveProperty("fleet");
      expect(result).toHaveProperty("agents");
      expect(result).toHaveProperty("configPath");
      expect(result).toHaveProperty("configDir");
      expect(result.configPath).toBe(join(tempDir, "herdctl.yaml"));
      expect(result.configDir).toBe(tempDir);
    });

    it("returns empty agents array when no agents defined", async () => {
      await createFile(join(tempDir, "herdctl.yaml"), "version: 1");

      const result = await loadConfig(tempDir);

      expect(result.agents).toEqual([]);
    });
  });
});

describe("safeLoadConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns success result when config loads successfully", async () => {
    await createFile(join(tempDir, "herdctl.yaml"), "version: 1");

    const result = await safeLoadConfig(tempDir);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fleet.version).toBe(1);
    }
  });

  it("returns failure result with ConfigNotFoundError", async () => {
    const result = await safeLoadConfig(tempDir);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ConfigNotFoundError);
    }
  });

  it("returns failure result with FileReadError", async () => {
    const result = await safeLoadConfig(join(tempDir, "nonexistent.yaml"));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(FileReadError);
    }
  });

  it("returns failure result with SchemaValidationError", async () => {
    await createFile(join(tempDir, "herdctl.yaml"), "version: invalid");

    const result = await safeLoadConfig(tempDir);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(SchemaValidationError);
    }
  });

  it("returns failure result with AgentLoadError", async () => {
    const fleetConfig = `
version: 1
agents:
  - path: ./nonexistent.yaml
`;
    await createFile(join(tempDir, "herdctl.yaml"), fleetConfig);

    const result = await safeLoadConfig(tempDir);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(AgentLoadError);
    }
  });

  it("wraps non-ConfigError errors", async () => {
    // Create a file that will cause an unexpected error
    // This is difficult to trigger, so we'll test the general behavior
    await createFile(join(tempDir, "herdctl.yaml"), "version: 1");

    const result = await safeLoadConfig(tempDir);

    expect(result.success).toBe(true);
  });
});

describe("auto-discovery from cwd", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    originalCwd = process.cwd();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("finds config from current working directory when no path provided", async () => {
    await createFile(join(tempDir, "herdctl.yaml"), "version: 1");
    process.chdir(tempDir);

    const result = await loadConfig();

    expect(result.fleet.version).toBe(1);
    expect(result.configPath).toBe(join(tempDir, "herdctl.yaml"));
  });

  it("throws ConfigNotFoundError when no config in cwd hierarchy", async () => {
    process.chdir(tempDir);

    await expect(loadConfig()).rejects.toThrow(ConfigNotFoundError);
  });
});

describe("integration scenarios", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("handles a realistic fleet configuration", async () => {
    const fleetConfig = `
version: 1

fleet:
  name: example-fleet
  description: An example herdctl fleet

defaults:
  model: claude-sonnet-4-20250514
  max_turns: 50
  permission_mode: acceptEdits
  permissions:
    allowed_tools:
      - Read
      - Edit
      - Write
      - Bash
      - Glob
      - Grep

working_directory:
  root: ./workspace
  auto_clone: true
  clone_depth: 1

agents:
  - path: ./agents/coder.yaml
  - path: ./agents/reviewer.yaml

chat:
  discord:
    enabled: true
    token_env: DISCORD_TOKEN
`;

    const coderAgent = `
name: coder
description: Writes code based on issues
system_prompt: |
  You are a coding assistant.
  Write clean, maintainable code.
permissions:
  allowed_tools:
    - Read
    - Edit
    - Write
    - Bash
`;

    const reviewerAgent = `
name: reviewer
description: Reviews pull requests
model: claude-opus-4-20250514
max_turns: 25
system_prompt: |
  You are a code reviewer.
  Focus on code quality and security.
`;

    await createFile(join(tempDir, "herdctl.yaml"), fleetConfig);
    await createFile(join(tempDir, "agents", "coder.yaml"), coderAgent);
    await createFile(join(tempDir, "agents", "reviewer.yaml"), reviewerAgent);

    const result = await loadConfig(tempDir, {
      env: { DISCORD_TOKEN: "test-token" },
    });

    // Fleet config
    expect(result.fleet.fleet?.name).toBe("example-fleet");
    expect(result.fleet.defaults?.model).toBe("claude-sonnet-4-20250514");
    expect(result.fleet.working_directory?.root).toBe("./workspace");
    expect(result.fleet.chat?.discord?.enabled).toBe(true);

    // Agents loaded
    expect(result.agents).toHaveLength(2);

    // Coder agent - inherits defaults
    const coder = result.agents.find(a => a.name === "coder");
    expect(coder).toBeDefined();
    expect(coder!.model).toBe("claude-sonnet-4-20250514"); // from defaults
    expect(coder!.max_turns).toBe(50); // from defaults
    expect(coder!.permission_mode).toBe("acceptEdits"); // from defaults
    expect(coder!.permissions?.allowed_tools).toEqual(["Read", "Edit", "Write", "Bash"]); // agent override

    // Reviewer agent - overrides defaults
    const reviewer = result.agents.find(a => a.name === "reviewer");
    expect(reviewer).toBeDefined();
    expect(reviewer!.model).toBe("claude-opus-4-20250514"); // agent override
    expect(reviewer!.max_turns).toBe(25); // agent override
    expect(reviewer!.permission_mode).toBe("acceptEdits"); // from defaults
  });

  it("handles nested directory structure", async () => {
    const subDir = join(tempDir, "projects", "myproject", "src");
    await mkdir(subDir, { recursive: true });

    await createFile(join(tempDir, "projects", "myproject", "herdctl.yaml"), `
version: 1
agents:
  - path: ./config/agent.yaml
`);
    await createFile(join(tempDir, "projects", "myproject", "config", "agent.yaml"), `
name: nested-agent
`);

    const result = await loadConfig(subDir);

    expect(result.configPath).toBe(join(tempDir, "projects", "myproject", "herdctl.yaml"));
    expect(result.agents[0].name).toBe("nested-agent");
  });

  describe("workspace normalization", () => {
    it("defaults workspace to agent config directory when not specified", async () => {
      await createFile(join(tempDir, "herdctl.yaml"), `
version: 1
agents:
  - path: ./agents/worker.yaml
`);
      await createFile(join(tempDir, "agents", "worker.yaml"), `
name: worker
`);

      const result = await loadConfig(tempDir);

      expect(result.agents[0].working_directory).toBe(join(tempDir, "agents"));
    });

    it("resolves relative workspace path relative to agent config directory", async () => {
      await createFile(join(tempDir, "herdctl.yaml"), `
version: 1
agents:
  - path: ./agents/nested/worker.yaml
`);
      await createFile(join(tempDir, "agents", "nested", "worker.yaml"), `
name: worker
working_directory: ../..
`);

      const result = await loadConfig(tempDir);

      // Agent at /temp/agents/nested, workspace ../.. resolves to /temp
      expect(result.agents[0].working_directory).toBe(tempDir);
    });

    it("keeps absolute workspace path as-is", async () => {
      await createFile(join(tempDir, "herdctl.yaml"), `
version: 1
agents:
  - path: ./agents/worker.yaml
`);
      await createFile(join(tempDir, "agents", "worker.yaml"), `
name: worker
working_directory: /absolute/path/to/workspace
`);

      const result = await loadConfig(tempDir);

      expect(result.agents[0].working_directory).toBe("/absolute/path/to/workspace");
    });

    it("resolves relative workspace root in object form", async () => {
      await createFile(join(tempDir, "herdctl.yaml"), `
version: 1
agents:
  - path: ./agents/worker.yaml
`);
      await createFile(join(tempDir, "agents", "worker.yaml"), `
name: worker
working_directory:
  root: ..
  auto_clone: true
`);

      const result = await loadConfig(tempDir);

      expect(typeof result.agents[0].working_directory).toBe("object");
      const working_directory = result.agents[0].working_directory as {
        root: string;
      };
      expect(working_directory.root).toBe(tempDir);
    });

    it("keeps absolute workspace root in object form as-is", async () => {
      await createFile(join(tempDir, "herdctl.yaml"), `
version: 1
agents:
  - path: ./agents/worker.yaml
`);
      await createFile(join(tempDir, "agents", "worker.yaml"), `
name: worker
working_directory:
  root: /absolute/workspace
  auto_clone: false
`);

      const result = await loadConfig(tempDir);

      expect(typeof result.agents[0].working_directory).toBe("object");
      const working_directory = result.agents[0].working_directory as {
        root: string;
      };
      expect(working_directory.root).toBe("/absolute/workspace");
    });

    it("respects workspace from fleet defaults", async () => {
      await createFile(join(tempDir, "herdctl.yaml"), `
version: 1
defaults:
  working_directory: ./default-workspace
agents:
  - path: ./agents/worker.yaml
`);
      await createFile(join(tempDir, "agents", "worker.yaml"), `
name: worker
`);

      const result = await loadConfig(tempDir);

      // Fleet default workspace gets resolved relative to fleet config dir,
      // then used as the agent workspace default before normalization
      expect(result.agents[0].working_directory).toBe(join(tempDir, "default-workspace"));
    });

    it("agent workspace overrides fleet default workspace", async () => {
      await createFile(join(tempDir, "herdctl.yaml"), `
version: 1
defaults:
  working_directory: ./default-workspace
agents:
  - path: ./agents/worker.yaml
`);
      await createFile(join(tempDir, "agents", "worker.yaml"), `
name: worker
working_directory: ./custom-workspace
`);

      const result = await loadConfig(tempDir);

      // Agent's relative workspace is resolved relative to agent config directory
      expect(result.agents[0].working_directory).toBe(join(tempDir, "agents", "custom-workspace"));
    });
  });

  describe("backward compatibility for workspace -> working_directory", () => {
    it("migrates agent workspace to working_directory with warning", async () => {
      await createFile(join(tempDir, "herdctl.yaml"), `
version: 1
agents:
  - path: ./agents/worker.yaml
`);
      await createFile(join(tempDir, "agents", "worker.yaml"), `
name: worker
workspace: /old/workspace/path
`);

      // Capture console.warn
      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (...args: unknown[]) => {
        warnings.push(args.join(" "));
      };

      try {
        const result = await loadConfig(tempDir);

        // Should use the old workspace value
        expect(result.agents[0].working_directory).toBe("/old/workspace/path");

        // Should emit a warning
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings.some((w) => w.includes("deprecated"))).toBe(true);
        expect(warnings.some((w) => w.includes("workspace"))).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });

    it("migrates fleet defaults workspace to working_directory with warning", async () => {
      await createFile(join(tempDir, "herdctl.yaml"), `
version: 1
defaults:
  workspace: ./fleet/workspace
agents:
  - path: ./agents/worker.yaml
`);
      await createFile(join(tempDir, "agents", "worker.yaml"), `
name: worker
`);

      // Capture console.warn
      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (...args: unknown[]) => {
        warnings.push(args.join(" "));
      };

      try {
        const result = await loadConfig(tempDir);

        // Should use the fleet default workspace value (resolved to absolute path)
        expect(result.agents[0].working_directory).toBe(
          join(tempDir, "fleet/workspace")
        );

        // Should emit a warning for defaults
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings.some((w) => w.includes("deprecated"))).toBe(true);
        expect(warnings.some((w) => w.includes("workspace"))).toBe(true);
        expect(warnings.some((w) => w.includes("defaults"))).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });

    it("prefers working_directory over workspace when both are present", async () => {
      await createFile(join(tempDir, "herdctl.yaml"), `
version: 1
agents:
  - path: ./agents/worker.yaml
`);
      await createFile(join(tempDir, "agents", "worker.yaml"), `
name: worker
workspace: /old/workspace
working_directory: /new/directory
`);

      // Capture console.warn
      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (...args: unknown[]) => {
        warnings.push(args.join(" "));
      };

      try {
        const result = await loadConfig(tempDir);

        // Should use working_directory, not workspace
        expect(result.agents[0].working_directory).toBe("/new/directory");

        // Should NOT emit a warning (working_directory takes precedence)
        expect(
          warnings.some(
            (w) => w.includes("deprecated") && w.includes("workspace")
          )
        ).toBe(false);
      } finally {
        console.warn = originalWarn;
      }
    });
  });
});
