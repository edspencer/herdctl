import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initFleetCommand } from "../init-fleet.js";

function createTempDir(): string {
  const baseDir = path.join(
    tmpdir(),
    `herdctl-fleet-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(baseDir, { recursive: true });
  return fs.realpathSync(baseDir);
}

function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("initFleetCommand", () => {
  let tempDir: string;
  let originalCwd: string;
  let consoleLogs: string[];
  let consoleErrors: string[];
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let originalProcessExit: typeof process.exit;
  let exitCode: number | undefined;

  beforeEach(() => {
    tempDir = createTempDir();
    originalCwd = process.cwd();
    process.chdir(tempDir);

    consoleLogs = [];
    consoleErrors = [];
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = (...args: unknown[]) => consoleLogs.push(args.join(" "));
    console.error = (...args: unknown[]) => consoleErrors.push(args.join(" "));

    exitCode = undefined;
    originalProcessExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit(${code})`);
    }) as never;

    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupTempDir(tempDir);
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exit = originalProcessExit;
  });

  describe("file creation", () => {
    it("creates herdctl.yaml with fleet name from --name", async () => {
      await initFleetCommand({ name: "my-fleet" });

      const configPath = path.join(tempDir, "herdctl.yaml");
      expect(fs.existsSync(configPath)).toBe(true);

      const content = fs.readFileSync(configPath, "utf-8");
      expect(content).toContain("version: 1");
      expect(content).toContain("name: my-fleet");
    });

    it("creates herdctl.yaml with directory basename when no --name", async () => {
      await initFleetCommand({});

      const content = fs.readFileSync(path.join(tempDir, "herdctl.yaml"), "utf-8");
      expect(content).toContain(`name: ${path.basename(tempDir)}`);
    });

    it("does NOT create agents/ directory", async () => {
      await initFleetCommand({});

      const agentsDir = path.join(tempDir, "agents");
      expect(fs.existsSync(agentsDir)).toBe(false);
    });

    it("creates .herdctl/ directory", async () => {
      await initFleetCommand({});

      const stateDir = path.join(tempDir, ".herdctl");
      expect(fs.existsSync(stateDir)).toBe(true);
      expect(fs.statSync(stateDir).isDirectory()).toBe(true);
    });
  });

  describe("template content", () => {
    it("includes version: 1", async () => {
      await initFleetCommand({});
      const content = fs.readFileSync(path.join(tempDir, "herdctl.yaml"), "utf-8");
      expect(content).toContain("version: 1");
    });

    it("includes commented-out defaults section", async () => {
      await initFleetCommand({});
      const content = fs.readFileSync(path.join(tempDir, "herdctl.yaml"), "utf-8");
      expect(content).toContain("# defaults:");
      expect(content).toContain("#   permission_mode: default");
    });

    it("enables web dashboard by default", async () => {
      await initFleetCommand({});
      const content = fs.readFileSync(path.join(tempDir, "herdctl.yaml"), "utf-8");
      expect(content).toContain("web:");
      expect(content).toContain("enabled: true");
      expect(content).toContain("port: 3232");
    });

    it("includes commented-out fleets section", async () => {
      await initFleetCommand({});
      const content = fs.readFileSync(path.join(tempDir, "herdctl.yaml"), "utf-8");
      expect(content).toContain("# fleets:");
    });

    it("includes empty agents array with init agent hint", async () => {
      await initFleetCommand({});
      const content = fs.readFileSync(path.join(tempDir, "herdctl.yaml"), "utf-8");
      expect(content).toContain("agents: []");
      expect(content).toContain("herdctl init agent");
    });
  });

  describe("error handling", () => {
    it("errors if herdctl.yaml already exists", async () => {
      fs.writeFileSync(path.join(tempDir, "herdctl.yaml"), "version: 1");

      await expect(initFleetCommand({})).rejects.toThrow("process.exit");
      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("herdctl.yaml already exists"))).toBe(true);
    });

    it("overwrites with --force", async () => {
      fs.writeFileSync(path.join(tempDir, "herdctl.yaml"), "version: 1\nfleet:\n  name: old-fleet");

      await initFleetCommand({ force: true, name: "new-fleet" });

      const content = fs.readFileSync(path.join(tempDir, "herdctl.yaml"), "utf-8");
      expect(content).toContain("name: new-fleet");
      expect(content).not.toContain("old-fleet");
    });
  });

  describe(".gitignore handling", () => {
    it("updates existing .gitignore to include .herdctl/", async () => {
      fs.writeFileSync(path.join(tempDir, ".gitignore"), "node_modules/\n");

      await initFleetCommand({});

      const gitignore = fs.readFileSync(path.join(tempDir, ".gitignore"), "utf-8");
      expect(gitignore).toContain(".herdctl/");
      expect(gitignore).toContain("node_modules/");
    });

    it("does not duplicate .herdctl/ in .gitignore", async () => {
      fs.writeFileSync(path.join(tempDir, ".gitignore"), "node_modules/\n.herdctl/\n");

      await initFleetCommand({});

      const gitignore = fs.readFileSync(path.join(tempDir, ".gitignore"), "utf-8");
      const count = (gitignore.match(/\.herdctl\//g) || []).length;
      expect(count).toBe(1);
    });

    it("does not create .gitignore if it does not exist", async () => {
      await initFleetCommand({});
      expect(fs.existsSync(path.join(tempDir, ".gitignore"))).toBe(false);
    });
  });

  describe("output", () => {
    it("prints success message", async () => {
      await initFleetCommand({});
      expect(consoleLogs.some((log) => log.includes("Initialized herdctl fleet"))).toBe(true);
    });

    it("prints next steps including herdctl init agent", async () => {
      await initFleetCommand({});
      expect(consoleLogs.some((log) => log.includes("herdctl init agent"))).toBe(true);
    });

    it("prints herdctl start as next step", async () => {
      await initFleetCommand({});
      expect(consoleLogs.some((log) => log.includes("herdctl start"))).toBe(true);
    });
  });
});
