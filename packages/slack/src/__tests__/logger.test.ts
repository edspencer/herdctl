import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSlackLogger, createDefaultSlackLogger } from "../logger.js";

describe("createSlackLogger", () => {
  beforeEach(() => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("standard level (default)", () => {
    it("logs info messages", () => {
      const logger = createSlackLogger({ prefix: "[test]" });
      logger.info("test message");
      expect(console.info).toHaveBeenCalledWith("[test] test message", "");
    });

    it("logs warn messages", () => {
      const logger = createSlackLogger({ prefix: "[test]" });
      logger.warn("warning");
      expect(console.warn).toHaveBeenCalledWith("[test] warning", "");
    });

    it("logs error messages", () => {
      const logger = createSlackLogger({ prefix: "[test]" });
      logger.error("error");
      expect(console.error).toHaveBeenCalledWith("[test] error", "");
    });

    it("does not log debug messages", () => {
      const logger = createSlackLogger({ prefix: "[test]" });
      logger.debug("debug");
      expect(console.debug).not.toHaveBeenCalled();
    });
  });

  describe("minimal level", () => {
    it("logs warn and error only", () => {
      const logger = createSlackLogger({
        prefix: "[test]",
        logLevel: "minimal",
      });

      logger.debug("debug");
      logger.info("info");
      logger.warn("warn");
      logger.error("error");

      expect(console.debug).not.toHaveBeenCalled();
      expect(console.info).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe("verbose level", () => {
    it("logs all message levels", () => {
      const logger = createSlackLogger({
        prefix: "[test]",
        logLevel: "verbose",
      });

      logger.debug("debug");
      logger.info("info");
      logger.warn("warn");
      logger.error("error");

      expect(console.debug).toHaveBeenCalled();
      expect(console.info).toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe("data parameter", () => {
    it("includes stringified data when provided", () => {
      const logger = createSlackLogger({
        prefix: "[test]",
        logLevel: "verbose",
      });
      const data = { key: "value" };

      logger.debug("msg", data);

      expect(console.debug).toHaveBeenCalledWith(
        "[test] msg",
        JSON.stringify(data)
      );
    });
  });
});

describe("createDefaultSlackLogger", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates logger with agent name prefix", () => {
    const logger = createDefaultSlackLogger("my-agent");
    logger.info("test");
    expect(console.info).toHaveBeenCalledWith("[slack:my-agent] test", "");
  });

  it("creates logger without agent name", () => {
    const logger = createDefaultSlackLogger();
    logger.info("test");
    expect(console.info).toHaveBeenCalledWith("[slack] test", "");
  });
});
