import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  LOG_LEVEL_ORDER,
  getLogLevel,
  shouldLog,
  createLogger,
} from "../logger.js";

// =============================================================================
// getLogLevel
// =============================================================================

describe("getLogLevel", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    // Clear relevant env vars
    delete process.env.HERDCTL_LOG_LEVEL;
    delete process.env.DEBUG;
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  it("returns 'info' by default when no env vars are set", () => {
    expect(getLogLevel()).toBe("info");
  });

  it("returns value from HERDCTL_LOG_LEVEL when set to 'debug'", () => {
    process.env.HERDCTL_LOG_LEVEL = "debug";
    expect(getLogLevel()).toBe("debug");
  });

  it("returns value from HERDCTL_LOG_LEVEL when set to 'info'", () => {
    process.env.HERDCTL_LOG_LEVEL = "info";
    expect(getLogLevel()).toBe("info");
  });

  it("returns value from HERDCTL_LOG_LEVEL when set to 'warn'", () => {
    process.env.HERDCTL_LOG_LEVEL = "warn";
    expect(getLogLevel()).toBe("warn");
  });

  it("returns value from HERDCTL_LOG_LEVEL when set to 'error'", () => {
    process.env.HERDCTL_LOG_LEVEL = "error";
    expect(getLogLevel()).toBe("error");
  });

  it("handles uppercase HERDCTL_LOG_LEVEL (case-insensitive)", () => {
    process.env.HERDCTL_LOG_LEVEL = "DEBUG";
    expect(getLogLevel()).toBe("debug");
  });

  it("handles mixed case HERDCTL_LOG_LEVEL", () => {
    process.env.HERDCTL_LOG_LEVEL = "WaRn";
    expect(getLogLevel()).toBe("warn");
  });

  it("returns 'debug' when DEBUG=1", () => {
    process.env.DEBUG = "1";
    expect(getLogLevel()).toBe("debug");
  });

  it("returns 'debug' when DEBUG=true", () => {
    process.env.DEBUG = "true";
    expect(getLogLevel()).toBe("debug");
  });

  it("returns 'info' when DEBUG has other values", () => {
    process.env.DEBUG = "false";
    expect(getLogLevel()).toBe("info");
  });

  it("returns 'info' when DEBUG is empty string", () => {
    process.env.DEBUG = "";
    expect(getLogLevel()).toBe("info");
  });

  it("HERDCTL_LOG_LEVEL takes precedence over DEBUG", () => {
    process.env.HERDCTL_LOG_LEVEL = "error";
    process.env.DEBUG = "1";
    expect(getLogLevel()).toBe("error");
  });

  it("HERDCTL_LOG_LEVEL=warn takes precedence over DEBUG=true", () => {
    process.env.HERDCTL_LOG_LEVEL = "warn";
    process.env.DEBUG = "true";
    expect(getLogLevel()).toBe("warn");
  });

  it("falls back to DEBUG when HERDCTL_LOG_LEVEL is invalid", () => {
    process.env.HERDCTL_LOG_LEVEL = "invalid";
    process.env.DEBUG = "1";
    expect(getLogLevel()).toBe("debug");
  });

  it("returns 'info' when HERDCTL_LOG_LEVEL is invalid and DEBUG is not set", () => {
    process.env.HERDCTL_LOG_LEVEL = "invalid";
    expect(getLogLevel()).toBe("info");
  });
});

// =============================================================================
// LOG_LEVEL_ORDER
// =============================================================================

describe("LOG_LEVEL_ORDER", () => {
  it("has debug as lowest (most verbose)", () => {
    expect(LOG_LEVEL_ORDER.debug).toBe(0);
  });

  it("has info as second level", () => {
    expect(LOG_LEVEL_ORDER.info).toBe(1);
  });

  it("has warn as third level", () => {
    expect(LOG_LEVEL_ORDER.warn).toBe(2);
  });

  it("has error as highest (least verbose)", () => {
    expect(LOG_LEVEL_ORDER.error).toBe(3);
  });

  it("maintains proper ordering (debug < info < warn < error)", () => {
    expect(LOG_LEVEL_ORDER.debug).toBeLessThan(LOG_LEVEL_ORDER.info);
    expect(LOG_LEVEL_ORDER.info).toBeLessThan(LOG_LEVEL_ORDER.warn);
    expect(LOG_LEVEL_ORDER.warn).toBeLessThan(LOG_LEVEL_ORDER.error);
  });
});

