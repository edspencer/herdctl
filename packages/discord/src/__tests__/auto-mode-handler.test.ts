import type { ChatDM, DiscordGuild } from "@herdctl/core";
import { describe, expect, it } from "vitest";
import {
  checkDMUserFilter,
  DEFAULT_CHANNEL_CONTEXT_MESSAGES,
  DEFAULT_DM_CONTEXT_MESSAGES,
  findChannelConfig,
  getDMMode,
  isDMEnabled,
  resolveChannelConfig,
} from "../auto-mode-handler.js";

// =============================================================================
// isDMEnabled Tests
// =============================================================================

describe("isDMEnabled", () => {
  it("returns true when no DM config provided", () => {
    expect(isDMEnabled(undefined)).toBe(true);
  });

  it("returns true when DM config has enabled: true", () => {
    const dmConfig: ChatDM = {
      enabled: true,
      mode: "auto",
    };
    expect(isDMEnabled(dmConfig)).toBe(true);
  });

  it("returns false when DM config has enabled: false", () => {
    const dmConfig: ChatDM = {
      enabled: false,
      mode: "auto",
    };
    expect(isDMEnabled(dmConfig)).toBe(false);
  });
});

// =============================================================================
// getDMMode Tests
// =============================================================================

describe("getDMMode", () => {
  it("returns auto when no DM config provided", () => {
    expect(getDMMode(undefined)).toBe("auto");
  });

  it("returns auto when DM config has mode: auto", () => {
    const dmConfig: ChatDM = {
      enabled: true,
      mode: "auto",
    };
    expect(getDMMode(dmConfig)).toBe("auto");
  });

  it("returns mention when DM config has mode: mention", () => {
    const dmConfig: ChatDM = {
      enabled: true,
      mode: "mention",
    };
    expect(getDMMode(dmConfig)).toBe("mention");
  });
});

// =============================================================================
// checkDMUserFilter Tests
// =============================================================================

describe("checkDMUserFilter", () => {
  describe("when DMs are disabled", () => {
    it("returns dm_disabled reason", () => {
      const dmConfig: ChatDM = {
        enabled: false,
        mode: "auto",
      };
      const result = checkDMUserFilter("user-123", dmConfig);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("dm_disabled");
    });
  });

  describe("when no config provided", () => {
    it("allows all users", () => {
      const result = checkDMUserFilter("user-123", undefined);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("allowed");
    });
  });

  describe("with blocklist", () => {
    it("blocks users on blocklist", () => {
      const dmConfig: ChatDM = {
        enabled: true,
        mode: "auto",
        blocklist: ["blocked-user-1", "blocked-user-2"],
      };
      const result = checkDMUserFilter("blocked-user-1", dmConfig);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("in_blocklist");
    });

    it("allows users not on blocklist", () => {
      const dmConfig: ChatDM = {
        enabled: true,
        mode: "auto",
        blocklist: ["blocked-user-1"],
      };
      const result = checkDMUserFilter("allowed-user", dmConfig);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("allowed");
    });

    it("handles empty blocklist", () => {
      const dmConfig: ChatDM = {
        enabled: true,
        mode: "auto",
        blocklist: [],
      };
      const result = checkDMUserFilter("user-123", dmConfig);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("allowed");
    });
  });

  describe("with allowlist", () => {
    it("allows users on allowlist", () => {
      const dmConfig: ChatDM = {
        enabled: true,
        mode: "auto",
        allowlist: ["allowed-user-1", "allowed-user-2"],
      };
      const result = checkDMUserFilter("allowed-user-1", dmConfig);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("allowed");
    });

    it("blocks users not on allowlist", () => {
      const dmConfig: ChatDM = {
        enabled: true,
        mode: "auto",
        allowlist: ["allowed-user-1"],
      };
      const result = checkDMUserFilter("not-on-list-user", dmConfig);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("not_in_allowlist");
    });

    it("handles empty allowlist (all allowed)", () => {
      const dmConfig: ChatDM = {
        enabled: true,
        mode: "auto",
        allowlist: [],
      };
      const result = checkDMUserFilter("user-123", dmConfig);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("allowed");
    });
  });

  describe("with both allowlist and blocklist", () => {
    it("blocklist takes precedence over allowlist", () => {
      const dmConfig: ChatDM = {
        enabled: true,
        mode: "auto",
        allowlist: ["user-123"],
        blocklist: ["user-123"], // Same user on both lists
      };
      // Blocklist should take precedence
      const result = checkDMUserFilter("user-123", dmConfig);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("in_blocklist");
    });

    it("user on allowlist but not blocklist is allowed", () => {
      const dmConfig: ChatDM = {
        enabled: true,
        mode: "auto",
        allowlist: ["allowed-user"],
        blocklist: ["blocked-user"],
      };
      const result = checkDMUserFilter("allowed-user", dmConfig);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("allowed");
    });

    it("user not on allowlist is blocked regardless of blocklist", () => {
      const dmConfig: ChatDM = {
        enabled: true,
        mode: "auto",
        allowlist: ["allowed-user"],
        blocklist: ["blocked-user"],
      };
      const result = checkDMUserFilter("random-user", dmConfig);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("not_in_allowlist");
    });
  });
});

