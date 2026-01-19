import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdir,
  rm,
  realpath,
  readFile,
  writeFile,
  chmod,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";
import { parse as parseYaml } from "yaml";

import {
  initStateDirectory,
  getStateDirectory,
  validateStateDirectory,
} from "../directory.js";
import {
  StateDirectoryCreateError,
  StateDirectoryValidationError,
  StateFileError,
  StateError,
  getPermissionErrorMessage,
} from "../errors.js";
import {
  DEFAULT_STATE_DIR_NAME,
  STATE_FILE_NAME,
  STATE_SUBDIRECTORIES,
} from "../types.js";

// Helper to create a temp directory
async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(baseDir, { recursive: true });
  // Resolve to real path to handle macOS /var -> /private/var symlink
  return await realpath(baseDir);
}

// Helper to check if a path is a directory
async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

// Helper to check if a path exists
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("getStateDirectory", () => {
  it("returns paths with default state directory name when no path provided", () => {
    const stateDir = getStateDirectory();

    expect(stateDir.root).toContain(DEFAULT_STATE_DIR_NAME);
    expect(stateDir.jobs).toBe(join(stateDir.root, "jobs"));
    expect(stateDir.sessions).toBe(join(stateDir.root, "sessions"));
    expect(stateDir.logs).toBe(join(stateDir.root, "logs"));
    expect(stateDir.stateFile).toBe(join(stateDir.root, STATE_FILE_NAME));
  });

  it("returns paths relative to provided path", () => {
    const customPath = "/custom/path/.herdctl";
    const stateDir = getStateDirectory(customPath);

    expect(stateDir.root).toBe(customPath);
    expect(stateDir.jobs).toBe(join(customPath, "jobs"));
    expect(stateDir.sessions).toBe(join(customPath, "sessions"));
    expect(stateDir.logs).toBe(join(customPath, "logs"));
    expect(stateDir.stateFile).toBe(join(customPath, STATE_FILE_NAME));
  });

  it("resolves relative paths to absolute", () => {
    const relativePath = "./my-state-dir";
    const stateDir = getStateDirectory(relativePath);

    // Should be resolved to absolute path
    expect(stateDir.root).not.toBe(relativePath);
    expect(stateDir.root).toContain("my-state-dir");
  });

  it("includes all expected subdirectories", () => {
    const stateDir = getStateDirectory("/test/.herdctl");

    for (const subdir of STATE_SUBDIRECTORIES) {
      expect(stateDir[subdir]).toBeDefined();
      expect(stateDir[subdir]).toContain(subdir);
    }
  });
});

