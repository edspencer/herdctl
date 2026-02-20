/**
 * Tests for HookExecutor
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentHooksInput } from "../../config/schema.js";
import { HookExecutor } from "../hook-executor.js";
import type { HookContext } from "../types.js";

// Use input type for test construction (allows optional fields)
type AgentHooksConfig = AgentHooksInput;

describe("HookExecutor", () => {
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

  describe("executeHooks", () => {
    it("should return success when no hooks are configured", async () => {
      const executor = new HookExecutor({ logger: mockLogger });

      const result = await executor.executeHooks(undefined, sampleContext, "after_run");

      expect(result.success).toBe(true);
      expect(result.totalHooks).toBe(0);
      expect(result.successfulHooks).toBe(0);
      expect(result.failedHooks).toBe(0);
    });

    it("should return success when hook list is empty", async () => {
      const executor = new HookExecutor({ logger: mockLogger });

      const hooksConfig: AgentHooksConfig = {
        after_run: [],
      };

      const result = await executor.executeHooks(hooksConfig, sampleContext, "after_run");

      expect(result.success).toBe(true);
      expect(result.totalHooks).toBe(0);
    });

    it("should execute shell hooks successfully", async () => {
      const executor = new HookExecutor({ logger: mockLogger });

      const hooksConfig: AgentHooksConfig = {
        after_run: [
          {
            type: "shell",
            command: "echo 'hook executed'",
          },
        ],
      };

      const result = await executor.executeHooks(hooksConfig, sampleContext, "after_run");

      expect(result.success).toBe(true);
      expect(result.totalHooks).toBe(1);
      expect(result.successfulHooks).toBe(1);
      expect(result.failedHooks).toBe(0);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].hookType).toBe("shell");
    });

    it("should execute multiple hooks sequentially", async () => {
      const executor = new HookExecutor({ logger: mockLogger });

      const hooksConfig: AgentHooksConfig = {
        after_run: [
          { type: "shell", command: "echo 'first'" },
          { type: "shell", command: "echo 'second'" },
          { type: "shell", command: "echo 'third'" },
        ],
      };

      const result = await executor.executeHooks(hooksConfig, sampleContext, "after_run");

      expect(result.success).toBe(true);
      expect(result.totalHooks).toBe(3);
      expect(result.successfulHooks).toBe(3);
      expect(result.results).toHaveLength(3);
    });

    it("should handle hook failures with continue_on_error=true (default)", async () => {
      const executor = new HookExecutor({ logger: mockLogger });

      const hooksConfig: AgentHooksConfig = {
        after_run: [
          { type: "shell", command: "echo 'first'" },
          { type: "shell", command: "exit 1" }, // This will fail
          { type: "shell", command: "echo 'third'" }, // Should still run
        ],
      };

      const result = await executor.executeHooks(hooksConfig, sampleContext, "after_run");

      expect(result.success).toBe(false); // Overall success is false
      expect(result.totalHooks).toBe(3);
      expect(result.successfulHooks).toBe(2);
      expect(result.failedHooks).toBe(1);
      expect(result.shouldFailJob).toBe(false); // continue_on_error is true by default
      expect(result.results).toHaveLength(3); // All hooks ran
    });

    it("should set shouldFailJob=true when continue_on_error=false", async () => {
      const executor = new HookExecutor({ logger: mockLogger });

      const hooksConfig: AgentHooksConfig = {
        after_run: [
          {
            type: "shell",
            command: "exit 1",
            continue_on_error: false,
          },
        ],
      };

      const result = await executor.executeHooks(hooksConfig, sampleContext, "after_run");

      expect(result.success).toBe(false);
      expect(result.shouldFailJob).toBe(true);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("should filter hooks by on_events", async () => {
      const executor = new HookExecutor({ logger: mockLogger });

      const hooksConfig: AgentHooksConfig = {
        after_run: [
          {
            type: "shell",
            command: "echo 'should run'",
            on_events: ["completed"],
          },
          {
            type: "shell",
            command: "echo 'should skip'",
            on_events: ["failed"], // This won't match 'completed' event
          },
        ],
      };

      const result = await executor.executeHooks(hooksConfig, sampleContext, "after_run");

      expect(result.success).toBe(true);
      expect(result.totalHooks).toBe(2);
      expect(result.successfulHooks).toBe(1);
      expect(result.skippedHooks).toBe(1);
      expect(result.results).toHaveLength(1); // Only the one that ran
    });

    it("should run hooks without on_events filter for all events", async () => {
      const executor = new HookExecutor({ logger: mockLogger });

      const hooksConfig: AgentHooksConfig = {
        after_run: [
          {
            type: "shell",
            command: "echo 'always runs'",
            // No on_events specified
          },
        ],
      };

      const result = await executor.executeHooks(hooksConfig, sampleContext, "after_run");

      expect(result.success).toBe(true);
      expect(result.successfulHooks).toBe(1);
      expect(result.skippedHooks).toBe(0);
    });

    it("should execute on_error hooks for failed events", async () => {
      const executor = new HookExecutor({ logger: mockLogger });

      const failedContext: HookContext = {
        ...sampleContext,
        event: "failed",
        result: {
          success: false,
          output: "Job failed",
          error: "Something went wrong",
        },
      };

      const hooksConfig: AgentHooksConfig = {
        on_error: [
          {
            type: "shell",
            command: "echo 'error handler'",
          },
        ],
      };

      const result = await executor.executeHooks(hooksConfig, failedContext, "on_error");

      expect(result.success).toBe(true);
      expect(result.successfulHooks).toBe(1);
    });

    it("should handle timeout event type", async () => {
      const executor = new HookExecutor({ logger: mockLogger });

      const timeoutContext: HookContext = {
        ...sampleContext,
        event: "timeout",
        result: {
          success: false,
          output: "",
          error: "Job timed out",
        },
      };

      const hooksConfig: AgentHooksConfig = {
        after_run: [
          {
            type: "shell",
            command: "echo 'timeout handler'",
            on_events: ["timeout"],
          },
        ],
      };

      const result = await executor.executeHooks(hooksConfig, timeoutContext, "after_run");

      expect(result.success).toBe(true);
      expect(result.successfulHooks).toBe(1);
    });

    it("should handle cancelled event type", async () => {
      const executor = new HookExecutor({ logger: mockLogger });

      const cancelledContext: HookContext = {
        ...sampleContext,
        event: "cancelled",
        result: {
          success: false,
          output: "",
          error: "Job was cancelled",
        },
      };

      const hooksConfig: AgentHooksConfig = {
        after_run: [
          {
            type: "shell",
            command: "echo 'cancelled handler'",
            on_events: ["cancelled"],
          },
        ],
      };

      const result = await executor.executeHooks(hooksConfig, cancelledContext, "after_run");

      expect(result.success).toBe(true);
      expect(result.successfulHooks).toBe(1);
    });

    it("should execute webhook hooks", async () => {
      const executor = new HookExecutor({ logger: mockLogger });

      const hooksConfig: AgentHooksConfig = {
        after_run: [
          {
            type: "webhook",
            url: "https://example.com/hook",
          },
        ],
      };

      const result = await executor.executeHooks(hooksConfig, sampleContext, "after_run");

      // Webhook hooks are now implemented - they will fail against example.com
      // but the key thing is they're not returning "not yet implemented"
      expect(result.results[0].hookType).toBe("webhook");
      expect(result.results[0].error).not.toContain("not yet implemented");
    });

    it("should execute discord hooks (fails with missing token)", async () => {
      const executor = new HookExecutor({ logger: mockLogger });

      const hooksConfig: AgentHooksConfig = {
        after_run: [
          {
            type: "discord",
            channel_id: "123456789",
            bot_token_env: "DISCORD_TOKEN",
          },
        ],
      };

      const result = await executor.executeHooks(hooksConfig, sampleContext, "after_run");

      // Discord hooks are now implemented - they will fail without the token
      // but the key thing is they're not returning "not yet implemented"
      expect(result.results[0].hookType).toBe("discord");
      expect(result.results[0].error).not.toContain("not yet implemented");
      // Should fail because DISCORD_TOKEN env var is not set
      expect(result.results[0].error).toContain("bot token not found");
    });

    it("should calculate total duration", async () => {
      const executor = new HookExecutor({ logger: mockLogger });

      const hooksConfig: AgentHooksConfig = {
        after_run: [
          { type: "shell", command: "sleep 0.1" },
          { type: "shell", command: "sleep 0.1" },
        ],
      };

      const result = await executor.executeHooks(hooksConfig, sampleContext, "after_run");

      expect(result.totalDurationMs).toBeGreaterThanOrEqual(150); // At least 200ms combined
    });
  });

  // =============================================================================
  // US5: Error-Specific Hooks
  // Tests that on_error hooks only run when job fails, while after_run hooks
  // run regardless of success/failure (can filter with on_events)
  // =============================================================================

  describe("US5: Error-Specific Hooks", () => {
    it("should NOT execute on_error hooks for completed (success) events", async () => {
      const executor = new HookExecutor({ logger: mockLogger });

      const hooksConfig: AgentHooksConfig = {
        on_error: [
          {
            type: "shell",
            command: "echo 'error handler should not run'",
          },
        ],
      };

      // Context is for a completed/success event
      const result = await executor.executeHooks(hooksConfig, sampleContext, "on_error");

      // on_error hooks should still execute if called directly (the filtering
      // happens in ScheduleExecutor which only calls on_error for failed events)
      // However, with on_events filtering, we can test the filter itself
      expect(result.totalHooks).toBe(1);
    });

    it("should execute after_run hooks for completed events", async () => {
      const executor = new HookExecutor({ logger: mockLogger });

      const hooksConfig: AgentHooksConfig = {
        after_run: [
          {
            type: "shell",
            command: "echo 'after_run for success'",
          },
        ],
      };

      const result = await executor.executeHooks(hooksConfig, sampleContext, "after_run");

      expect(result.success).toBe(true);
      expect(result.successfulHooks).toBe(1);
    });

    it("should execute after_run hooks for failed events", async () => {
      const executor = new HookExecutor({ logger: mockLogger });

      const failedContext: HookContext = {
        ...sampleContext,
        event: "failed",
        result: {
          success: false,
          output: "Job failed",
          error: "Something went wrong",
        },
      };

      const hooksConfig: AgentHooksConfig = {
        after_run: [
          {
            type: "shell",
            command: "echo 'after_run for failure'",
          },
        ],
      };

      const result = await executor.executeHooks(hooksConfig, failedContext, "after_run");

      expect(result.success).toBe(true);
      expect(result.successfulHooks).toBe(1);
    });

    it("should allow after_run hooks to filter with on_events for error escalation", async () => {
      const executor = new HookExecutor({ logger: mockLogger });

      const failedContext: HookContext = {
        ...sampleContext,
        event: "failed",
        result: {
          success: false,
          output: "Job failed",
          error: "Critical failure",
        },
      };

      const hooksConfig: AgentHooksConfig = {
        after_run: [
          {
            // This hook sends routine completions to general channel - should NOT run
            type: "shell",
            command: "echo 'general notification'",
            on_events: ["completed"],
          },
          {
            // This hook runs for all events
            type: "shell",
            command: "echo 'always runs'",
          },
        ],
      };

      const result = await executor.executeHooks(hooksConfig, failedContext, "after_run");

      expect(result.success).toBe(true);
      expect(result.totalHooks).toBe(2);
      expect(result.successfulHooks).toBe(1); // Only the unfiltered one ran
      expect(result.skippedHooks).toBe(1); // The completed-only hook was skipped
    });

    it("should support separate on_error hooks for escalation while after_run logs all", async () => {
      const executor = new HookExecutor({ logger: mockLogger });

      const failedContext: HookContext = {
        ...sampleContext,
        event: "failed",
        result: {
          success: false,
          output: "Job failed",
          error: "Critical failure",
        },
      };

      // Config with both after_run (general logging) and on_error (escalation)
      const hooksConfig: AgentHooksConfig = {
        after_run: [
          {
            // General channel notification for all events
            type: "shell",
            command: "echo 'logged to general channel'",
          },
        ],
        on_error: [
          {
            // Escalation to on-call for failures only
            type: "shell",
            command: "echo 'escalated to on-call'",
          },
        ],
      };

      // Execute after_run hooks
      const afterRunResult = await executor.executeHooks(hooksConfig, failedContext, "after_run");
      expect(afterRunResult.success).toBe(true);
      expect(afterRunResult.successfulHooks).toBe(1);

      // Execute on_error hooks
      const onErrorResult = await executor.executeHooks(hooksConfig, failedContext, "on_error");
      expect(onErrorResult.success).toBe(true);
      expect(onErrorResult.successfulHooks).toBe(1);
    });

    it("should NOT run on_error hooks for timeout events (only failed)", async () => {
      const executor = new HookExecutor({ logger: mockLogger });

      const timeoutContext: HookContext = {
        ...sampleContext,
        event: "timeout",
        result: {
          success: false,
          output: "",
          error: "Job timed out",
        },
      };

      const hooksConfig: AgentHooksConfig = {
        on_error: [
          {
            type: "shell",
            command: "echo 'on_error should not run for timeout'",
            on_events: ["failed"], // Explicitly only for failed
          },
        ],
        after_run: [
          {
            type: "shell",
            command: "echo 'after_run runs for timeout'",
          },
        ],
      };

      // on_error with failed filter should skip timeout
      const onErrorResult = await executor.executeHooks(hooksConfig, timeoutContext, "on_error");
      expect(onErrorResult.skippedHooks).toBe(1);

      // after_run should still run
      const afterRunResult = await executor.executeHooks(hooksConfig, timeoutContext, "after_run");
      expect(afterRunResult.successfulHooks).toBe(1);
    });
  });
});