// =============================================================================
// findChannelConfig Tests
// =============================================================================

describe("findChannelConfig", () => {
  const guilds: DiscordGuild[] = [
    {
      id: "guild-1",
      channels: [
        {
          id: "channel-1",
          name: "#general",
          mode: "mention",
          context_messages: 10,
        },
        {
          id: "channel-2",
          name: "#support",
          mode: "auto",
          context_messages: 20,
        },
      ],
    },
    {
      id: "guild-2",
      channels: [
        {
          id: "channel-3",
          name: "#help",
          mode: "auto",
          context_messages: 15,
        },
      ],
    },
  ];

  it("finds channel in first guild", () => {
    const result = findChannelConfig("channel-1", guilds);
    expect(result).not.toBeNull();
    expect(result?.channel.id).toBe("channel-1");
    expect(result?.channel.mode).toBe("mention");
    expect(result?.guildId).toBe("guild-1");
  });

  it("finds channel in second guild", () => {
    const result = findChannelConfig("channel-3", guilds);
    expect(result).not.toBeNull();
    expect(result?.channel.id).toBe("channel-3");
    expect(result?.channel.mode).toBe("auto");
    expect(result?.guildId).toBe("guild-2");
  });

  it("returns null for unknown channel", () => {
    const result = findChannelConfig("unknown-channel", guilds);
    expect(result).toBeNull();
  });

  it("returns null for empty guilds array", () => {
    const result = findChannelConfig("channel-1", []);
    expect(result).toBeNull();
  });

  it("returns null for guild with no channels", () => {
    const guildsNoChannels: DiscordGuild[] = [
      {
        id: "guild-1",
        // No channels defined
      },
    ];
    const result = findChannelConfig("channel-1", guildsNoChannels);
    expect(result).toBeNull();
  });
});

// =============================================================================
// resolveChannelConfig Tests
// =============================================================================

describe("resolveChannelConfig", () => {
  const guilds: DiscordGuild[] = [
    {
      id: "guild-1",
      channels: [
        {
          id: "channel-1",
          name: "#general",
          mode: "mention",
          context_messages: 10,
        },
        {
          id: "channel-2",
          name: "#support",
          mode: "auto",
          context_messages: 20,
        },
      ],
    },
  ];

  describe("for DMs", () => {
    it("returns auto mode with default context messages when DMs enabled", () => {
      const dmConfig: ChatDM = {
        enabled: true,
        mode: "auto",
      };
      const result = resolveChannelConfig("dm-channel-id", null, guilds, dmConfig);
      expect(result).not.toBeNull();
      expect(result?.mode).toBe("auto");
      expect(result?.contextMessages).toBe(DEFAULT_DM_CONTEXT_MESSAGES);
      expect(result?.isDM).toBe(true);
      expect(result?.guildId).toBeNull();
    });

    it("returns mention mode when DM config has mention mode", () => {
      const dmConfig: ChatDM = {
        enabled: true,
        mode: "mention",
      };
      const result = resolveChannelConfig("dm-channel-id", null, guilds, dmConfig);
      expect(result).not.toBeNull();
      expect(result?.mode).toBe("mention");
      expect(result?.isDM).toBe(true);
    });

    it("returns null when DMs are disabled", () => {
      const dmConfig: ChatDM = {
        enabled: false,
        mode: "auto",
      };
      const result = resolveChannelConfig("dm-channel-id", null, guilds, dmConfig);
      expect(result).toBeNull();
    });

    it("returns auto mode when no DM config (default)", () => {
      const result = resolveChannelConfig("dm-channel-id", null, guilds, undefined);
      expect(result).not.toBeNull();
      expect(result?.mode).toBe("auto");
      expect(result?.isDM).toBe(true);
    });
  });

  describe("for guild channels", () => {
    it("returns channel config for configured channel", () => {
      const result = resolveChannelConfig("channel-1", "guild-1", guilds);
      expect(result).not.toBeNull();
      expect(result?.mode).toBe("mention");
      expect(result?.contextMessages).toBe(10);
      expect(result?.isDM).toBe(false);
      expect(result?.guildId).toBe("guild-1");
    });

    it("returns auto mode for auto channel", () => {
      const result = resolveChannelConfig("channel-2", "guild-1", guilds);
      expect(result).not.toBeNull();
      expect(result?.mode).toBe("auto");
      expect(result?.contextMessages).toBe(20);
      expect(result?.isDM).toBe(false);
    });

    it("returns null for unconfigured channel", () => {
      const result = resolveChannelConfig("unknown-channel", "guild-1", guilds);
      expect(result).toBeNull();
    });

    it("returns null for unconfigured guild", () => {
      const result = resolveChannelConfig("channel-1", "unknown-guild", guilds);
      expect(result).toBeNull();
    });
  });
});

// =============================================================================
// Constants Tests
// =============================================================================

describe("constants", () => {
  it("has correct default DM context messages", () => {
    expect(DEFAULT_DM_CONTEXT_MESSAGES).toBe(10);
  });

  it("has correct default channel context messages", () => {
    expect(DEFAULT_CHANNEL_CONTEXT_MESSAGES).toBe(10);
  });
});