// =============================================================================
// shouldLog
// =============================================================================

describe("shouldLog", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.HERDCTL_LOG_LEVEL;
    delete process.env.DEBUG;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("at default level (info)", () => {
    it("returns false for debug", () => {
      expect(shouldLog("debug")).toBe(false);
    });

    it("returns true for info", () => {
      expect(shouldLog("info")).toBe(true);
    });

    it("returns true for warn", () => {
      expect(shouldLog("warn")).toBe(true);
    });

    it("returns true for error", () => {
      expect(shouldLog("error")).toBe(true);
    });
  });

  describe("at debug level", () => {
    beforeEach(() => {
      process.env.HERDCTL_LOG_LEVEL = "debug";
    });

    it("returns true for debug", () => {
      expect(shouldLog("debug")).toBe(true);
    });

    it("returns true for info", () => {
      expect(shouldLog("info")).toBe(true);
    });

    it("returns true for warn", () => {
      expect(shouldLog("warn")).toBe(true);
    });

    it("returns true for error", () => {
      expect(shouldLog("error")).toBe(true);
    });
  });

  describe("at warn level", () => {
    beforeEach(() => {
      process.env.HERDCTL_LOG_LEVEL = "warn";
    });

    it("returns false for debug", () => {
      expect(shouldLog("debug")).toBe(false);
    });

    it("returns false for info", () => {
      expect(shouldLog("info")).toBe(false);
    });

    it("returns true for warn", () => {
      expect(shouldLog("warn")).toBe(true);
    });

    it("returns true for error", () => {
      expect(shouldLog("error")).toBe(true);
    });
  });

  describe("at error level", () => {
    beforeEach(() => {
      process.env.HERDCTL_LOG_LEVEL = "error";
    });

    it("returns false for debug", () => {
      expect(shouldLog("debug")).toBe(false);
    });

    it("returns false for info", () => {
      expect(shouldLog("info")).toBe(false);
    });

    it("returns false for warn", () => {
      expect(shouldLog("warn")).toBe(false);
    });

    it("returns true for error", () => {
      expect(shouldLog("error")).toBe(true);
    });
  });
});

// =============================================================================
// createLogger
// =============================================================================

