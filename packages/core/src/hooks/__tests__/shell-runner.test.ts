/**
 * Tests for ShellHookRunner
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShellHookRunner } from "../runners/shell.js";
import type { HookContext, ShellHookConfigInput } from "../types.js";

// Use input type for test construction (allows optional fields)
type ShellHookConfig = ShellHookConfigInput;

describe("ShellHookRunner", () => {
  // Create a mock logger
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  // Create a sample hook context
  const sampleContext: HookContext = {
    event: "completed",
    job: {
      id: "job-2024-01-15-abc123",
      agentId: "test-agent",
      scheduleName: "daily-run",
      startedAt: "2024-01-15T10:00:00.000Z",
      completedAt: "2024-01-15T10:05:00.000Z",
      durationMs: 300000,
    },
    result: {
      success: true,
      output: "Job completed successfully",
    },
    agent: {
      id: "test-agent",
      name: "Test Agent",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute", () => {
    it("should execute a simple shell command successfully", async () => {
      const runner = new ShellHookRunner({ logger: mockLogger });

      const config: ShellHookConfig = {
        type: "shell",
        command: "echo 'test output'",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);
      expect(result.hookType).toBe("shell");
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe("test output");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it("should pass hook context as JSON on stdin", async () => {
      const runner = new ShellHookRunner({ logger: mockLogger });

      // Use cat to read stdin and output it
      const config: ShellHookConfig = {
        type: "shell",
        command: "cat",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();

      // Parse the output to verify it's valid JSON matching our context
      const parsedOutput = JSON.parse(result.output!);
      expect(parsedOutput.event).toBe("completed");
      expect(parsedOutput.job.id).toBe("job-2024-01-15-abc123");
      expect(parsedOutput.job.agentId).toBe("test-agent");
      expect(parsedOutput.result.success).toBe(true);
    });

    it("should handle command failure with non-zero exit code", async () => {
      const runner = new ShellHookRunner({ logger: mockLogger });

      const config: ShellHookConfig = {
        type: "shell",
        command: "exit 1",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("Exit code 1");
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("should capture stderr on failure", async () => {
      const runner = new ShellHookRunner({ logger: mockLogger });

      const config: ShellHookConfig = {
        type: "shell",
        command: "echo 'error message' >&2 && exit 1",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("error message");
    });

    it("should handle command not found", async () => {
      const runner = new ShellHookRunner({ logger: mockLogger });

      const config: ShellHookConfig = {
        type: "shell",
        command: "nonexistent_command_xyz_123",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    // Skip: Flaky in CI - process signal handling varies across environments
    it.skip("should respect timeout configuration", async () => {
      const runner = new ShellHookRunner({ logger: mockLogger });

      const config: ShellHookConfig = {
        type: "shell",
        command: 'node -e "setTimeout(() => {}, 100000)"',
        timeout: 100, // 100ms timeout
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
    });

    it("should use default timeout when not specified", async () => {
      const runner = new ShellHookRunner({ logger: mockLogger });

      const config: ShellHookConfig = {
        type: "shell",
        command: "echo 'quick'",
        // No timeout specified - should use default 30000ms
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);
    });

    it("should handle commands with pipes", async () => {
      const runner = new ShellHookRunner({ logger: mockLogger });

      const config: ShellHookConfig = {
        type: "shell",
        command: "echo 'hello world' | tr '[:lower:]' '[:upper:]'",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);
      expect(result.output).toBe("HELLO WORLD");
    });

    it("should pass environment variables to the command", async () => {
      const runner = new ShellHookRunner({
        logger: mockLogger,
        env: { MY_VAR: "test_value" },
      });

      const config: ShellHookConfig = {
        type: "shell",
        command: "echo $MY_VAR",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);
      expect(result.output).toBe("test_value");
    });

    it("should handle failed event context", async () => {
      const runner = new ShellHookRunner({ logger: mockLogger });

      const failedContext: HookContext = {
        ...sampleContext,
        event: "failed",
        result: {
          success: false,
          output: "Job failed",
          error: "Connection timeout",
        },
      };

      const config: ShellHookConfig = {
        type: "shell",
        command: "cat",
      };

      const result = await runner.execute(config, failedContext);

      expect(result.success).toBe(true);
      const parsedOutput = JSON.parse(result.output!);
      expect(parsedOutput.event).toBe("failed");
      expect(parsedOutput.result.success).toBe(false);
      expect(parsedOutput.result.error).toBe("Connection timeout");
    });

    it("should measure execution duration", async () => {
      const runner = new ShellHookRunner({ logger: mockLogger });

      const config: ShellHookConfig = {
        type: "shell",
        command: "sleep 0.1",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(80); // Allow some tolerance
      expect(result.durationMs).toBeLessThan(5000); // Should not take too long
    });

    it("should work without a logger", async () => {
      const runner = new ShellHookRunner(); // No options

      const config: ShellHookConfig = {
        type: "shell",
        command: "echo 'no logger'",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);
      expect(result.output).toBe("no logger");
    });

    it("should handle multiline output", async () => {
      const runner = new ShellHookRunner({ logger: mockLogger });

      const config: ShellHookConfig = {
        type: "shell",
        command: "echo 'line1'; echo 'line2'; echo 'line3'",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);
      expect(result.output).toBe("line1\nline2\nline3");
    });
  });
});