describe("initStateDirectory", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates .herdctl directory in specified path", async () => {
    const stateDirPath = join(tempDir, ".herdctl");

    const stateDir = await initStateDirectory({ path: stateDirPath });

    expect(stateDir.root).toBe(stateDirPath);
    expect(await isDirectory(stateDirPath)).toBe(true);
  });

  it("creates jobs subdirectory", async () => {
    const stateDirPath = join(tempDir, ".herdctl");

    const stateDir = await initStateDirectory({ path: stateDirPath });

    expect(await isDirectory(stateDir.jobs)).toBe(true);
  });

  it("creates sessions subdirectory", async () => {
    const stateDirPath = join(tempDir, ".herdctl");

    const stateDir = await initStateDirectory({ path: stateDirPath });

    expect(await isDirectory(stateDir.sessions)).toBe(true);
  });

  it("creates logs subdirectory", async () => {
    const stateDirPath = join(tempDir, ".herdctl");

    const stateDir = await initStateDirectory({ path: stateDirPath });

    expect(await isDirectory(stateDir.logs)).toBe(true);
  });

  it("creates state.yaml with initial empty state", async () => {
    const stateDirPath = join(tempDir, ".herdctl");

    const stateDir = await initStateDirectory({ path: stateDirPath });

    expect(await pathExists(stateDir.stateFile)).toBe(true);

    const content = await readFile(stateDir.stateFile, "utf-8");
    const parsed = parseYaml(content);

    expect(parsed).toHaveProperty("fleet");
    expect(parsed).toHaveProperty("agents");
    expect(parsed.agents).toEqual({});
  });

  it("returns StateDirectory object with all paths", async () => {
    const stateDirPath = join(tempDir, ".herdctl");

    const stateDir = await initStateDirectory({ path: stateDirPath });

    expect(stateDir).toEqual({
      root: stateDirPath,
      jobs: join(stateDirPath, "jobs"),
      sessions: join(stateDirPath, "sessions"),
      logs: join(stateDirPath, "logs"),
      stateFile: join(stateDirPath, STATE_FILE_NAME),
    });
  });

  it("is idempotent - can be called multiple times safely", async () => {
    const stateDirPath = join(tempDir, ".herdctl");

    const stateDir1 = await initStateDirectory({ path: stateDirPath });
    const stateDir2 = await initStateDirectory({ path: stateDirPath });

    expect(stateDir1).toEqual(stateDir2);
    expect(await isDirectory(stateDirPath)).toBe(true);
  });

  it("preserves existing state.yaml content", async () => {
    const stateDirPath = join(tempDir, ".herdctl");

    // First init creates the file
    await initStateDirectory({ path: stateDirPath });

    // Modify the state file
    const stateFilePath = join(stateDirPath, STATE_FILE_NAME);
    const modifiedState = {
      fleet: { started_at: "2024-01-01T00:00:00Z" },
      agents: {
        "test-agent": {
          status: "idle",
          last_job: "job-123",
        },
      },
    };
    await writeFile(stateFilePath, `fleet:\n  started_at: "2024-01-01T00:00:00Z"\nagents:\n  test-agent:\n    status: idle\n    last_job: job-123\n`, "utf-8");

    // Second init should preserve content
    await initStateDirectory({ path: stateDirPath });

    const content = await readFile(stateFilePath, "utf-8");
    const parsed = parseYaml(content);

    expect(parsed.fleet.started_at).toBe("2024-01-01T00:00:00Z");
    expect(parsed.agents["test-agent"].last_job).toBe("job-123");
  });

  it("throws StateDirectoryCreateError when parent directory is not writable", async function () {
    // Skip on Windows - permission model differs
    if (platform() === "win32") {
      return;
    }

    const restrictedDir = join(tempDir, "restricted");
    await mkdir(restrictedDir);
    await chmod(restrictedDir, 0o444); // Read-only

    const stateDirPath = join(restrictedDir, ".herdctl");

    try {
      await expect(initStateDirectory({ path: stateDirPath })).rejects.toThrow(
        StateDirectoryCreateError
      );
    } finally {
      // Restore permissions for cleanup
      await chmod(restrictedDir, 0o755);
    }
  });

  it("throws StateFileError when state.yaml has invalid schema", async () => {
    const stateDirPath = join(tempDir, ".herdctl");

    // Create the directory structure manually
    await mkdir(stateDirPath, { recursive: true });
    await mkdir(join(stateDirPath, "jobs"));
    await mkdir(join(stateDirPath, "sessions"));
    await mkdir(join(stateDirPath, "logs"));

    // Create invalid state.yaml
    const stateFilePath = join(stateDirPath, STATE_FILE_NAME);
    await writeFile(stateFilePath, "agents:\n  test-agent:\n    status: invalid-status\n", "utf-8");

    await expect(initStateDirectory({ path: stateDirPath })).rejects.toThrow(
      StateFileError
    );
  });

  it("throws StateFileError when state.yaml is not valid YAML", async () => {
    const stateDirPath = join(tempDir, ".herdctl");

    // Create the directory structure manually
    await mkdir(stateDirPath, { recursive: true });
    await mkdir(join(stateDirPath, "jobs"));
    await mkdir(join(stateDirPath, "sessions"));
    await mkdir(join(stateDirPath, "logs"));

    // Create malformed YAML
    const stateFilePath = join(stateDirPath, STATE_FILE_NAME);
    await writeFile(stateFilePath, "invalid: yaml: content: [", "utf-8");

    await expect(initStateDirectory({ path: stateDirPath })).rejects.toThrow(
      StateFileError
    );
  });

  it("creates nested directory structure", async () => {
    const stateDirPath = join(tempDir, "deep", "nested", "path", ".herdctl");

    const stateDir = await initStateDirectory({ path: stateDirPath });

    expect(await isDirectory(stateDir.root)).toBe(true);
    expect(await isDirectory(stateDir.jobs)).toBe(true);
    expect(await isDirectory(stateDir.sessions)).toBe(true);
    expect(await isDirectory(stateDir.logs)).toBe(true);
  });
});

