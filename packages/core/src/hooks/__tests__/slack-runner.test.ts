/**
 * Tests for SlackHookRunner
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlackHookRunner } from "../runners/slack.js";
import type { HookContext, SlackHookConfigInput } from "../types.js";

type SlackHookConfig = SlackHookConfigInput;

describe("SlackHookRunner", () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

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

  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token-12345";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("execute", () => {
    it("should POST to Slack API successfully", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve('{"ok": true, "ts": "1234567890.123456"}'),
      });

      const runner = new SlackHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: SlackHookConfig = {
        type: "slack",
        channel_id: "C0123456789",
        bot_token_env: "SLACK_BOT_TOKEN",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);
      expect(result.hookType).toBe("slack");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://slack.com/api/chat.postMessage",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer xoxb-test-token-12345",
            "Content-Type": "application/json; charset=utf-8",
          }),
        }),
      );
    });

    it("should include channel in the payload", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{"ok": true}'),
      });

      const runner = new SlackHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: SlackHookConfig = {
        type: "slack",
        channel_id: "C0123456789",
        bot_token_env: "SLACK_BOT_TOKEN",
      };

      await runner.execute(config, sampleContext);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.channel).toBe("C0123456789");
      expect(body.attachments).toHaveLength(1);
      expect(body.attachments[0].title).toBe("Job Completed");
      expect(body.attachments[0].footer).toBe("herdctl");
    });

    it("should fail when token env var is not set", async () => {
      delete process.env.SLACK_BOT_TOKEN;

      const runner = new SlackHookRunner({
        logger: mockLogger,
      });

      const config: SlackHookConfig = {
        type: "slack",
        channel_id: "C0123456789",
        bot_token_env: "SLACK_BOT_TOKEN",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(false);
      expect(result.hookType).toBe("slack");
      expect(result.error).toContain("SLACK_BOT_TOKEN");
    });

    it("should use default bot_token_env when not specified", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{"ok": true}'),
      });

      const runner = new SlackHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: SlackHookConfig = {
        type: "slack",
        channel_id: "C0123456789",
      };

      await runner.execute(config, sampleContext);

      // Should use SLACK_BOT_TOKEN by default
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should handle Slack API error (ok: false)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"ok": false, "error": "channel_not_found"}'),
      });

      const runner = new SlackHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: SlackHookConfig = {
        type: "slack",
        channel_id: "C_INVALID",
        bot_token_env: "SLACK_BOT_TOKEN",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("channel_not_found");
    });

    it("should handle HTTP errors", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve("Server Error"),
      });

      const runner = new SlackHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: SlackHookConfig = {
        type: "slack",
        channel_id: "C0123456789",
        bot_token_env: "SLACK_BOT_TOKEN",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("500");
    });

    it("should handle network errors", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("fetch failed"));

      const runner = new SlackHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: SlackHookConfig = {
        type: "slack",
        channel_id: "C0123456789",
        bot_token_env: "SLACK_BOT_TOKEN",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("fetch failed");
    });

    it("should handle timeout errors", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";

      const mockFetch = vi.fn().mockRejectedValue(abortError);

      const runner = new SlackHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: SlackHookConfig = {
        type: "slack",
        channel_id: "C0123456789",
        bot_token_env: "SLACK_BOT_TOKEN",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
    });

    it("should include error in attachment for failed events", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{"ok": true}'),
      });

      const runner = new SlackHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const failedContext: HookContext = {
        ...sampleContext,
        event: "failed",
        result: {
          success: false,
          output: "",
          error: "Process exited with code 1",
        },
      };

      const config: SlackHookConfig = {
        type: "slack",
        channel_id: "C0123456789",
        bot_token_env: "SLACK_BOT_TOKEN",
      };

      await runner.execute(config, failedContext);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      const attachment = body.attachments[0];

      expect(attachment.title).toBe("Job Failed");
      expect(attachment.color).toBe("#ef4444");

      const errorField = attachment.fields.find((f: { title: string }) => f.title === "Error");
      expect(errorField).toBeDefined();
      expect(errorField.value).toContain("Process exited with code 1");
    });

    it("should include metadata in attachment when present", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{"ok": true}'),
      });

      const runner = new SlackHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const contextWithMetadata: HookContext = {
        ...sampleContext,
        metadata: { shouldNotify: true, count: 42 },
      };

      const config: SlackHookConfig = {
        type: "slack",
        channel_id: "C0123456789",
        bot_token_env: "SLACK_BOT_TOKEN",
      };

      await runner.execute(config, contextWithMetadata);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      const attachment = body.attachments[0];

      const metaField = attachment.fields.find((f: { title: string }) => f.title === "Metadata");
      expect(metaField).toBeDefined();
      expect(metaField.value).toContain("shouldNotify");
    });

    it("should handle invalid JSON response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve("not valid json"),
      });

      const runner = new SlackHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: SlackHookConfig = {
        type: "slack",
        channel_id: "C0123456789",
        bot_token_env: "SLACK_BOT_TOKEN",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("parse");
    });

    it("should handle different event types", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{"ok": true}'),
      });

      const runner = new SlackHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: SlackHookConfig = {
        type: "slack",
        channel_id: "C0123456789",
        bot_token_env: "SLACK_BOT_TOKEN",
      };

      for (const event of ["completed", "failed", "timeout", "cancelled"] as const) {
        const ctx = { ...sampleContext, event };
        await runner.execute(config, ctx);
      }

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe("constructor", () => {
    it("creates runner with default logger", () => {
      const runner = new SlackHookRunner();
      expect(runner).toBeDefined();
    });

    it("creates runner with custom logger", () => {
      const runner = new SlackHookRunner({ logger: mockLogger });
      expect(runner).toBeDefined();
    });
  });
});
