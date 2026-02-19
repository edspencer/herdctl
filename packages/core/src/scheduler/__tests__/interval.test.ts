import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntervalParseError } from "../errors.js";
import { calculateNextTrigger, isScheduleDue, parseInterval } from "../interval.js";

// =============================================================================
// parseInterval - Valid inputs
// =============================================================================

describe("parseInterval", () => {
  describe("valid intervals", () => {
    it("parses seconds correctly", () => {
      expect(parseInterval("5s")).toBe(5000);
      expect(parseInterval("1s")).toBe(1000);
      expect(parseInterval("30s")).toBe(30000);
      expect(parseInterval("60s")).toBe(60000);
    });

    it("parses minutes correctly", () => {
      expect(parseInterval("5m")).toBe(300000);
      expect(parseInterval("1m")).toBe(60000);
      expect(parseInterval("30m")).toBe(1800000);
      expect(parseInterval("60m")).toBe(3600000);
    });

    it("parses hours correctly", () => {
      expect(parseInterval("1h")).toBe(3600000);
      expect(parseInterval("2h")).toBe(7200000);
      expect(parseInterval("24h")).toBe(86400000);
    });

    it("parses days correctly", () => {
      expect(parseInterval("1d")).toBe(86400000);
      expect(parseInterval("7d")).toBe(604800000);
      expect(parseInterval("30d")).toBe(2592000000);
    });

    it("handles uppercase units", () => {
      expect(parseInterval("5S")).toBe(5000);
      expect(parseInterval("5M")).toBe(300000);
      expect(parseInterval("1H")).toBe(3600000);
      expect(parseInterval("1D")).toBe(86400000);
    });

    it("handles whitespace around the interval", () => {
      expect(parseInterval("  5m  ")).toBe(300000);
      expect(parseInterval("\t1h\t")).toBe(3600000);
      expect(parseInterval("\n30s\n")).toBe(30000);
    });

    it("handles large values", () => {
      expect(parseInterval("1000s")).toBe(1000000);
      expect(parseInterval("999m")).toBe(59940000);
      expect(parseInterval("100h")).toBe(360000000);
      expect(parseInterval("365d")).toBe(31536000000);
    });
  });

  // =============================================================================
  // parseInterval - Empty string
  // =============================================================================

  describe("empty string handling", () => {
    it("throws IntervalParseError for empty string", () => {
      expect(() => parseInterval("")).toThrow(IntervalParseError);
      expect(() => parseInterval("")).toThrow(/cannot be empty/);
    });

    it("throws IntervalParseError for whitespace-only string", () => {
      expect(() => parseInterval("   ")).toThrow(IntervalParseError);
      expect(() => parseInterval("\t")).toThrow(IntervalParseError);
      expect(() => parseInterval("\n")).toThrow(IntervalParseError);
    });

    it("includes the empty input in the error", () => {
      try {
        parseInterval("");
      } catch (e) {
        expect(e).toBeInstanceOf(IntervalParseError);
        expect((e as IntervalParseError).input).toBe("");
      }
    });
  });

  // =============================================================================
  // parseInterval - Missing unit
  // =============================================================================

  describe("missing unit handling", () => {
    it("throws IntervalParseError for number without unit", () => {
      expect(() => parseInterval("5")).toThrow(IntervalParseError);
      expect(() => parseInterval("5")).toThrow(/Missing time unit/);
    });

    it("throws IntervalParseError for various numbers without unit", () => {
      expect(() => parseInterval("1")).toThrow(IntervalParseError);
      expect(() => parseInterval("100")).toThrow(IntervalParseError);
      expect(() => parseInterval("9999")).toThrow(IntervalParseError);
    });

    it("includes the input in the error", () => {
      try {
        parseInterval("42");
      } catch (e) {
        expect(e).toBeInstanceOf(IntervalParseError);
        expect((e as IntervalParseError).input).toBe("42");
      }
    });
  });

  // =============================================================================
  // parseInterval - Invalid unit
  // =============================================================================

  describe("invalid unit handling", () => {
    it("throws IntervalParseError for invalid unit", () => {
      expect(() => parseInterval("5x")).toThrow(IntervalParseError);
      expect(() => parseInterval("5x")).toThrow(/Invalid time unit "x"/);
    });

    it("throws IntervalParseError for various invalid units", () => {
      expect(() => parseInterval("5ms")).toThrow(IntervalParseError); // milliseconds not supported
      expect(() => parseInterval("5sec")).toThrow(IntervalParseError); // "sec" not supported
      expect(() => parseInterval("5min")).toThrow(IntervalParseError); // "min" not supported
      expect(() => parseInterval("5hr")).toThrow(IntervalParseError); // "hr" not supported
      expect(() => parseInterval("5w")).toThrow(IntervalParseError); // weeks not supported
      expect(() => parseInterval("5y")).toThrow(IntervalParseError); // years not supported
    });

    it("includes valid units in the error message", () => {
      expect(() => parseInterval("5x")).toThrow(/s \(seconds\)/);
      expect(() => parseInterval("5x")).toThrow(/m \(minutes\)/);
      expect(() => parseInterval("5x")).toThrow(/h \(hours\)/);
      expect(() => parseInterval("5x")).toThrow(/d \(days\)/);
    });
  });

  // =============================================================================
  // parseInterval - Negative numbers
  // =============================================================================

  describe("negative number handling", () => {
    it("throws IntervalParseError for negative numbers", () => {
      expect(() => parseInterval("-5m")).toThrow(IntervalParseError);
      expect(() => parseInterval("-5m")).toThrow(/Negative intervals are not allowed/);
    });

    it("throws IntervalParseError for various negative values", () => {
      expect(() => parseInterval("-1s")).toThrow(IntervalParseError);
      expect(() => parseInterval("-100h")).toThrow(IntervalParseError);
      expect(() => parseInterval("-1d")).toThrow(IntervalParseError);
    });

    it("includes the input in the error", () => {
      try {
        parseInterval("-10m");
      } catch (e) {
        expect(e).toBeInstanceOf(IntervalParseError);
        expect((e as IntervalParseError).input).toBe("-10m");
      }
    });
  });

  // =============================================================================
  // parseInterval - Zero value
  // =============================================================================

  describe("zero value handling", () => {
    it("throws IntervalParseError for zero", () => {
      expect(() => parseInterval("0s")).toThrow(IntervalParseError);
      expect(() => parseInterval("0s")).toThrow(/Zero interval is not allowed/);
    });

    it("throws IntervalParseError for zero with any unit", () => {
      expect(() => parseInterval("0m")).toThrow(IntervalParseError);
      expect(() => parseInterval("0h")).toThrow(IntervalParseError);
      expect(() => parseInterval("0d")).toThrow(IntervalParseError);
    });
  });

  // =============================================================================
  // parseInterval - Decimal values
  // =============================================================================

  describe("decimal value handling", () => {
    it("throws IntervalParseError for decimal values", () => {
      expect(() => parseInterval("1.5h")).toThrow(IntervalParseError);
      expect(() => parseInterval("1.5h")).toThrow(/Decimal values are not supported/);
    });

    it("throws IntervalParseError for various decimal values", () => {
      expect(() => parseInterval("2.5m")).toThrow(IntervalParseError);
      expect(() => parseInterval("0.5s")).toThrow(IntervalParseError);
      expect(() => parseInterval("1.5d")).toThrow(IntervalParseError);
    });

    it("suggests using integers in the error message", () => {
      expect(() => parseInterval("1.5h")).toThrow(/Use integers only/);
    });
  });

  // =============================================================================
  // parseInterval - Invalid format
  // =============================================================================

  describe("invalid format handling", () => {
    it("throws IntervalParseError for letter-only input", () => {
      expect(() => parseInterval("abc")).toThrow(IntervalParseError);
      expect(() => parseInterval("abc")).toThrow(/Missing numeric value/);
    });

    it("throws IntervalParseError for random invalid formats", () => {
      expect(() => parseInterval("m5")).toThrow(IntervalParseError);
      expect(() => parseInterval("5 m 5")).toThrow(IntervalParseError);
      expect(() => parseInterval("5m5s")).toThrow(IntervalParseError);
      expect(() => parseInterval("five minutes")).toThrow(IntervalParseError);
    });

    it("throws IntervalParseError for special characters", () => {
      expect(() => parseInterval("5@m")).toThrow(IntervalParseError);
      expect(() => parseInterval("5#h")).toThrow(IntervalParseError);
      expect(() => parseInterval("5$d")).toThrow(IntervalParseError);
    });
  });

  // =============================================================================
  // IntervalParseError properties
  // =============================================================================

  describe("IntervalParseError", () => {
    it("has correct name property", () => {
      try {
        parseInterval("invalid");
      } catch (e) {
        expect(e).toBeInstanceOf(IntervalParseError);
        expect((e as IntervalParseError).name).toBe("IntervalParseError");
      }
    });

    it("preserves the input string", () => {
      const testInputs = ["", "5", "invalid", "-5m", "1.5h"];

      for (const input of testInputs) {
        try {
          parseInterval(input);
        } catch (e) {
          expect((e as IntervalParseError).input).toBe(input);
        }
      }
    });

    it("has descriptive error messages", () => {
      try {
        parseInterval("5x");
      } catch (e) {
        expect((e as IntervalParseError).message).toContain("5x");
        expect((e as IntervalParseError).message.length).toBeGreaterThan(20);
      }
    });
  });
});

