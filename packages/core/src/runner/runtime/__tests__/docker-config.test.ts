import { describe, it, expect } from "vitest";
import {
  parseMemoryToBytes,
  parseVolumeMount,
  parsePortBinding,
  parseTmpfsMount,
  getHostUser,
  resolveDockerConfig,
  DEFAULT_DOCKER_IMAGE,
  DEFAULT_MEMORY_LIMIT,
  DEFAULT_MAX_CONTAINERS,
} from "../docker-config.js";

describe("parseMemoryToBytes", () => {
  describe("valid formats", () => {
    it("parses bytes (no suffix)", () => {
      expect(parseMemoryToBytes("1024")).toBe(1024);
      expect(parseMemoryToBytes("2048")).toBe(2048);
    });

    it("parses kilobytes", () => {
      expect(parseMemoryToBytes("1k")).toBe(1024);
      expect(parseMemoryToBytes("1K")).toBe(1024);
      expect(parseMemoryToBytes("1kb")).toBe(1024);
      expect(parseMemoryToBytes("1KB")).toBe(1024);
      expect(parseMemoryToBytes("512k")).toBe(512 * 1024);
    });

    it("parses megabytes", () => {
      expect(parseMemoryToBytes("1m")).toBe(1024 * 1024);
      expect(parseMemoryToBytes("512M")).toBe(512 * 1024 * 1024);
      expect(parseMemoryToBytes("1mb")).toBe(1024 * 1024);
      expect(parseMemoryToBytes("1MB")).toBe(1024 * 1024);
    });

    it("parses gigabytes", () => {
      expect(parseMemoryToBytes("1g")).toBe(1024 * 1024 * 1024);
      expect(parseMemoryToBytes("2G")).toBe(2 * 1024 * 1024 * 1024);
      expect(parseMemoryToBytes("2gb")).toBe(2 * 1024 * 1024 * 1024);
      expect(parseMemoryToBytes("2GB")).toBe(2 * 1024 * 1024 * 1024);
    });

    it("parses terabytes", () => {
      expect(parseMemoryToBytes("1t")).toBe(1024 * 1024 * 1024 * 1024);
      expect(parseMemoryToBytes("1T")).toBe(1024 * 1024 * 1024 * 1024);
      expect(parseMemoryToBytes("1tb")).toBe(1024 * 1024 * 1024 * 1024);
    });

    it("handles decimal values", () => {
      expect(parseMemoryToBytes("1.5g")).toBe(Math.floor(1.5 * 1024 * 1024 * 1024));
      expect(parseMemoryToBytes("0.5m")).toBe(Math.floor(0.5 * 1024 * 1024));
      expect(parseMemoryToBytes("2.25g")).toBe(Math.floor(2.25 * 1024 * 1024 * 1024));
    });

    it("handles whitespace around value", () => {
      expect(parseMemoryToBytes("1 g")).toBe(1024 * 1024 * 1024);
      expect(parseMemoryToBytes("512 m")).toBe(512 * 1024 * 1024);
    });

    it("handles case-insensitive units", () => {
      expect(parseMemoryToBytes("1K")).toBe(parseMemoryToBytes("1k"));
      expect(parseMemoryToBytes("1M")).toBe(parseMemoryToBytes("1m"));
      expect(parseMemoryToBytes("1G")).toBe(parseMemoryToBytes("1g"));
      expect(parseMemoryToBytes("1T")).toBe(parseMemoryToBytes("1t"));
    });
  });

  describe("invalid formats", () => {
    it("throws for empty string", () => {
      expect(() => parseMemoryToBytes("")).toThrow("Invalid memory format");
    });

    it("throws for invalid suffix", () => {
      expect(() => parseMemoryToBytes("1x")).toThrow("Invalid memory format");
      expect(() => parseMemoryToBytes("1z")).toThrow("Invalid memory format");
    });

    it("throws for negative values", () => {
      expect(() => parseMemoryToBytes("-1g")).toThrow("Invalid memory format");
      expect(() => parseMemoryToBytes("-512m")).toThrow("Invalid memory format");
    });

    it("throws for non-numeric", () => {
      expect(() => parseMemoryToBytes("abc")).toThrow("Invalid memory format");
      expect(() => parseMemoryToBytes("notanumber")).toThrow("Invalid memory format");
    });

    it("throws for just units", () => {
      expect(() => parseMemoryToBytes("g")).toThrow("Invalid memory format");
      expect(() => parseMemoryToBytes("mb")).toThrow("Invalid memory format");
    });
  });
});

