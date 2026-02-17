/**
 * Tests for status formatting utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatTimestamp,
  formatDuration,
  formatDurationMs,
  getStatusEmoji,
  formatNumber,
  formatCompactNumber,
  formatCharCount,
  formatCost,
} from "../status-formatting.js";

describe("status-formatting", () => {
  describe("formatTimestamp", () => {
    it("returns N/A for null", () => {
      expect(formatTimestamp(null)).toBe("N/A");
    });

    it("formats ISO timestamp", () => {
      const timestamp = "2024-01-15T10:30:00Z";
      const result = formatTimestamp(timestamp);
      // Result is locale-dependent, just verify it's not N/A
      expect(result).not.toBe("N/A");
      expect(result.length).toBeGreaterThan(0);
    });

    it("handles invalid timestamp", () => {
      const result = formatTimestamp("invalid");
      // Invalid Date still produces a string (usually "Invalid Date")
      expect(typeof result).toBe("string");
    });
  });

  describe("formatDuration", () => {
    let now: number;

    beforeEach(() => {
      now = Date.now();
      vi.useFakeTimers();
      vi.setSystemTime(now);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns N/A for null", () => {
      expect(formatDuration(null)).toBe("N/A");
    });

    it("formats seconds", () => {
      const timestamp = new Date(now - 30 * 1000).toISOString();
      expect(formatDuration(timestamp)).toBe("30s");
    });

    it("formats minutes and seconds", () => {
      const timestamp = new Date(now - (5 * 60 * 1000 + 30 * 1000)).toISOString();
      expect(formatDuration(timestamp)).toBe("5m 30s");
    });

    it("formats hours and minutes", () => {
      const timestamp = new Date(now - (2 * 60 * 60 * 1000 + 30 * 60 * 1000)).toISOString();
      expect(formatDuration(timestamp)).toBe("2h 30m");
    });

    it("formats days and hours", () => {
      const timestamp = new Date(now - (3 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000)).toISOString();
      expect(formatDuration(timestamp)).toBe("3d 12h");
    });

    it("handles very short duration", () => {
      // Due to execution time, this will be a few ms rather than exactly 0
      const timestamp = new Date(now).toISOString();
      const result = formatDuration(timestamp);
      // Could be 0s or 1s depending on timing
      expect(result).toMatch(/^[01]s$/);
    });
  });

  describe("formatDurationMs", () => {
    it("formats milliseconds", () => {
      expect(formatDurationMs(500)).toBe("500ms");
      expect(formatDurationMs(999)).toBe("999ms");
    });

    it("formats seconds", () => {
      expect(formatDurationMs(1000)).toBe("1s");
      expect(formatDurationMs(45000)).toBe("45s");
    });

    it("formats minutes and seconds", () => {
      expect(formatDurationMs(65000)).toBe("1m 5s");
      expect(formatDurationMs(120000)).toBe("2m");
    });

    it("handles zero", () => {
      expect(formatDurationMs(0)).toBe("0ms");
    });
  });

  describe("getStatusEmoji", () => {
    it("returns green circle for connected", () => {
      expect(getStatusEmoji("connected")).toBe("\u{1F7E2}");
    });

    it("returns yellow circle for connecting/reconnecting", () => {
      expect(getStatusEmoji("connecting")).toBe("\u{1F7E1}");
      expect(getStatusEmoji("reconnecting")).toBe("\u{1F7E1}");
    });

    it("returns white circle for disconnected/disconnecting", () => {
      expect(getStatusEmoji("disconnected")).toBe("\u26AA");
      expect(getStatusEmoji("disconnecting")).toBe("\u26AA");
    });

    it("returns red circle for error", () => {
      expect(getStatusEmoji("error")).toBe("\u{1F534}");
    });

    it("returns question mark for unknown status", () => {
      expect(getStatusEmoji("unknown")).toBe("\u2753");
      expect(getStatusEmoji("")).toBe("\u2753");
      expect(getStatusEmoji("invalid")).toBe("\u2753");
    });
  });

  describe("formatNumber", () => {
    it("formats numbers with thousand separators", () => {
      // toLocaleString is locale-dependent, but 1234567 should have separators
      const result = formatNumber(1234567);
      expect(result.length).toBeGreaterThan(7); // Has separators
    });

    it("handles small numbers", () => {
      expect(formatNumber(42)).toBe("42");
    });

    it("handles zero", () => {
      expect(formatNumber(0)).toBe("0");
    });
  });

  describe("formatCompactNumber", () => {
    it("formats millions", () => {
      expect(formatCompactNumber(1500000)).toBe("1.5M");
      expect(formatCompactNumber(2500000)).toBe("2.5M");
    });

    it("formats thousands", () => {
      expect(formatCompactNumber(1500)).toBe("1.5k");
      expect(formatCompactNumber(15000)).toBe("15.0k");
    });

    it("keeps small numbers as-is", () => {
      expect(formatCompactNumber(42)).toBe("42");
      expect(formatCompactNumber(999)).toBe("999");
    });

    it("handles zero", () => {
      expect(formatCompactNumber(0)).toBe("0");
    });

    it("handles boundary values", () => {
      expect(formatCompactNumber(1000)).toBe("1.0k");
      expect(formatCompactNumber(1000000)).toBe("1.0M");
    });
  });

  describe("formatCharCount", () => {
    it("formats small counts", () => {
      expect(formatCharCount(500)).toBe("500 chars");
      expect(formatCharCount(999)).toBe("999 chars");
    });

    it("formats large counts in k", () => {
      expect(formatCharCount(1000)).toBe("1.0k chars");
      expect(formatCharCount(15000)).toBe("15.0k chars");
    });

    it("handles zero", () => {
      expect(formatCharCount(0)).toBe("0 chars");
    });
  });

  describe("formatCost", () => {
    it("formats cost with default precision", () => {
      expect(formatCost(0.0123)).toBe("$0.0123");
      expect(formatCost(1.5)).toBe("$1.5000");
    });

    it("uses custom precision", () => {
      expect(formatCost(0.0123, 2)).toBe("$0.01");
      expect(formatCost(1.5, 6)).toBe("$1.500000");
    });

    it("handles zero", () => {
      expect(formatCost(0)).toBe("$0.0000");
    });
  });
});
