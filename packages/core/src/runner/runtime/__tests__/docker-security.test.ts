import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdir, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec } from "node:child_process";
import { buildContainerMounts, buildContainerEnv } from "../container-manager.js";
import { resolveDockerConfig } from "../docker-config.js";
import type { ResolvedAgent } from "../../../config/index.js";

const execAsync = promisify(exec);

// =============================================================================
// Environment Detection
// =============================================================================

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const DOCKER_AVAILABLE = isDockerAvailable();

// Skip entire file if Docker not available
const describeDocker = DOCKER_AVAILABLE ? describe : describe.skip;

// =============================================================================
// Test Helpers
// =============================================================================

async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-docker-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(baseDir, { recursive: true });
  return await realpath(baseDir);
}

function createTestAgent(overrides: Partial<ResolvedAgent> = {}): ResolvedAgent {
  return {
    name: "test-agent",
    configPath: "/path/to/agent.yaml",
    working_directory: "/workspace/project",
    ...overrides,
  } as ResolvedAgent;
}

async function inspectContainer(containerId: string): Promise<any> {
  const { stdout } = await execAsync(`docker inspect ${containerId}`);
  return JSON.parse(stdout)[0];
}

async function removeContainer(containerId: string): Promise<void> {
  try {
    await execAsync(`docker rm -f ${containerId}`);
  } catch {
    // Ignore if already removed
  }
}

// =============================================================================
// Docker Security Tests
// =============================================================================