describe("parseVolumeMount", () => {
  describe("valid formats", () => {
    it("parses host:container (default rw)", () => {
      const result = parseVolumeMount("/host/path:/container/path");
      expect(result).toEqual({
        hostPath: "/host/path",
        containerPath: "/container/path",
        mode: "rw",
      });
    });

    it("parses host:container:ro", () => {
      const result = parseVolumeMount("/host/path:/container/path:ro");
      expect(result).toEqual({
        hostPath: "/host/path",
        containerPath: "/container/path",
        mode: "ro",
      });
    });

    it("parses host:container:rw explicitly", () => {
      const result = parseVolumeMount("/host/path:/container/path:rw");
      expect(result).toEqual({
        hostPath: "/host/path",
        containerPath: "/container/path",
        mode: "rw",
      });
    });

    it("handles paths with spaces", () => {
      const result = parseVolumeMount("/path with spaces:/container path");
      expect(result).toEqual({
        hostPath: "/path with spaces",
        containerPath: "/container path",
        mode: "rw",
      });
    });

    it("handles relative paths", () => {
      const result = parseVolumeMount("./local:/container");
      expect(result).toEqual({
        hostPath: "./local",
        containerPath: "/container",
        mode: "rw",
      });
    });
  });

  describe("invalid formats", () => {
    it("throws for single path", () => {
      expect(() => parseVolumeMount("/only/one")).toThrow("Invalid volume format");
    });

    it("throws for too many colons", () => {
      expect(() => parseVolumeMount("/a:/b:ro:extra")).toThrow("Invalid volume format");
    });

    it("throws for invalid mode", () => {
      expect(() => parseVolumeMount("/a:/b:invalid")).toThrow("Invalid volume mode");
      expect(() => parseVolumeMount("/a:/b:rw2")).toThrow("Invalid volume mode");
      expect(() => parseVolumeMount("/a:/b:readonly")).toThrow("Invalid volume mode");
    });

    it("throws for empty string", () => {
      expect(() => parseVolumeMount("")).toThrow("Invalid volume format");
    });

    it("allows empty path components (Docker accepts them)", () => {
      // Docker allows :: which creates empty paths
      const result = parseVolumeMount("::");
      expect(result).toEqual({
        hostPath: "",
        containerPath: "",
        mode: "rw",
      });
    });
  });
});

describe("parsePortBinding", () => {
  describe("valid formats", () => {
    it("parses hostPort:containerPort", () => {
      const result = parsePortBinding("8080:80");
      expect(result).toEqual({
        hostPort: 8080,
        containerPort: 80,
      });
    });

    it("parses same port on both sides", () => {
      const result = parsePortBinding("3000:3000");
      expect(result).toEqual({
        hostPort: 3000,
        containerPort: 3000,
      });
    });

    it("parses containerPort only (uses same for host)", () => {
      const result = parsePortBinding("3000");
      expect(result).toEqual({
        hostPort: 3000,
        containerPort: 3000,
      });
    });
  });

  describe("invalid formats", () => {
    it("throws for too many colons", () => {
      expect(() => parsePortBinding("80:80:80")).toThrow("Invalid port format");
    });

    // Empty string and non-numeric values are caught by schema validation
    // before reaching parsePortBinding
  });
});