describe("validateStateDirectory", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns valid for complete directory structure", async () => {
    const stateDirPath = join(tempDir, ".herdctl");
    const stateDir = await initStateDirectory({ path: stateDirPath });

    const validation = await validateStateDirectory(stateDir);

    expect(validation.valid).toBe(true);
    expect(validation.missing).toHaveLength(0);
    expect(validation.errors).toHaveLength(0);
  });

  it("returns invalid when root directory is missing", async () => {
    const stateDir = getStateDirectory(join(tempDir, "nonexistent", ".herdctl"));

    const validation = await validateStateDirectory(stateDir);

    expect(validation.valid).toBe(false);
    expect(validation.missing).toContain(stateDir.root);
  });

  it("returns invalid when subdirectory is missing", async () => {
    const stateDirPath = join(tempDir, ".herdctl");
    await initStateDirectory({ path: stateDirPath });

    // Remove the jobs directory
    await rm(join(stateDirPath, "jobs"), { recursive: true });

    const stateDir = getStateDirectory(stateDirPath);
    const validation = await validateStateDirectory(stateDir);

    expect(validation.valid).toBe(false);
    expect(validation.missing).toContain(stateDir.jobs);
  });

  it("returns invalid when state.yaml is missing", async () => {
    const stateDirPath = join(tempDir, ".herdctl");
    await initStateDirectory({ path: stateDirPath });

    // Remove the state file
    await rm(join(stateDirPath, STATE_FILE_NAME));

    const stateDir = getStateDirectory(stateDirPath);
    const validation = await validateStateDirectory(stateDir);

    expect(validation.valid).toBe(false);
    expect(validation.missing).toContain(stateDir.stateFile);
  });

  it("reports error when expected directory is a file", async () => {
    const stateDirPath = join(tempDir, ".herdctl");
    await initStateDirectory({ path: stateDirPath });

    // Replace jobs directory with a file
    await rm(join(stateDirPath, "jobs"), { recursive: true });
    await writeFile(join(stateDirPath, "jobs"), "not a directory", "utf-8");

    const stateDir = getStateDirectory(stateDirPath);
    const validation = await validateStateDirectory(stateDir);

    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("jobs"))).toBe(true);
  });

  it("detects multiple missing paths", async () => {
    const stateDirPath = join(tempDir, ".herdctl");
    await initStateDirectory({ path: stateDirPath });

    // Remove multiple items
    await rm(join(stateDirPath, "jobs"), { recursive: true });
    await rm(join(stateDirPath, "sessions"), { recursive: true });

    const stateDir = getStateDirectory(stateDirPath);
    const validation = await validateStateDirectory(stateDir);

    expect(validation.valid).toBe(false);
    expect(validation.missing).toContain(stateDir.jobs);
    expect(validation.missing).toContain(stateDir.sessions);
  });
});

describe("error classes", () => {
  it("StateError base class has correct name", () => {
    const error = new StateError("Test error");

    expect(error.name).toBe("StateError");
    expect(error.message).toBe("Test error");
  });

  it("StateDirectoryCreateError has correct properties", () => {
    const cause = new Error("Original error") as NodeJS.ErrnoException;
    cause.code = "EACCES";

    const error = new StateDirectoryCreateError(
      "Failed to create directory",
      "/path/to/dir",
      cause
    );

    expect(error.name).toBe("StateDirectoryCreateError");
    expect(error.message).toBe("Failed to create directory");
    expect(error.path).toBe("/path/to/dir");
    expect(error.code).toBe("EACCES");
    expect(error.cause).toBe(cause);
  });

  it("StateDirectoryCreateError works without cause", () => {
    const error = new StateDirectoryCreateError(
      "Failed to create directory",
      "/path/to/dir"
    );

    expect(error.name).toBe("StateDirectoryCreateError");
    expect(error.code).toBeUndefined();
    expect(error.cause).toBeUndefined();
  });

  it("StateDirectoryValidationError has correct properties", () => {
    const missingPaths = ["/path/to/jobs", "/path/to/sessions"];
    const error = new StateDirectoryValidationError(
      "Validation failed",
      missingPaths
    );

    expect(error.name).toBe("StateDirectoryValidationError");
    expect(error.message).toBe("Validation failed");
    expect(error.missingPaths).toEqual(missingPaths);
  });

  it("StateFileError has correct properties for write operation", () => {
    const cause = new Error("Write failed");
    const error = new StateFileError(
      "Failed to write state file",
      "/path/to/state.yaml",
      "write",
      cause
    );

    expect(error.name).toBe("StateFileError");
    expect(error.message).toBe("Failed to write state file");
    expect(error.path).toBe("/path/to/state.yaml");
    expect(error.operation).toBe("write");
    expect(error.cause).toBe(cause);
  });

  it("StateFileError has correct properties for read operation", () => {
    const error = new StateFileError(
      "Failed to read state file",
      "/path/to/state.yaml",
      "read"
    );

    expect(error.name).toBe("StateFileError");
    expect(error.operation).toBe("read");
    expect(error.cause).toBeUndefined();
  });
});