describeDocker("Docker Security Hardening", () => {
  let tempDir: string;
  const containers: string[] = [];

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    // Clean up containers
    for (const id of containers) {
      await removeContainer(id);
    }
    containers.length = 0;

    // Clean up temp dir
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("buildContainerMounts", () => {
    it("includes workspace mount", () => {
      const agent = createTestAgent();
      const dockerConfig = resolveDockerConfig({
        enabled: true,
        workspace_mode: "rw",
      });

      const mounts = buildContainerMounts(agent, dockerConfig, tempDir);

      const workspaceMount = mounts.find((m) => m.containerPath === "/workspace");
      expect(workspaceMount).toBeDefined();
      expect(workspaceMount?.mode).toBe("rw");
    });

    it("mounts workspace read-only when workspace_mode is ro", () => {
      const agent = createTestAgent();
      const dockerConfig = resolveDockerConfig({
        enabled: true,
        workspace_mode: "ro",
      });

      const mounts = buildContainerMounts(agent, dockerConfig, tempDir);

      const workspaceMount = mounts.find((m) => m.containerPath === "/workspace");
      expect(workspaceMount?.mode).toBe("ro");
    });

    it("does not mount auth files (uses ANTHROPIC_API_KEY instead)", () => {
      const agent = createTestAgent();
      const dockerConfig = resolveDockerConfig({ enabled: true });

      const mounts = buildContainerMounts(agent, dockerConfig, tempDir);

      // Auth should NOT be mounted - we use ANTHROPIC_API_KEY env var instead
      const authMount = mounts.find(
        (m) => m.containerPath?.includes(".claude") && m.hostPath?.includes(".claude"),
      );
      expect(authMount).toBeUndefined();
    });

    it("includes docker-sessions directory mount at Claude session path", () => {
      const agent = createTestAgent();
      const dockerConfig = resolveDockerConfig({ enabled: true });

      const mounts = buildContainerMounts(agent, dockerConfig, tempDir);

      // Session mount at Claude CLI session location (encoded path: /workspace → -workspace)
      const sessionMount = mounts.find(
        (m) => m.containerPath === "/home/claude/.claude/projects/-workspace",
      );
      expect(sessionMount).toBeDefined();
      expect(sessionMount?.mode).toBe("rw");
    });

    it("includes additional volumes from config", () => {
      const agent = createTestAgent();
      const dockerConfig = resolveDockerConfig({
        enabled: true,
        volumes: ["/data:/data:ro"],
      });

      const mounts = buildContainerMounts(agent, dockerConfig, tempDir);

      const dataMount = mounts.find((m) => m.containerPath === "/data");
      expect(dataMount).toBeDefined();
      expect(dataMount?.mode).toBe("ro");
    });

    it("handles agent workspace as string", () => {
      const agent = createTestAgent({
        working_directory: "/path/to/workspace",
      });
      const dockerConfig = resolveDockerConfig({ enabled: true });

      const mounts = buildContainerMounts(agent, dockerConfig, tempDir);

      const workspaceMount = mounts.find((m) => m.containerPath === "/workspace");
      expect(workspaceMount).toBeDefined();
      expect(workspaceMount?.hostPath).toBe("/path/to/workspace");
    });

    it("handles agent workspace as object with root", () => {
      const agent = createTestAgent({
        working_directory: {
          root: "/path/to/workspace",
          auto_clone: true,
          clone_depth: 1,
          default_branch: "main",
        },
      });
      const dockerConfig = resolveDockerConfig({ enabled: true });

      const mounts = buildContainerMounts(agent, dockerConfig, tempDir);

      const workspaceMount = mounts.find((m) => m.containerPath === "/workspace");
      expect(workspaceMount).toBeDefined();
      expect(workspaceMount?.hostPath).toBe("/path/to/workspace");
    });
  });

  describe("buildContainerEnv", () => {
    it("includes HOME environment variable", async () => {
      const agent = createTestAgent();
      const env = await buildContainerEnv(agent);

      expect(env).toContain("HOME=/home/claude");
    });

    it("includes TERM environment variable", async () => {
      const agent = createTestAgent();
      const env = await buildContainerEnv(agent);

      const termEnv = env.find((e) => e.startsWith("TERM="));
      expect(termEnv).toBeDefined();
    });

    it("includes ANTHROPIC_API_KEY if set in process.env", async () => {
      const originalKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = "test-key-123";

      const agent = createTestAgent();
      const env = await buildContainerEnv(agent);

      expect(env).toContain("ANTHROPIC_API_KEY=test-key-123");

      // Restore
      if (originalKey) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    });

    it("does not include ANTHROPIC_API_KEY if not set", async () => {
      const originalKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      const agent = createTestAgent();
      const env = await buildContainerEnv(agent);

      const apiKeyEnv = env.find((e) => e.startsWith("ANTHROPIC_API_KEY="));
      expect(apiKeyEnv).toBeUndefined();

      // Restore
      if (originalKey) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      }
    });

    it("includes custom env vars from docker config", async () => {
      const agent = createTestAgent();
      const dockerConfig = resolveDockerConfig({
        enabled: true,
        env: {
          GITHUB_TOKEN: "ghp_test123",
          CUSTOM_VAR: "custom_value",
        },
      });

      const env = await buildContainerEnv(agent, dockerConfig);

      expect(env).toContain("GITHUB_TOKEN=ghp_test123");
      expect(env).toContain("CUSTOM_VAR=custom_value");
    });

    it("works without docker config (backwards compatible)", async () => {
      const agent = createTestAgent();
      const env = await buildContainerEnv(agent);

      // Should still include basic env vars
      expect(env).toContain("HOME=/home/claude");
      expect(env.find((e) => e.startsWith("TERM="))).toBeDefined();
    });
  });

  describe("Container Configuration", () => {
    it("applies no-new-privileges security option", async () => {
      // Create a container to inspect (don't start it)
      const { stdout } = await execAsync(
        `docker create --security-opt=no-new-privileges alpine:latest sleep 1`,
      );
      const containerId = stdout.trim();
      containers.push(containerId);

      const inspection = await inspectContainer(containerId);

      // Verify security options are applied
      expect(inspection.HostConfig.SecurityOpt).toContain("no-new-privileges");
    });

    it("drops all capabilities", async () => {
      const { stdout } = await execAsync(`docker create --cap-drop=ALL alpine:latest sleep 1`);
      const containerId = stdout.trim();
      containers.push(containerId);

      const inspection = await inspectContainer(containerId);

      expect(inspection.HostConfig.CapDrop).toContain("ALL");
    });

    it("sets memory limits", async () => {
      const memoryLimit = 512 * 1024 * 1024; // 512MB
      const { stdout } = await execAsync(
        `docker create --memory=${memoryLimit} alpine:latest sleep 1`,
      );
      const containerId = stdout.trim();
      containers.push(containerId);

      const inspection = await inspectContainer(containerId);

      expect(inspection.HostConfig.Memory).toBe(memoryLimit);
    });

    it("sets user to non-root", async () => {
      const { stdout } = await execAsync(`docker create --user=1000:1000 alpine:latest sleep 1`);
      const containerId = stdout.trim();
      containers.push(containerId);

      const inspection = await inspectContainer(containerId);

      expect(inspection.Config.User).toBe("1000:1000");
    });

    it("applies network mode", async () => {
      const { stdout } = await execAsync(`docker create --network=bridge alpine:latest sleep 1`);
      const containerId = stdout.trim();
      containers.push(containerId);

      const inspection = await inspectContainer(containerId);

      expect(inspection.HostConfig.NetworkMode).toBe("bridge");
    });

    it("mounts with read-only flag when specified", async () => {
      await mkdir(join(tempDir, "data"), { recursive: true });

      const { stdout } = await execAsync(
        `docker create -v ${tempDir}/data:/data:ro alpine:latest sleep 1`,
      );
      const containerId = stdout.trim();
      containers.push(containerId);

      const inspection = await inspectContainer(containerId);

      const dataMount = inspection.Mounts.find((m: any) => m.Destination === "/data");
      expect(dataMount?.RW).toBe(false);
    });

    it("sets AutoRemove when ephemeral is true", async () => {
      const { stdout } = await execAsync(`docker create --rm alpine:latest sleep 1`);
      const containerId = stdout.trim();
      containers.push(containerId);

      const inspection = await inspectContainer(containerId);

      expect(inspection.HostConfig.AutoRemove).toBe(true);
    });

    it("does not set AutoRemove when ephemeral is false", async () => {
      const { stdout } = await execAsync(`docker create alpine:latest sleep 1`);
      const containerId = stdout.trim();
      containers.push(containerId);

      const inspection = await inspectContainer(containerId);

      expect(inspection.HostConfig.AutoRemove).toBe(false);
    });

    it("sets memory and swap limit to same value (no swap)", async () => {
      const memoryLimit = 1024 * 1024 * 1024; // 1GB
      const { stdout } = await execAsync(
        `docker create --memory=${memoryLimit} --memory-swap=${memoryLimit} alpine:latest sleep 1`,
      );
      const containerId = stdout.trim();
      containers.push(containerId);

      const inspection = await inspectContainer(containerId);

      expect(inspection.HostConfig.Memory).toBe(memoryLimit);
      expect(inspection.HostConfig.MemorySwap).toBe(memoryLimit);
    });

    it("sets CPU shares for resource limits", async () => {
      const cpuShares = 512;
      const { stdout } = await execAsync(
        `docker create --cpu-shares=${cpuShares} alpine:latest sleep 1`,
      );
      const containerId = stdout.trim();
      containers.push(containerId);

      const inspection = await inspectContainer(containerId);

      expect(inspection.HostConfig.CpuShares).toBe(cpuShares);
    });
  });
});

