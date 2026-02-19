import type { AgentChatDiscord } from "@herdctl/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultDiscordLogger,
  createLoggerFromConfig,
  DiscordLogger,
  type DiscordLogLevel,
} from "../logger.js";

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockDiscordConfig(logLevel: DiscordLogLevel = "standard"): AgentChatDiscord {
  return {
    bot_token_env: "TEST_BOT_TOKEN",
    session_expiry_hours: 24,
    log_level: logLevel,
    output: {
      tool_results: true,
      tool_result_max_length: 900,
      system_status: true,
      result_summary: false,
      errors: true,
    },
    guilds: [],
  };
}

// =============================================================================
// DiscordLogger Tests
// =============================================================================

describe("DiscordLogger", () => {
  beforeEach(() => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("creates logger with default settings", () => {
      const logger = new DiscordLogger({ agentName: "test-agent" });

      expect(logger.getLogLevel()).toBe("standard");
      expect(logger.isRedactionEnabled()).toBe(true);
    });

    it("creates logger with custom log level", () => {
      const logger = new DiscordLogger({
        agentName: "test-agent",
        logLevel: "verbose",
      });

      expect(logger.getLogLevel()).toBe("verbose");
    });

    it("creates logger with custom prefix", () => {
      const logger = new DiscordLogger({
        agentName: "test-agent",
        prefix: "[custom]",
      });

      logger.info("test message");

      expect(console.info).toHaveBeenCalledWith("[custom]", "test message");
    });

    it("creates logger with redaction disabled", () => {
      const logger = new DiscordLogger({
        agentName: "test-agent",
        redactContent: false,
      });

      expect(logger.isRedactionEnabled()).toBe(false);
    });
  });

  describe("log level filtering", () => {
    describe("minimal level", () => {
      it("logs error messages", () => {
        const logger = new DiscordLogger({
          agentName: "test",
          logLevel: "minimal",
        });

        logger.error("error message");

        expect(console.error).toHaveBeenCalled();
      });

      it("logs warn messages", () => {
        const logger = new DiscordLogger({
          agentName: "test",
          logLevel: "minimal",
        });

        logger.warn("warn message");

        expect(console.warn).toHaveBeenCalled();
      });

      it("does not log info messages", () => {
        const logger = new DiscordLogger({
          agentName: "test",
          logLevel: "minimal",
        });

        logger.info("info message");

        expect(console.info).not.toHaveBeenCalled();
      });

      it("does not log debug messages", () => {
        const logger = new DiscordLogger({
          agentName: "test",
          logLevel: "minimal",
        });

        logger.debug("debug message");

        expect(console.debug).not.toHaveBeenCalled();
      });
    });

    describe("standard level", () => {
      it("logs error messages", () => {
        const logger = new DiscordLogger({
          agentName: "test",
          logLevel: "standard",
        });

        logger.error("error message");

        expect(console.error).toHaveBeenCalled();
      });

      it("logs warn messages", () => {
        const logger = new DiscordLogger({
          agentName: "test",
          logLevel: "standard",
        });

        logger.warn("warn message");

        expect(console.warn).toHaveBeenCalled();
      });

      it("logs info messages", () => {
        const logger = new DiscordLogger({
          agentName: "test",
          logLevel: "standard",
        });

        logger.info("info message");

        expect(console.info).toHaveBeenCalled();
      });

      it("does not log debug messages", () => {
        const logger = new DiscordLogger({
          agentName: "test",
          logLevel: "standard",
        });

        logger.debug("debug message");

        expect(console.debug).not.toHaveBeenCalled();
      });
    });

    describe("verbose level", () => {
      it("logs all message types", () => {
        const logger = new DiscordLogger({
          agentName: "test",
          logLevel: "verbose",
        });

        logger.error("error message");
        logger.warn("warn message");
        logger.info("info message");
        logger.debug("debug message");

        expect(console.error).toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalled();
        expect(console.info).toHaveBeenCalled();
        expect(console.debug).toHaveBeenCalled();
      });
    });
  });

  describe("content redaction", () => {
    it("redacts sensitive keys in verbose mode", () => {
      const logger = new DiscordLogger({
        agentName: "test",
        logLevel: "verbose",
        redactContent: true,
      });

      logger.info("test", {
        content: "sensitive content",
        prompt: "user prompt",
        token: "secret-token",
        safeKey: "safe value",
      });

      expect(console.info).toHaveBeenCalledWith(
        "[discord:test]",
        "test",
        expect.objectContaining({
          content: "[REDACTED 17 chars]",
          prompt: "[REDACTED 11 chars]",
          token: "[REDACTED 12 chars]",
          safeKey: "safe value",
        }),
      );
    });

    it("does not redact when redactContent is false", () => {
      const logger = new DiscordLogger({
        agentName: "test",
        logLevel: "verbose",
        redactContent: false,
      });

      logger.info("test", {
        content: "sensitive content",
      });

      expect(console.info).toHaveBeenCalledWith(
        "[discord:test]",
        "test",
        expect.objectContaining({
          content: "sensitive content",
        }),
      );
    });

    it("redacts arrays", () => {
      const logger = new DiscordLogger({
        agentName: "test",
        logLevel: "verbose",
        redactContent: true,
      });

      logger.info("test", {
        content: ["item1", "item2", "item3"],
      });

      expect(console.info).toHaveBeenCalledWith(
        "[discord:test]",
        "test",
        expect.objectContaining({
          content: "[REDACTED 3 items]",
        }),
      );
    });

    it("redacts nested objects", () => {
      const logger = new DiscordLogger({
        agentName: "test",
        logLevel: "verbose",
        redactContent: true,
      });

      logger.info("test", {
        nested: {
          content: "nested sensitive",
          safe: "safe value",
        },
      });

      expect(console.info).toHaveBeenCalledWith(
        "[discord:test]",
        "test",
        expect.objectContaining({
          nested: {
            content: "[REDACTED 16 chars]",
            safe: "safe value",
          },
        }),
      );
    });

    it("does not redact in standard mode", () => {
      const logger = new DiscordLogger({
        agentName: "test",
        logLevel: "standard",
        redactContent: true,
      });

      logger.info("test", {
        content: "sensitive content",
      });

      expect(console.info).toHaveBeenCalledWith(
        "[discord:test]",
        "test",
        expect.objectContaining({
          content: "sensitive content",
        }),
      );
    });
  });

  describe("message formatting", () => {
    it("logs message without data", () => {
      const logger = new DiscordLogger({
        agentName: "test",
        logLevel: "standard",
      });

      logger.info("simple message");

      expect(console.info).toHaveBeenCalledWith("[discord:test]", "simple message");
    });

    it("logs message with data", () => {
      const logger = new DiscordLogger({
        agentName: "test",
        logLevel: "standard",
      });

      logger.info("message with data", { key: "value" });

      expect(console.info).toHaveBeenCalledWith("[discord:test]", "message with data", {
        key: "value",
      });
    });
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe("createLoggerFromConfig", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates logger with log level from config", () => {
    const config = createMockDiscordConfig("verbose");
    const logger = createLoggerFromConfig("my-agent", config);

    expect(logger.getLogLevel()).toBe("verbose");
  });

  it("creates logger with standard level by default", () => {
    const config = createMockDiscordConfig("standard");
    const logger = createLoggerFromConfig("my-agent", config);

    expect(logger.getLogLevel()).toBe("standard");
  });

  it("creates logger with redaction enabled", () => {
    const config = createMockDiscordConfig("verbose");
    const logger = createLoggerFromConfig("my-agent", config);

    expect(logger.isRedactionEnabled()).toBe(true);
  });

  it("creates logger with correct agent name prefix", () => {
    const config = createMockDiscordConfig("standard");
    const logger = createLoggerFromConfig("my-agent", config);

    logger.info("test");

    expect(console.info).toHaveBeenCalledWith("[discord:my-agent]", "test");
  });
});

describe("createDefaultDiscordLogger", () => {
  it("creates logger with standard level", () => {
    const logger = createDefaultDiscordLogger("test-agent");

    expect(logger.getLogLevel()).toBe("standard");
  });

  it("creates logger with redaction enabled", () => {
    const logger = createDefaultDiscordLogger("test-agent");

    expect(logger.isRedactionEnabled()).toBe(true);
  });
});
