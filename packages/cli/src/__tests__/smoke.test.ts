/**
 * CLI Smoke Tests
 *
 * These tests verify that the built CLI binary can actually run.
 * They catch module loading issues, import errors, and basic execution problems
 * that unit tests might miss due to mocking.
 */

import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the built CLI entry point
const CLI_PATH = join(__dirname, "../../dist/index.js");

describe("CLI Smoke Tests", () => {
  describe("module loading", () => {
    it("can execute the CLI binary without import errors", () => {
      // This will throw if there are require() issues or import failures
      expect(() => {
        execSync(`node ${CLI_PATH} --version`, {
          encoding: "utf8",
          stdio: "pipe",
        });
      }).not.toThrow(/require is not defined/);
    });

    it("can run herdctl --version", () => {
      const output = execSync(`node ${CLI_PATH} --version`, {
        encoding: "utf8",
      });

      // Should output version number (e.g., "0.4.3")
      expect(output).toMatch(/^\d+\.\d+\.\d+/);
    });

    it("can run herdctl --help", () => {
      const output = execSync(`node ${CLI_PATH} --help`, {
        encoding: "utf8",
      });

      // Should show help text with available commands
      expect(output).toContain("Usage:");
      expect(output).toContain("Commands:");
    });
  });

  describe("basic command validation", () => {
    it("shows error for unknown command", () => {
      try {
        execSync(`node ${CLI_PATH} invalid-command-xyz`, {
          encoding: "utf8",
          stdio: "pipe",
        });
        // Should not reach here
        expect.fail("Should have thrown for invalid command");
      } catch (error: any) {
        // Should exit with error
        expect(error.status).toBeGreaterThan(0);
      }
    });
  });
});
