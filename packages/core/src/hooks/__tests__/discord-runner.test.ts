/**
 * Tests for DiscordHookRunner
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DiscordHookRunner } from "../runners/discord.js";
import type { HookContext, DiscordHookConfigInput } from "../types.js";

// Use input type for test construction (allows optional fields)
type DiscordHookConfig = DiscordHookConfigInput;

describe("DiscordHookRunner", () => {
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

  // Store original env
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env before each test
    process.env = { ...originalEnv };
    // Set up a default test token
    process.env.DISCORD_BOT_TOKEN = "test-bot-token-12345";
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe("execute", () => {
    it("should POST to Discord API successfully", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve('{"id": "123456"}'),
      });

      const runner = new DiscordHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "987654321",
        bot_token_env: "DISCORD_BOT_TOKEN",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);
      expect(result.hookType).toBe("discord");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.output).toBe('{"id": "123456"}');

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://discord.com/api/v10/channels/987654321/messages");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.headers["Authorization"]).toBe("Bot test-bot-token-12345");

      expect(mockLogger.info).toHaveBeenCalled();
    });

    it("should include correct embed structure in request body", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
      });

      const runner = new DiscordHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "987654321",
        bot_token_env: "DISCORD_BOT_TOKEN",
      };

      await runner.execute(config, sampleContext);

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      // Verify embed structure
      expect(body.embeds).toHaveLength(1);
      const embed = body.embeds[0];

      expect(embed.title).toBe("✅ Job Completed");
      expect(embed.color).toBe(0x22c55e); // green
      expect(embed.timestamp).toBe("2024-01-15T10:05:00.000Z");
      expect(embed.footer.text).toBe("herdctl");

      // Verify fields
      const fieldNames = embed.fields.map((f: { name: string }) => f.name);
      expect(fieldNames).toContain("Agent");
      expect(fieldNames).toContain("Job ID");
      expect(fieldNames).toContain("Duration");
      expect(fieldNames).toContain("Schedule");

      // Output is now in description, not fields
      expect(embed.description).toBe("Job completed successfully");

      // Verify field values
      const agentField = embed.fields.find((f: { name: string }) => f.name === "Agent");
      expect(agentField.value).toBe("Test Agent");

      const jobIdField = embed.fields.find((f: { name: string }) => f.name === "Job ID");
      expect(jobIdField.value).toBe("`job-2024-01-15-abc123`");

      const durationField = embed.fields.find((f: { name: string }) => f.name === "Duration");
      expect(durationField.value).toBe("5m"); // 300000ms = 5 minutes
    });

    it("should use red color for failed events", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
      });

      const runner = new DiscordHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const failedContext: HookContext = {
        ...sampleContext,
        event: "failed",
        result: {
          success: false,
          output: "Job failed",
          error: "Connection timeout",
        },
      };

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "987654321",
        bot_token_env: "DISCORD_BOT_TOKEN",
      };

      await runner.execute(config, failedContext);

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.embeds[0].title).toBe("❌ Job Failed");
      expect(body.embeds[0].color).toBe(0xef4444); // red

      // Verify error field is included
      const errorField = body.embeds[0].fields.find((f: { name: string }) => f.name === "Error");
      expect(errorField).toBeDefined();
      expect(errorField.value).toContain("Connection timeout");
    });

    it("should use amber color for timeout events", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
      });

      const runner = new DiscordHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const timeoutContext: HookContext = {
        ...sampleContext,
        event: "timeout",
      };

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "987654321",
        bot_token_env: "DISCORD_BOT_TOKEN",
      };

      await runner.execute(config, timeoutContext);

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.embeds[0].title).toBe("⏱️ Job Timed Out");
      expect(body.embeds[0].color).toBe(0xf59e0b); // amber
    });

    it("should use gray color for cancelled events", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
      });

      const runner = new DiscordHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const cancelledContext: HookContext = {
        ...sampleContext,
        event: "cancelled",
      };

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "987654321",
        bot_token_env: "DISCORD_BOT_TOKEN",
      };

      await runner.execute(config, cancelledContext);

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.embeds[0].title).toBe("🚫 Job Cancelled");
      expect(body.embeds[0].color).toBe(0x6b7280); // gray
    });

    it("should fail if bot token env var is not set", async () => {
      delete process.env.DISCORD_BOT_TOKEN;

      const mockFetch = vi.fn();

      const runner = new DiscordHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "987654321",
        bot_token_env: "DISCORD_BOT_TOKEN",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(false);
      expect(result.hookType).toBe("discord");
      expect(result.error).toContain("bot token not found");
      expect(result.error).toContain("DISCORD_BOT_TOKEN");
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("should use custom env var name for bot token", async () => {
      process.env.MY_CUSTOM_TOKEN = "my-custom-token-value";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
      });

      const runner = new DiscordHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "987654321",
        bot_token_env: "MY_CUSTOM_TOKEN",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers["Authorization"]).toBe("Bot my-custom-token-value");
    });

    it("should handle Discord API error responses", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: () => Promise.resolve('{"message": "Missing Permissions", "code": 50013}'),
      });

      const runner = new DiscordHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "987654321",
        bot_token_env: "DISCORD_BOT_TOKEN",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(false);
      expect(result.hookType).toBe("discord");
      expect(result.error).toContain("Missing Permissions");
      expect(result.error).toContain("50013");
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("should handle invalid channel ID errors", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve('{"message": "Unknown Channel", "code": 10003}'),
      });

      const runner = new DiscordHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "invalid-channel",
        bot_token_env: "DISCORD_BOT_TOKEN",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown Channel");
    });

    it("should handle network errors", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error: ECONNREFUSED"));

      const runner = new DiscordHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "987654321",
        bot_token_env: "DISCORD_BOT_TOKEN",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("ECONNREFUSED");
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("should handle timeout", async () => {
      // Create a mock that simulates a timeout by aborting
      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        return new Promise((_, reject) => {
          options.signal.addEventListener("abort", () => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      });

      const runner = new DiscordHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "987654321",
        bot_token_env: "DISCORD_BOT_TOKEN",
      };

      // Note: This test uses the default 10000ms timeout, but the mock
      // aborts immediately when the signal fires
      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
      expect(mockLogger.error).toHaveBeenCalled();
    }, 15000); // Extend test timeout

    it("should truncate long output to 4096 characters in description", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
      });

      const runner = new DiscordHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      // Create a context with very long output (longer than Discord's 4096 limit)
      const longOutputContext: HookContext = {
        ...sampleContext,
        result: {
          success: true,
          output: "A".repeat(5000), // 5000 characters
        },
      };

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "987654321",
        bot_token_env: "DISCORD_BOT_TOKEN",
      };

      await runner.execute(config, longOutputContext);

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      // Output is now in description, not a field
      expect(body.embeds[0].description).toBeDefined();
      expect(body.embeds[0].description).toContain("...");
      // Should be truncated to 4096 chars (Discord's embed description limit)
      expect(body.embeds[0].description.length).toBeLessThanOrEqual(4096);
    });

    it("should format duration correctly for various values", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
      });

      const runner = new DiscordHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "987654321",
        bot_token_env: "DISCORD_BOT_TOKEN",
      };

      // Test milliseconds
      let context = { ...sampleContext, job: { ...sampleContext.job, durationMs: 500 } };
      await runner.execute(config, context);
      let body = JSON.parse(mockFetch.mock.calls[0][1].body);
      let durationField = body.embeds[0].fields.find(
        (f: { name: string }) => f.name === "Duration",
      );
      expect(durationField.value).toBe("500ms");

      mockFetch.mockClear();

      // Test seconds
      context = { ...sampleContext, job: { ...sampleContext.job, durationMs: 45000 } };
      await runner.execute(config, context);
      body = JSON.parse(mockFetch.mock.calls[0][1].body);
      durationField = body.embeds[0].fields.find((f: { name: string }) => f.name === "Duration");
      expect(durationField.value).toBe("45s");

      mockFetch.mockClear();

      // Test hours
      context = { ...sampleContext, job: { ...sampleContext.job, durationMs: 3660000 } }; // 1h 1m
      await runner.execute(config, context);
      body = JSON.parse(mockFetch.mock.calls[0][1].body);
      durationField = body.embeds[0].fields.find((f: { name: string }) => f.name === "Duration");
      expect(durationField.value).toBe("1h 1m");
    });

    it("should omit schedule field if not present", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
      });

      const runner = new DiscordHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const noScheduleContext: HookContext = {
        ...sampleContext,
        job: {
          ...sampleContext.job,
          scheduleName: undefined,
        },
      };

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "987654321",
        bot_token_env: "DISCORD_BOT_TOKEN",
      };

      await runner.execute(config, noScheduleContext);

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      const scheduleField = body.embeds[0].fields.find(
        (f: { name: string }) => f.name === "Schedule",
      );
      expect(scheduleField).toBeUndefined();
    });

    it("should use agent id if name is not provided", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
      });

      const runner = new DiscordHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const noNameContext: HookContext = {
        ...sampleContext,
        agent: {
          id: "agent-id-123",
          name: undefined,
        },
      };

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "987654321",
        bot_token_env: "DISCORD_BOT_TOKEN",
      };

      await runner.execute(config, noNameContext);

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      const agentField = body.embeds[0].fields.find((f: { name: string }) => f.name === "Agent");
      expect(agentField.value).toBe("agent-id-123");
    });

    it("should measure execution duration", async () => {
      const mockFetch = vi.fn().mockImplementation(async () => {
        // Add a small delay to measure
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve(""),
        };
      });

      const runner = new DiscordHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "987654321",
        bot_token_env: "DISCORD_BOT_TOKEN",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(40); // Allow some tolerance
      expect(result.durationMs).toBeLessThan(5000);
    });

    it("should work without a logger", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve("no logger"),
      });

      const runner = new DiscordHookRunner({ fetch: mockFetch }); // No logger

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "987654321",
        bot_token_env: "DISCORD_BOT_TOKEN",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);
      expect(result.output).toBe("no logger");
    });

    it("should handle response body read errors gracefully", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.reject(new Error("Body read error")),
      });

      const runner = new DiscordHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "987654321",
        bot_token_env: "DISCORD_BOT_TOKEN",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);
      expect(result.output).toBeUndefined();
    });

    it("should handle non-JSON error responses gracefully", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve("Something went wrong"),
      });

      const runner = new DiscordHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "987654321",
        bot_token_env: "DISCORD_BOT_TOKEN",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("HTTP 500");
      expect(result.error).toContain("Something went wrong");
    });

    it("should not include description if output is empty", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
      });

      const runner = new DiscordHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const emptyOutputContext: HookContext = {
        ...sampleContext,
        result: {
          success: true,
          output: "", // Empty output
        },
      };

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "987654321",
        bot_token_env: "DISCORD_BOT_TOKEN",
      };

      await runner.execute(config, emptyOutputContext);

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      // Description should be undefined when output is empty
      expect(body.embeds[0].description).toBeUndefined();
    });

    it("should not include description if output is whitespace only", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
      });

      const runner = new DiscordHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const whitespaceOutputContext: HookContext = {
        ...sampleContext,
        result: {
          success: true,
          output: "   \n\t  ", // Whitespace only
        },
      };

      const config: DiscordHookConfig = {
        type: "discord",
        channel_id: "987654321",
        bot_token_env: "DISCORD_BOT_TOKEN",
      };

      await runner.execute(config, whitespaceOutputContext);

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      // Description should be undefined when output is whitespace only
      expect(body.embeds[0].description).toBeUndefined();
    });
  });
});
