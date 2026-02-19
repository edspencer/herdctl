/**
 * Tests for DM filtering utilities
 */

import { describe, expect, it } from "vitest";
import {
  checkDMUserFilter,
  type DMConfig,
  getDMMode,
  isDMEnabled,
  shouldProcessInMode,
} from "../dm-filter.js";

describe("dm-filter", () => {
  describe("isDMEnabled", () => {
    it("returns true when no config provided", () => {
      expect(isDMEnabled()).toBe(true);
      expect(isDMEnabled(undefined)).toBe(true);
    });

    it("returns true when enabled is true", () => {
      expect(isDMEnabled({ enabled: true, mode: "auto" })).toBe(true);
    });

    it("returns false when enabled is false", () => {
      expect(isDMEnabled({ enabled: false, mode: "auto" })).toBe(false);
    });

    it("returns true when enabled is not specified", () => {
      expect(isDMEnabled({ mode: "auto" } as Partial<DMConfig>)).toBe(true);
    });
  });

  describe("getDMMode", () => {
    it("returns 'auto' when no config provided", () => {
      expect(getDMMode()).toBe("auto");
      expect(getDMMode(undefined)).toBe("auto");
    });

    it("returns configured mode", () => {
      expect(getDMMode({ enabled: true, mode: "mention" })).toBe("mention");
      expect(getDMMode({ enabled: true, mode: "auto" })).toBe("auto");
    });

    it("returns 'auto' when mode is not specified", () => {
      expect(getDMMode({ enabled: true } as Partial<DMConfig>)).toBe("auto");
    });
  });

  describe("checkDMUserFilter", () => {
    it("allows all users when no config provided", () => {
      const result = checkDMUserFilter("user123");
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("allowed");
    });

    it("blocks all users when DMs are disabled", () => {
      const result = checkDMUserFilter("user123", { enabled: false, mode: "auto" });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("dm_disabled");
    });

    it("blocks users in blocklist", () => {
      const config: DMConfig = {
        enabled: true,
        mode: "auto",
        blocklist: ["blocked_user"],
      };
      const result = checkDMUserFilter("blocked_user", config);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("in_blocklist");
    });

    it("allows users not in blocklist", () => {
      const config: DMConfig = {
        enabled: true,
        mode: "auto",
        blocklist: ["blocked_user"],
      };
      const result = checkDMUserFilter("other_user", config);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("allowed");
    });

    it("blocks users not in allowlist when allowlist is defined", () => {
      const config: DMConfig = {
        enabled: true,
        mode: "auto",
        allowlist: ["allowed_user"],
      };
      const result = checkDMUserFilter("other_user", config);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("not_in_allowlist");
    });

    it("allows users in allowlist", () => {
      const config: DMConfig = {
        enabled: true,
        mode: "auto",
        allowlist: ["allowed_user"],
      };
      const result = checkDMUserFilter("allowed_user", config);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("allowed");
    });

    it("blocklist takes precedence over allowlist", () => {
      const config: DMConfig = {
        enabled: true,
        mode: "auto",
        allowlist: ["user123"],
        blocklist: ["user123"],
      };
      const result = checkDMUserFilter("user123", config);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("in_blocklist");
    });

    it("handles empty blocklist", () => {
      const config: DMConfig = {
        enabled: true,
        mode: "auto",
        blocklist: [],
      };
      const result = checkDMUserFilter("user123", config);
      expect(result.allowed).toBe(true);
    });

    it("handles empty allowlist", () => {
      const config: DMConfig = {
        enabled: true,
        mode: "auto",
        allowlist: [],
      };
      // Empty allowlist is treated as "not set" - allows everyone
      // This matches the behavior: if allowlist.length === 0, we skip the allowlist check
      const result = checkDMUserFilter("user123", config);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("allowed");
    });
  });

  describe("shouldProcessInMode", () => {
    it("never processes bot messages", () => {
      expect(shouldProcessInMode(true, "auto", true)).toBe(false);
      expect(shouldProcessInMode(true, "auto", false)).toBe(false);
      expect(shouldProcessInMode(true, "mention", true)).toBe(false);
      expect(shouldProcessInMode(true, "mention", false)).toBe(false);
    });

    it("processes all non-bot messages in auto mode", () => {
      expect(shouldProcessInMode(false, "auto", true)).toBe(true);
      expect(shouldProcessInMode(false, "auto", false)).toBe(true);
    });

    it("only processes mentions in mention mode", () => {
      expect(shouldProcessInMode(false, "mention", true)).toBe(true);
      expect(shouldProcessInMode(false, "mention", false)).toBe(false);
    });
  });
});