describe("createLogger", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.HERDCTL_LOG_LEVEL;
    delete process.env.DEBUG;

    // Spy on console methods
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("logger creation", () => {
    it("creates a logger with all methods", () => {
      const logger = createLogger("TestPrefix");

      expect(logger).toHaveProperty("debug");
      expect(logger).toHaveProperty("info");
      expect(logger).toHaveProperty("warn");
      expect(logger).toHaveProperty("error");
    });

    it("all methods are functions", () => {
      const logger = createLogger("TestPrefix");

      expect(typeof logger.debug).toBe("function");
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.warn).toBe("function");
      expect(typeof logger.error).toBe("function");
    });
  });

  describe("message prefixing", () => {
    beforeEach(() => {
      process.env.HERDCTL_LOG_LEVEL = "debug";
    });

    it("prefixes debug messages with logger name", () => {
      const logger = createLogger("MyComponent");
      logger.debug("test message");

      expect(debugSpy).toHaveBeenCalledWith("[MyComponent] test message");
    });

    it("prefixes info messages with logger name", () => {
      const logger = createLogger("MyComponent");
      logger.info("test message");

      expect(infoSpy).toHaveBeenCalledWith("[MyComponent] test message");
    });

    it("prefixes warn messages with logger name", () => {
      const logger = createLogger("MyComponent");
      logger.warn("test message");

      expect(warnSpy).toHaveBeenCalledWith("[MyComponent] test message");
    });

    it("prefixes error messages with logger name", () => {
      const logger = createLogger("MyComponent");
      logger.error("test message");

      expect(errorSpy).toHaveBeenCalledWith("[MyComponent] test message");
    });

    it("uses exact prefix provided", () => {
      const logger = createLogger("CLIRuntime");
      logger.info("Starting process...");

      expect(infoSpy).toHaveBeenCalledWith("[CLIRuntime] Starting process...");
    });

    it("handles prefix with special characters", () => {
      const logger = createLogger("Module-A::Sub");
      logger.info("message");

      expect(infoSpy).toHaveBeenCalledWith("[Module-A::Sub] message");
    });

    it("handles empty prefix", () => {
      const logger = createLogger("");
      logger.info("message");

      expect(infoSpy).toHaveBeenCalledWith("[] message");
    });
  });

  describe("log level filtering at default level (info)", () => {
    it("does not log debug messages", () => {
      const logger = createLogger("Test");
      logger.debug("debug message");

      expect(debugSpy).not.toHaveBeenCalled();
    });

    it("logs info messages", () => {
      const logger = createLogger("Test");
      logger.info("info message");

      expect(infoSpy).toHaveBeenCalledWith("[Test] info message");
    });

    it("logs warn messages", () => {
      const logger = createLogger("Test");
      logger.warn("warn message");

      expect(warnSpy).toHaveBeenCalledWith("[Test] warn message");
    });

    it("logs error messages", () => {
      const logger = createLogger("Test");
      logger.error("error message");

      expect(errorSpy).toHaveBeenCalledWith("[Test] error message");
    });
  });

  describe("log level filtering at debug level", () => {
    beforeEach(() => {
      process.env.HERDCTL_LOG_LEVEL = "debug";
    });

    it("logs debug messages", () => {
      const logger = createLogger("Test");
      logger.debug("debug message");

      expect(debugSpy).toHaveBeenCalledWith("[Test] debug message");
    });

    it("logs info messages", () => {
      const logger = createLogger("Test");
      logger.info("info message");

      expect(infoSpy).toHaveBeenCalledWith("[Test] info message");
    });

    it("logs warn messages", () => {
      const logger = createLogger("Test");
      logger.warn("warn message");

      expect(warnSpy).toHaveBeenCalledWith("[Test] warn message");
    });

    it("logs error messages", () => {
      const logger = createLogger("Test");
      logger.error("error message");

      expect(errorSpy).toHaveBeenCalledWith("[Test] error message");
    });
  });

  describe("log level filtering at error level", () => {
    beforeEach(() => {
      process.env.HERDCTL_LOG_LEVEL = "error";
    });

    it("does not log debug messages", () => {
      const logger = createLogger("Test");
      logger.debug("debug message");

      expect(debugSpy).not.toHaveBeenCalled();
    });

    it("does not log info messages", () => {
      const logger = createLogger("Test");
      logger.info("info message");

      expect(infoSpy).not.toHaveBeenCalled();
    });

    it("does not log warn messages", () => {
      const logger = createLogger("Test");
      logger.warn("warn message");

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("logs error messages", () => {
      const logger = createLogger("Test");
      logger.error("error message");

      expect(errorSpy).toHaveBeenCalledWith("[Test] error message");
    });
  });

  describe("DEBUG environment variable", () => {
    it("enables debug logging when DEBUG=1", () => {
      process.env.DEBUG = "1";
      const logger = createLogger("Test");
      logger.debug("debug message");

      expect(debugSpy).toHaveBeenCalledWith("[Test] debug message");
    });

    it("enables debug logging when DEBUG=true", () => {
      process.env.DEBUG = "true";
      const logger = createLogger("Test");
      logger.debug("debug message");

      expect(debugSpy).toHaveBeenCalledWith("[Test] debug message");
    });
  });

  describe("multiple loggers", () => {
    it("different loggers have independent prefixes", () => {
      process.env.HERDCTL_LOG_LEVEL = "debug";

      const loggerA = createLogger("ComponentA");
      const loggerB = createLogger("ComponentB");

      loggerA.info("message from A");
      loggerB.info("message from B");

      expect(infoSpy).toHaveBeenCalledWith("[ComponentA] message from A");
      expect(infoSpy).toHaveBeenCalledWith("[ComponentB] message from B");
    });
  });
});
