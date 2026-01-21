import { describe, it, expect } from "vitest";
import {
  ChannelSessionSchema,
  DiscordSessionStateSchema,
  createInitialSessionState,
  createChannelSession,
} from "../types.js";

// =============================================================================
// ChannelSessionSchema Tests
// =============================================================================

describe("ChannelSessionSchema", () => {
  it("validates valid channel session", () => {
    const session = {
      sessionId: "discord-test-123",
      lastMessageAt: "2024-01-15T10:30:00.000Z",
    };

    const result = ChannelSessionSchema.safeParse(session);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBe("discord-test-123");
      expect(result.data.lastMessageAt).toBe("2024-01-15T10:30:00.000Z");
    }
  });

  it("rejects empty sessionId", () => {
    const session = {
      sessionId: "",
      lastMessageAt: "2024-01-15T10:30:00.000Z",
    };

    const result = ChannelSessionSchema.safeParse(session);

    expect(result.success).toBe(false);
  });

  it("rejects invalid lastMessageAt", () => {
    const session = {
      sessionId: "discord-test-123",
      lastMessageAt: "not-a-date",
    };

    const result = ChannelSessionSchema.safeParse(session);

    expect(result.success).toBe(false);
  });

  it("rejects missing fields", () => {
    const sessions = [
      { sessionId: "test" },
      { lastMessageAt: "2024-01-15T10:30:00.000Z" },
      {},
    ];

    for (const session of sessions) {
      const result = ChannelSessionSchema.safeParse(session);
      expect(result.success).toBe(false);
    }
  });
});

// =============================================================================
// DiscordSessionStateSchema Tests
// =============================================================================

describe("DiscordSessionStateSchema", () => {
  it("validates valid session state", () => {
    const state = {
      version: 1,
      agentName: "test-agent",
      channels: {
        "channel-123": {
          sessionId: "discord-test-123",
          lastMessageAt: "2024-01-15T10:30:00.000Z",
        },
      },
    };

    const result = DiscordSessionStateSchema.safeParse(state);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
      expect(result.data.agentName).toBe("test-agent");
      expect(result.data.channels["channel-123"].sessionId).toBe(
        "discord-test-123"
      );
    }
  });

  it("validates empty channels", () => {
    const state = {
      version: 1,
      agentName: "test-agent",
      channels: {},
    };

    const result = DiscordSessionStateSchema.safeParse(state);

    expect(result.success).toBe(true);
  });

  it("rejects wrong version", () => {
    const state = {
      version: 2,
      agentName: "test-agent",
      channels: {},
    };

    const result = DiscordSessionStateSchema.safeParse(state);

    expect(result.success).toBe(false);
  });

  it("rejects empty agentName", () => {
    const state = {
      version: 1,
      agentName: "",
      channels: {},
    };

    const result = DiscordSessionStateSchema.safeParse(state);

    expect(result.success).toBe(false);
  });

  it("rejects invalid channel session", () => {
    const state = {
      version: 1,
      agentName: "test-agent",
      channels: {
        "channel-123": {
          sessionId: "",
          lastMessageAt: "2024-01-15T10:30:00.000Z",
        },
      },
    };

    const result = DiscordSessionStateSchema.safeParse(state);

    expect(result.success).toBe(false);
  });

  it("validates multiple channels", () => {
    const state = {
      version: 1,
      agentName: "test-agent",
      channels: {
        "channel-1": {
          sessionId: "session-1",
          lastMessageAt: "2024-01-15T10:30:00.000Z",
        },
        "channel-2": {
          sessionId: "session-2",
          lastMessageAt: "2024-01-15T11:30:00.000Z",
        },
      },
    };

    const result = DiscordSessionStateSchema.safeParse(state);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data.channels)).toHaveLength(2);
    }
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe("createInitialSessionState", () => {
  it("creates initial state with correct values", () => {
    const state = createInitialSessionState("my-agent");

    expect(state.version).toBe(1);
    expect(state.agentName).toBe("my-agent");
    expect(state.channels).toEqual({});
  });

  it("creates valid schema-compliant state", () => {
    const state = createInitialSessionState("test-agent");
    const result = DiscordSessionStateSchema.safeParse(state);

    expect(result.success).toBe(true);
  });
});

describe("createChannelSession", () => {
  it("creates session with provided sessionId", () => {
    const session = createChannelSession("my-session-id");

    expect(session.sessionId).toBe("my-session-id");
    expect(session.lastMessageAt).toBeTruthy();
  });

  it("sets lastMessageAt to current time", () => {
    const before = new Date();
    const session = createChannelSession("test-session");
    const after = new Date();

    const timestamp = new Date(session.lastMessageAt);
    expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("creates valid schema-compliant session", () => {
    const session = createChannelSession("test-session");
    const result = ChannelSessionSchema.safeParse(session);

    expect(result.success).toBe(true);
  });
});