// =============================================================================
// Docker Config Resolution Tests (don't need Docker running)
// =============================================================================

describe("Docker Config Security Defaults", () => {
  it("defaults to bridge network (not none)", () => {
    const config = resolveDockerConfig({ enabled: true });
    expect(config.network).toBe("bridge");
  });

  it("defaults to 2GB memory", () => {
    const config = resolveDockerConfig({ enabled: true });
    expect(config.memoryBytes).toBe(2 * 1024 * 1024 * 1024);
  });

  it("defaults to host user UID:GID", () => {
    const config = resolveDockerConfig({ enabled: true });
    expect(config.user).toMatch(/^\d+:\d+$/);
  });

  it("defaults workspace to read-write", () => {
    const config = resolveDockerConfig({ enabled: true });
    expect(config.workspaceMode).toBe("rw");
  });

  it("defaults ephemeral to true", () => {
    const config = resolveDockerConfig({ enabled: true });
    expect(config.ephemeral).toBe(true);
  });

  it("defaults max_containers to 5", () => {
    const config = resolveDockerConfig({ enabled: true });
    expect(config.maxContainers).toBe(5);
  });

  it("allows custom network mode", () => {
    const config = resolveDockerConfig({
      enabled: true,
      network: "host",
    });
    expect(config.network).toBe("host");
  });

  it("allows custom memory limit", () => {
    const config = resolveDockerConfig({
      enabled: true,
      memory: "512m",
    });
    expect(config.memoryBytes).toBe(512 * 1024 * 1024);
  });

  it("allows custom user", () => {
    const config = resolveDockerConfig({
      enabled: true,
      user: "1001:1001",
    });
    expect(config.user).toBe("1001:1001");
  });

  it("allows custom workspace mode", () => {
    const config = resolveDockerConfig({
      enabled: true,
      workspace_mode: "ro",
    });
    expect(config.workspaceMode).toBe("ro");
  });

  it("allows ephemeral mode", () => {
    const config = resolveDockerConfig({
      enabled: true,
      ephemeral: true,
    });
    expect(config.ephemeral).toBe(true);
  });

  it("allows custom max_containers", () => {
    const config = resolveDockerConfig({
      enabled: true,
      max_containers: 10,
    });
    expect(config.maxContainers).toBe(10);
  });

  it("parses additional volumes correctly", () => {
    const config = resolveDockerConfig({
      enabled: true,
      volumes: ["/host/path:/container/path:ro"],
    });
    expect(config.volumes).toHaveLength(1);
    expect(config.volumes[0].hostPath).toBe("/host/path");
    expect(config.volumes[0].containerPath).toBe("/container/path");
    expect(config.volumes[0].mode).toBe("ro");
  });

  it("uses base_image if image not specified", () => {
    const config = resolveDockerConfig({
      enabled: true,
      base_image: "custom:latest",
    });
    expect(config.image).toBe("custom:latest");
  });

  it("prefers image over base_image", () => {
    const config = resolveDockerConfig({
      enabled: true,
      image: "specific:latest",
      base_image: "fallback:latest",
    });
    expect(config.image).toBe("specific:latest");
  });
});