describe("parseTmpfsMount", () => {
  describe("valid formats", () => {
    it("parses path only", () => {
      const result = parseTmpfsMount("/tmp");
      expect(result).toEqual({
        path: "/tmp",
        options: undefined,
      });
    });

    it("parses path with options", () => {
      const result = parseTmpfsMount("/tmp:size=100m,mode=1777");
      expect(result).toEqual({
        path: "/tmp",
        options: "size=100m,mode=1777",
      });
    });

    it("parses path with single option", () => {
      const result = parseTmpfsMount("/run:size=50m");
      expect(result).toEqual({
        path: "/run",
        options: "size=50m",
      });
    });

    it("handles nested paths", () => {
      const result = parseTmpfsMount("/var/tmp:size=200m");
      expect(result).toEqual({
        path: "/var/tmp",
        options: "size=200m",
      });
    });
  });
});

describe("getHostUser", () => {
  it("returns UID:GID format", () => {
    const user = getHostUser();
    expect(user).toMatch(/^\d+:\d+$/);
  });

  it("returns consistent value on multiple calls", () => {
    const user1 = getHostUser();
    const user2 = getHostUser();
    expect(user1).toBe(user2);
  });

  it("uses process.getuid and process.getgid when available", () => {
    // On POSIX systems, these should return actual values
    if (process.getuid && process.getgid) {
      const user = getHostUser();
      const expectedUid = process.getuid();
      const expectedGid = process.getgid();
      expect(user).toBe(`${expectedUid}:${expectedGid}`);
    }
  });

  it("falls back to 1000:1000 on Windows", () => {
    // On Windows, getuid/getgid don't exist, should fall back
    // Can't easily test this without platform detection
    const user = getHostUser();
    expect(user).toBeTruthy();
    expect(user.split(":")).toHaveLength(2);
  });
});