// =============================================================================
// calculateNextTrigger
// =============================================================================

describe("calculateNextTrigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("first run (no lastCompletedAt)", () => {
    it("returns now when lastCompletedAt is null", () => {
      const result = calculateNextTrigger(null, "5m");
      expect(result.getTime()).toBe(new Date("2024-01-15T12:00:00.000Z").getTime());
    });

    it("returns now regardless of interval when lastCompletedAt is null", () => {
      expect(calculateNextTrigger(null, "1s").getTime()).toBe(
        new Date("2024-01-15T12:00:00.000Z").getTime(),
      );
      expect(calculateNextTrigger(null, "1h").getTime()).toBe(
        new Date("2024-01-15T12:00:00.000Z").getTime(),
      );
      expect(calculateNextTrigger(null, "1d").getTime()).toBe(
        new Date("2024-01-15T12:00:00.000Z").getTime(),
      );
    });
  });

  describe("subsequent runs", () => {
    it("returns lastCompletedAt + interval for basic case", () => {
      const lastCompleted = new Date("2024-01-15T11:55:00.000Z");
      const result = calculateNextTrigger(lastCompleted, "5m");
      // 11:55 + 5m = 12:00
      expect(result.getTime()).toBe(new Date("2024-01-15T12:00:00.000Z").getTime());
    });

    it("calculates next trigger with seconds interval", () => {
      const lastCompleted = new Date("2024-01-15T11:59:30.000Z");
      const result = calculateNextTrigger(lastCompleted, "30s");
      // 11:59:30 + 30s = 12:00:00
      expect(result.getTime()).toBe(new Date("2024-01-15T12:00:00.000Z").getTime());
    });

    it("calculates next trigger with hours interval", () => {
      const lastCompleted = new Date("2024-01-15T11:00:00.000Z");
      const result = calculateNextTrigger(lastCompleted, "1h");
      // 11:00 + 1h = 12:00
      expect(result.getTime()).toBe(new Date("2024-01-15T12:00:00.000Z").getTime());
    });

    it("calculates next trigger with days interval", () => {
      const lastCompleted = new Date("2024-01-14T12:00:00.000Z");
      const result = calculateNextTrigger(lastCompleted, "1d");
      // Jan 14 12:00 + 1d = Jan 15 12:00
      expect(result.getTime()).toBe(new Date("2024-01-15T12:00:00.000Z").getTime());
    });

    it("returns future time when next trigger is in the future", () => {
      const lastCompleted = new Date("2024-01-15T11:58:00.000Z");
      const result = calculateNextTrigger(lastCompleted, "5m");
      // 11:58 + 5m = 12:03 (in the future)
      expect(result.getTime()).toBe(new Date("2024-01-15T12:03:00.000Z").getTime());
    });
  });

  describe("clock skew handling", () => {
    it("returns now when calculated next trigger is in the past", () => {
      // Last completed was a long time ago
      const lastCompleted = new Date("2024-01-15T10:00:00.000Z");
      const result = calculateNextTrigger(lastCompleted, "5m");
      // 10:00 + 5m = 10:05, which is in the past (now is 12:00)
      // Should return now instead
      expect(result.getTime()).toBe(new Date("2024-01-15T12:00:00.000Z").getTime());
    });

    it("handles very old lastCompletedAt gracefully", () => {
      const lastCompleted = new Date("2024-01-01T00:00:00.000Z");
      const result = calculateNextTrigger(lastCompleted, "1h");
      // Jan 1 00:00 + 1h = Jan 1 01:00, way in the past
      expect(result.getTime()).toBe(new Date("2024-01-15T12:00:00.000Z").getTime());
    });
  });

  describe("jitter", () => {
    it("adds no jitter when jitterPercent is 0", () => {
      const lastCompleted = new Date("2024-01-15T11:55:00.000Z");
      const result = calculateNextTrigger(lastCompleted, "5m", 0);
      expect(result.getTime()).toBe(new Date("2024-01-15T12:00:00.000Z").getTime());
    });

    it("adds no jitter when jitterPercent is undefined", () => {
      const lastCompleted = new Date("2024-01-15T11:55:00.000Z");
      const result = calculateNextTrigger(lastCompleted, "5m");
      expect(result.getTime()).toBe(new Date("2024-01-15T12:00:00.000Z").getTime());
    });

    it("adds jitter within expected range", () => {
      // Mock Math.random to return 0.5 (middle of range)
      vi.spyOn(Math, "random").mockReturnValue(0.5);

      const lastCompleted = new Date("2024-01-15T11:00:00.000Z");
      // 1h = 3600000ms, 5% jitter = 180000ms max
      // With random = 0.5, jitter = 90000ms (1.5 minutes)
      const result = calculateNextTrigger(lastCompleted, "1h", 5);

      // 11:00 + 1h + 1.5m = 12:01:30
      expect(result.getTime()).toBe(new Date("2024-01-15T12:01:30.000Z").getTime());

      vi.spyOn(Math, "random").mockRestore();
    });

    it("clamps jitter to maximum 10%", () => {
      vi.spyOn(Math, "random").mockReturnValue(1.0); // Max random

      const lastCompleted = new Date("2024-01-15T11:00:00.000Z");
      // Request 20% jitter, but should be clamped to 10%
      // 1h = 3600000ms, 10% = 360000ms (6 minutes)
      const result = calculateNextTrigger(lastCompleted, "1h", 20);

      // 11:00 + 1h + 6m = 12:06
      expect(result.getTime()).toBe(new Date("2024-01-15T12:06:00.000Z").getTime());

      vi.spyOn(Math, "random").mockRestore();
    });

    it("handles negative jitter by treating as 0", () => {
      const lastCompleted = new Date("2024-01-15T11:55:00.000Z");
      const result = calculateNextTrigger(lastCompleted, "5m", -5);
      // Negative jitter should be clamped to 0
      expect(result.getTime()).toBe(new Date("2024-01-15T12:00:00.000Z").getTime());
    });

    it("jitter range is 0 to jitterPercent% of interval", () => {
      // Test with random = 0 (minimum jitter)
      vi.spyOn(Math, "random").mockReturnValue(0);
      const lastCompleted = new Date("2024-01-15T11:00:00.000Z");
      const resultMin = calculateNextTrigger(lastCompleted, "1h", 10);
      expect(resultMin.getTime()).toBe(new Date("2024-01-15T12:00:00.000Z").getTime());

      // Test with random = 1 (maximum jitter)
      vi.spyOn(Math, "random").mockReturnValue(1.0);
      const resultMax = calculateNextTrigger(lastCompleted, "1h", 10);
      // 10% of 1h = 6 minutes
      expect(resultMax.getTime()).toBe(new Date("2024-01-15T12:06:00.000Z").getTime());

      vi.spyOn(Math, "random").mockRestore();
    });
  });

  describe("error handling", () => {
    it("throws IntervalParseError for invalid interval", () => {
      const lastCompleted = new Date("2024-01-15T11:00:00.000Z");
      expect(() => calculateNextTrigger(lastCompleted, "invalid")).toThrow(IntervalParseError);
    });

    it("throws for empty interval", () => {
      const lastCompleted = new Date("2024-01-15T11:00:00.000Z");
      expect(() => calculateNextTrigger(lastCompleted, "")).toThrow(IntervalParseError);
    });
  });
});