describe("getPermissionErrorMessage", () => {
  it("returns descriptive message for EACCES", () => {
    const msg = getPermissionErrorMessage("EACCES", "/test/path");
    expect(msg).toContain("Permission denied");
    expect(msg).toContain("/test/path");
  });

  it("returns descriptive message for EPERM", () => {
    const msg = getPermissionErrorMessage("EPERM", "/test/path");
    expect(msg).toContain("Operation not permitted");
    expect(msg).toContain("/test/path");
  });

  it("returns descriptive message for EROFS", () => {
    const msg = getPermissionErrorMessage("EROFS", "/test/path");
    expect(msg).toContain("Read-only filesystem");
    expect(msg).toContain("/test/path");
  });

  it("returns descriptive message for ENOSPC", () => {
    const msg = getPermissionErrorMessage("ENOSPC", "/test/path");
    expect(msg).toContain("No space left");
    expect(msg).toContain("/test/path");
  });

  it("returns descriptive message for ENOENT", () => {
    const msg = getPermissionErrorMessage("ENOENT", "/test/path");
    expect(msg).toContain("does not exist");
    expect(msg).toContain("/test/path");
  });

  it("returns descriptive message for ENOTDIR", () => {
    const msg = getPermissionErrorMessage("ENOTDIR", "/test/path");
    expect(msg).toContain("Not a directory");
    expect(msg).toContain("/test/path");
  });

  it("returns descriptive message for EEXIST", () => {
    const msg = getPermissionErrorMessage("EEXIST", "/test/path");
    expect(msg).toContain("already exists");
    expect(msg).toContain("/test/path");
  });

  it("returns generic message for unknown codes", () => {
    const msg = getPermissionErrorMessage("UNKNOWN", "/test/path");
    expect(msg).toContain("/test/path");
    expect(msg).toContain("UNKNOWN");
  });

  it("returns generic message when code is undefined", () => {
    const msg = getPermissionErrorMessage(undefined, "/test/path");
    expect(msg).toContain("/test/path");
    expect(msg).not.toContain("undefined");
  });
});

describe("state.yaml schema", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("accepts valid agent status values", async () => {
    const stateDirPath = join(tempDir, ".herdctl");
    await initStateDirectory({ path: stateDirPath });

    const stateFilePath = join(stateDirPath, STATE_FILE_NAME);

    // Test each valid status
    for (const status of ["idle", "running", "error"]) {
      await writeFile(
        stateFilePath,
        `fleet: {}\nagents:\n  test-agent:\n    status: ${status}\n`,
        "utf-8"
      );

      // Should not throw
      await expect(
        initStateDirectory({ path: stateDirPath })
      ).resolves.toBeDefined();
    }
  });

  it("accepts complete agent state", async () => {
    const stateDirPath = join(tempDir, ".herdctl");
    await initStateDirectory({ path: stateDirPath });

    const stateFilePath = join(stateDirPath, STATE_FILE_NAME);
    const completeState = `
fleet:
  started_at: "2024-01-01T00:00:00Z"
agents:
  test-agent:
    status: running
    current_job: job-2024-01-15-abc123
    last_job: job-2024-01-14-xyz789
    next_schedule: daily-check
    next_trigger_at: "2024-01-16T00:00:00Z"
    container_id: abc123def456
    error_message: null
`;

    await writeFile(stateFilePath, completeState, "utf-8");

    // Should not throw
    await expect(
      initStateDirectory({ path: stateDirPath })
    ).resolves.toBeDefined();
  });

  it("accepts empty agents object", async () => {
    const stateDirPath = join(tempDir, ".herdctl");
    await initStateDirectory({ path: stateDirPath });

    const stateFilePath = join(stateDirPath, STATE_FILE_NAME);
    await writeFile(stateFilePath, "fleet: {}\nagents: {}\n", "utf-8");

    // Should not throw
    await expect(
      initStateDirectory({ path: stateDirPath })
    ).resolves.toBeDefined();
  });

  it("accepts minimal valid state", async () => {
    const stateDirPath = join(tempDir, ".herdctl");
    await initStateDirectory({ path: stateDirPath });

    const stateFilePath = join(stateDirPath, STATE_FILE_NAME);
    await writeFile(stateFilePath, "{}\n", "utf-8");

    // Should not throw - empty object is valid due to defaults
    await expect(
      initStateDirectory({ path: stateDirPath })
    ).resolves.toBeDefined();
  });
});