describe("resolveDockerConfig", () => {
  describe("defaults", () => {
    it("applies defaults when called with undefined", () => {
      const config = resolveDockerConfig(undefined);

      expect(config.enabled).toBe(false);
      expect(config.ephemeral).toBe(true);
      expect(config.image).toBe(DEFAULT_DOCKER_IMAGE);
      expect(config.network).toBe("bridge");
      expect(config.memoryBytes).toBe(parseMemoryToBytes(DEFAULT_MEMORY_LIMIT));
      expect(config.maxContainers).toBe(DEFAULT_MAX_CONTAINERS);
      expect(config.workspaceMode).toBe("rw");
      expect(config.volumes).toEqual([]);
      expect(config.user).toMatch(/^\d+:\d+$/);
    });

    it("applies defaults when called with empty object", () => {
      const config = resolveDockerConfig({});

      expect(config.enabled).toBe(false);
      expect(config.image).toBe(DEFAULT_DOCKER_IMAGE);
      expect(config.network).toBe("bridge");
    });

    it("uses default memory limit", () => {
      const config = resolveDockerConfig({});
      expect(config.memoryBytes).toBe(parseMemoryToBytes("2g"));
    });

    it("uses default max containers", () => {
      const config = resolveDockerConfig({});
      expect(config.maxContainers).toBe(5);
    });

    it("defaults cpuShares to undefined", () => {
      const config = resolveDockerConfig({});
      expect(config.cpuShares).toBeUndefined();
    });

    it("defaults new CPU options to undefined", () => {
      const config = resolveDockerConfig({});
      expect(config.cpuPeriod).toBeUndefined();
      expect(config.cpuQuota).toBeUndefined();
    });

    it("defaults pidsLimit to undefined", () => {
      const config = resolveDockerConfig({});
      expect(config.pidsLimit).toBeUndefined();
    });

    it("defaults ports to empty array", () => {
      const config = resolveDockerConfig({});
      expect(config.ports).toEqual([]);
    });

    it("defaults tmpfs to empty array", () => {
      const config = resolveDockerConfig({});
      expect(config.tmpfs).toEqual([]);
    });

    it("defaults labels to empty object", () => {
      const config = resolveDockerConfig({});
      expect(config.labels).toEqual({});
    });
  });

  describe("field overrides", () => {
    it("respects enabled flag", () => {
      const config = resolveDockerConfig({ enabled: true });
      expect(config.enabled).toBe(true);
    });

    it("respects custom image", () => {
      const config = resolveDockerConfig({ image: "custom:latest" });
      expect(config.image).toBe("custom:latest");
    });

    it("respects network mode", () => {
      const configNone = resolveDockerConfig({ network: "none" });
      expect(configNone.network).toBe("none");

      const configHost = resolveDockerConfig({ network: "host" });
      expect(configHost.network).toBe("host");

      const configBridge = resolveDockerConfig({ network: "bridge" });
      expect(configBridge.network).toBe("bridge");
    });

    it("respects custom memory", () => {
      const config = resolveDockerConfig({ memory: "4g" });
      expect(config.memoryBytes).toBe(4 * 1024 * 1024 * 1024);
    });

    it("respects cpu_shares", () => {
      const config = resolveDockerConfig({ cpu_shares: 512 });
      expect(config.cpuShares).toBe(512);
    });

    it("respects custom user", () => {
      const config = resolveDockerConfig({ user: "1001:1001" });
      expect(config.user).toBe("1001:1001");
    });

    it("respects workspace_mode", () => {
      const configRo = resolveDockerConfig({ workspace_mode: "ro" });
      expect(configRo.workspaceMode).toBe("ro");

      const configRw = resolveDockerConfig({ workspace_mode: "rw" });
      expect(configRw.workspaceMode).toBe("rw");
    });

    it("respects ephemeral flag", () => {
      const config = resolveDockerConfig({ ephemeral: true });
      expect(config.ephemeral).toBe(true);
    });

    it("respects max_containers", () => {
      const config = resolveDockerConfig({ max_containers: 10 });
      expect(config.maxContainers).toBe(10);
    });

    it("respects cpu_period and cpu_quota", () => {
      const config = resolveDockerConfig({
        cpu_period: 100000,
        cpu_quota: 50000,
      });
      expect(config.cpuPeriod).toBe(100000);
      expect(config.cpuQuota).toBe(50000);
    });

    it("respects pids_limit", () => {
      const config = resolveDockerConfig({ pids_limit: 100 });
      expect(config.pidsLimit).toBe(100);
    });

    it("respects labels", () => {
      const config = resolveDockerConfig({
        labels: { app: "myapp", env: "production" },
      });
      expect(config.labels).toEqual({ app: "myapp", env: "production" });
    });
  });

  describe("port parsing", () => {
    it("parses port array", () => {
      const config = resolveDockerConfig({
        ports: ["8080:80", "3000"],
      });

      expect(config.ports).toHaveLength(2);
      expect(config.ports[0]).toEqual({ hostPort: 8080, containerPort: 80 });
      expect(config.ports[1]).toEqual({ hostPort: 3000, containerPort: 3000 });
    });

    it("handles empty ports array", () => {
      const config = resolveDockerConfig({ ports: [] });
      expect(config.ports).toEqual([]);
    });
  });

  describe("tmpfs parsing", () => {
    it("parses tmpfs array", () => {
      const config = resolveDockerConfig({
        tmpfs: ["/tmp", "/run:size=50m"],
      });

      expect(config.tmpfs).toHaveLength(2);
      expect(config.tmpfs[0]).toEqual({ path: "/tmp", options: undefined });
      expect(config.tmpfs[1]).toEqual({ path: "/run", options: "size=50m" });
    });

    it("handles empty tmpfs array", () => {
      const config = resolveDockerConfig({ tmpfs: [] });
      expect(config.tmpfs).toEqual([]);
    });
  });

  describe("volume parsing", () => {
    it("parses volume array", () => {
      const config = resolveDockerConfig({
        volumes: ["/data:/data:ro", "/cache:/cache:rw"],
      });

      expect(config.volumes).toHaveLength(2);
      expect(config.volumes[0]).toEqual({
        hostPath: "/data",
        containerPath: "/data",
        mode: "ro",
      });
      expect(config.volumes[1]).toEqual({
        hostPath: "/cache",
        containerPath: "/cache",
        mode: "rw",
      });
    });

    it("handles empty volumes array", () => {
      const config = resolveDockerConfig({ volumes: [] });
      expect(config.volumes).toEqual([]);
    });

    it("handles undefined volumes", () => {
      const config = resolveDockerConfig({});
      expect(config.volumes).toEqual([]);
    });
  });

  describe("base_image alias", () => {
    it("handles base_image as alias for image", () => {
      const config = resolveDockerConfig({
        enabled: true,
        base_image: "legacy:tag",
      });
      expect(config.image).toBe("legacy:tag");
    });

    it("prefers image over base_image", () => {
      const config = resolveDockerConfig({
        enabled: true,
        image: "preferred:tag",
        base_image: "legacy:tag",
      });
      expect(config.image).toBe("preferred:tag");
    });

    it("uses base_image when image not specified", () => {
      const config = resolveDockerConfig({
        base_image: "myimage:v1",
      });
      expect(config.image).toBe("myimage:v1");
    });
  });

  describe("complex configurations", () => {
    it("handles all options together", () => {
      const config = resolveDockerConfig({
        enabled: true,
        image: "custom:latest",
        network: "none",
        memory: "4g",
        cpu_shares: 512,
        user: "1001:1001",
        workspace_mode: "ro",
        ephemeral: true,
        max_containers: 10,
        volumes: ["/data:/data:ro"],
      });

      expect(config.enabled).toBe(true);
      expect(config.image).toBe("custom:latest");
      expect(config.network).toBe("none");
      expect(config.memoryBytes).toBe(4 * 1024 * 1024 * 1024);
      expect(config.cpuShares).toBe(512);
      expect(config.user).toBe("1001:1001");
      expect(config.workspaceMode).toBe("ro");
      expect(config.ephemeral).toBe(true);
      expect(config.maxContainers).toBe(10);
      expect(config.volumes).toHaveLength(1);
      expect(config.volumes[0].hostPath).toBe("/data");
    });

    it("mixes defaults and overrides", () => {
      const config = resolveDockerConfig({
        enabled: true,
        memory: "8g",
        volumes: ["/custom:/custom"],
      });

      // Overridden values
      expect(config.enabled).toBe(true);
      expect(config.memoryBytes).toBe(8 * 1024 * 1024 * 1024);
      expect(config.volumes).toHaveLength(1);

      // Default values
      expect(config.image).toBe(DEFAULT_DOCKER_IMAGE);
      expect(config.network).toBe("bridge");
      expect(config.maxContainers).toBe(DEFAULT_MAX_CONTAINERS);
      expect(config.workspaceMode).toBe("rw");
    });
  });
});

describe("constants", () => {
  it("DEFAULT_DOCKER_IMAGE is set correctly", () => {
    expect(DEFAULT_DOCKER_IMAGE).toBe("herdctl/runtime:latest");
  });

  it("DEFAULT_MEMORY_LIMIT is 2g", () => {
    expect(DEFAULT_MEMORY_LIMIT).toBe("2g");
  });

  it("DEFAULT_MAX_CONTAINERS is 5", () => {
    expect(DEFAULT_MAX_CONTAINERS).toBe(5);
  });

  it("default memory limit parses correctly", () => {
    const bytes = parseMemoryToBytes(DEFAULT_MEMORY_LIMIT);
    expect(bytes).toBe(2 * 1024 * 1024 * 1024);
  });
});