// =============================================================================
// isScheduleDue
// =============================================================================

describe("isScheduleDue", () => {
  describe("with explicit now parameter", () => {
    it("returns false when nextRunAt is in the future", () => {
      const nextRun = new Date("2024-01-15T12:05:00.000Z");
      const now = new Date("2024-01-15T12:00:00.000Z");
      expect(isScheduleDue(nextRun, now)).toBe(false);
    });

    it("returns true when nextRunAt equals now", () => {
      const nextRun = new Date("2024-01-15T12:00:00.000Z");
      const now = new Date("2024-01-15T12:00:00.000Z");
      expect(isScheduleDue(nextRun, now)).toBe(true);
    });

    it("returns true when nextRunAt is in the past", () => {
      const nextRun = new Date("2024-01-15T11:55:00.000Z");
      const now = new Date("2024-01-15T12:00:00.000Z");
      expect(isScheduleDue(nextRun, now)).toBe(true);
    });

    it("handles millisecond precision", () => {
      const nextRun = new Date("2024-01-15T12:00:00.001Z");
      const now = new Date("2024-01-15T12:00:00.000Z");
      expect(isScheduleDue(nextRun, now)).toBe(false);

      const nextRun2 = new Date("2024-01-15T12:00:00.000Z");
      const now2 = new Date("2024-01-15T12:00:00.001Z");
      expect(isScheduleDue(nextRun2, now2)).toBe(true);
    });
  });

  describe("with default now", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-15T12:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("uses current time when now is not provided", () => {
      const futureRun = new Date("2024-01-15T12:05:00.000Z");
      expect(isScheduleDue(futureRun)).toBe(false);

      const pastRun = new Date("2024-01-15T11:55:00.000Z");
      expect(isScheduleDue(pastRun)).toBe(true);

      const currentRun = new Date("2024-01-15T12:00:00.000Z");
      expect(isScheduleDue(currentRun)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles very old dates", () => {
      const veryOldDate = new Date("2000-01-01T00:00:00.000Z");
      const now = new Date("2024-01-15T12:00:00.000Z");
      expect(isScheduleDue(veryOldDate, now)).toBe(true);
    });

    it("handles very future dates", () => {
      const veryFutureDate = new Date("2100-01-01T00:00:00.000Z");
      const now = new Date("2024-01-15T12:00:00.000Z");
      expect(isScheduleDue(veryFutureDate, now)).toBe(false);
    });
  });
});
