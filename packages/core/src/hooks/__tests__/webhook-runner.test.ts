/**
 * Tests for WebhookHookRunner
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookHookRunner } from "../runners/webhook.js";
import type { HookContext, WebhookHookConfigInput } from "../types.js";

// Use input type for test construction (allows optional fields)
type WebhookHookConfig = WebhookHookConfigInput;

describe("WebhookHookRunner", () => {
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
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe("execute", () => {
    it("should POST to the webhook URL successfully", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve('{"received": true}'),
      });

      const runner = new WebhookHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: WebhookHookConfig = {
        type: "webhook",
        url: "https://api.example.com/hooks/job-complete",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);
      expect(result.hookType).toBe("webhook");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.output).toBe('{"received": true}');

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.example.com/hooks/job-complete");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");

      // Verify body is correct JSON
      const body = JSON.parse(options.body);
      expect(body.event).toBe("completed");
      expect(body.job.id).toBe("job-2024-01-15-abc123");
      expect(body.result.success).toBe(true);

      expect(mockLogger.info).toHaveBeenCalled();
    });

    it("should use PUT method when configured", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
      });

      const runner = new WebhookHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: WebhookHookConfig = {
        type: "webhook",
        url: "https://api.example.com/hooks/update",
        method: "PUT",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe("PUT");
    });

    it("should include custom headers", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
      });

      const runner = new WebhookHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: WebhookHookConfig = {
        type: "webhook",
        url: "https://api.example.com/hooks",
        headers: {
          "X-Custom-Header": "custom-value",
          Authorization: "Bearer static-token",
        },
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers["X-Custom-Header"]).toBe("custom-value");
      expect(options.headers.Authorization).toBe("Bearer static-token");
      expect(options.headers["Content-Type"]).toBe("application/json");
    });

    it("should substitute environment variables in headers", async () => {
      process.env.API_TOKEN = "secret-token-123";
      process.env.CUSTOM_VALUE = "env-custom-value";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
      });

      const runner = new WebhookHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: WebhookHookConfig = {
        type: "webhook",
        url: "https://api.example.com/hooks",
        headers: {
          Authorization: "Bearer ${API_TOKEN}",
          "X-Custom": "${CUSTOM_VALUE}",
        },
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers.Authorization).toBe("Bearer secret-token-123");
      expect(options.headers["X-Custom"]).toBe("env-custom-value");
    });

    it("should replace undefined env vars with empty string", async () => {
      // Ensure the env var doesn't exist
      delete process.env.UNDEFINED_VAR;

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
      });

      const runner = new WebhookHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: WebhookHookConfig = {
        type: "webhook",
        url: "https://api.example.com/hooks",
        headers: {
          Authorization: "Bearer ${UNDEFINED_VAR}",
        },
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers.Authorization).toBe("Bearer ");
    });

    it("should handle multiple env var substitutions in one header", async () => {
      process.env.USER = "testuser";
      process.env.PASS = "testpass";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
      });

      const runner = new WebhookHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: WebhookHookConfig = {
        type: "webhook",
        url: "https://api.example.com/hooks",
        headers: {
          "X-Credentials": "${USER}:${PASS}",
        },
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers["X-Credentials"]).toBe("testuser:testpass");
    });

    it("should handle HTTP error responses", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve("Something went wrong"),
      });

      const runner = new WebhookHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: WebhookHookConfig = {
        type: "webhook",
        url: "https://api.example.com/hooks",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(false);
      expect(result.hookType).toBe("webhook");
      expect(result.error).toContain("HTTP 500");
      expect(result.error).toContain("Internal Server Error");
      expect(result.error).toContain("Something went wrong");
      expect(result.output).toBe("Something went wrong");
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("should handle 4xx client errors", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () => Promise.resolve("Invalid token"),
      });

      const runner = new WebhookHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: WebhookHookConfig = {
        type: "webhook",
        url: "https://api.example.com/hooks",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("HTTP 401");
      expect(result.error).toContain("Unauthorized");
    });

    it("should handle network errors", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error: ECONNREFUSED"));

      const runner = new WebhookHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: WebhookHookConfig = {
        type: "webhook",
        url: "https://api.example.com/hooks",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("ECONNREFUSED");
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("should handle timeout", async () => {
      // Create a mock that simulates a timeout by aborting
      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        // Wait for abort signal
        return new Promise((_, reject) => {
          options.signal.addEventListener("abort", () => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      });

      const runner = new WebhookHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: WebhookHookConfig = {
        type: "webhook",
        url: "https://api.example.com/hooks",
        timeout: 50, // Very short timeout
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
      expect(result.error).toContain("50ms");
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("should use default timeout when not specified", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
      });

      const runner = new WebhookHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: WebhookHookConfig = {
        type: "webhook",
        url: "https://api.example.com/hooks",
        // No timeout specified - should use default 10000ms
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);
    });

    it("should accept 2xx status codes as success", async () => {
      for (const status of [200, 201, 202, 204]) {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status,
          statusText: "OK",
          text: () => Promise.resolve(""),
        });

        const runner = new WebhookHookRunner({
          logger: mockLogger,
          fetch: mockFetch,
        });

        const config: WebhookHookConfig = {
          type: "webhook",
          url: "https://api.example.com/hooks",
        };

        const result = await runner.execute(config, sampleContext);

        expect(result.success).toBe(true);
      }
    });

    it("should handle failed event context", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
      });

      const runner = new WebhookHookRunner({
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

      const config: WebhookHookConfig = {
        type: "webhook",
        url: "https://api.example.com/hooks",
      };

      const result = await runner.execute(config, failedContext);

      expect(result.success).toBe(true);

      // Verify the failed context was sent in the body
      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.event).toBe("failed");
      expect(body.result.success).toBe(false);
      expect(body.result.error).toBe("Connection timeout");
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

      const runner = new WebhookHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: WebhookHookConfig = {
        type: "webhook",
        url: "https://api.example.com/hooks",
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

      const runner = new WebhookHookRunner({ fetch: mockFetch }); // No logger

      const config: WebhookHookConfig = {
        type: "webhook",
        url: "https://api.example.com/hooks",
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

      const runner = new WebhookHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: WebhookHookConfig = {
        type: "webhook",
        url: "https://api.example.com/hooks",
      };

      const result = await runner.execute(config, sampleContext);

      expect(result.success).toBe(true);
      expect(result.output).toBeUndefined();
    });

    it("should send complete HookContext in request body", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
      });

      const runner = new WebhookHookRunner({
        logger: mockLogger,
        fetch: mockFetch,
      });

      const config: WebhookHookConfig = {
        type: "webhook",
        url: "https://api.example.com/hooks",
      };

      await runner.execute(config, sampleContext);

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      // Verify all context fields are present
      expect(body.event).toBe("completed");
      expect(body.job.id).toBe("job-2024-01-15-abc123");
      expect(body.job.agentId).toBe("test-agent");
      expect(body.job.scheduleName).toBe("daily-run");
      expect(body.job.startedAt).toBe("2024-01-15T10:00:00.000Z");
      expect(body.job.completedAt).toBe("2024-01-15T10:05:00.000Z");
      expect(body.job.durationMs).toBe(300000);
      expect(body.result.success).toBe(true);
      expect(body.result.output).toBe("Job completed successfully");
      expect(body.agent.id).toBe("test-agent");
      expect(body.agent.name).toBe("Test Agent");
    });
  });
});
