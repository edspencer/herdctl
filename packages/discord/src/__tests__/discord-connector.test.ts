import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "events";
import type { AgentConfig, AgentChatDiscord, FleetManager } from "@herdctl/core";
import type { ISessionManager } from "../session-manager/index.js";

// =============================================================================
// Mock discord.js - Must be hoisted, factory cannot reference external variables
// =============================================================================

// Shared mock state - these will be accessed by tests
let mockLoginImpl: (() => Promise<string>) | null = null;

// Mock REST EventEmitter for rate limit events
let mockRestEmitter: EventEmitter | null = null;

// Mock discord.js module - factory must be self-contained
vi.mock("discord.js", () => {
  const { EventEmitter } = require("events");

  // Define mock user inside factory
  const mockUser = {
    id: "123456789",
    username: "TestBot",
    discriminator: "0001",
    setActivity: vi.fn(),
  };

  // Define mock client inside factory
  class MockClientClass extends EventEmitter {
    user = mockUser;
    rest = new EventEmitter(); // REST client for rate limit events
    login = vi.fn().mockImplementation(async () => {
      // Use the external mockLoginImpl if set, otherwise return success
      if (mockLoginImpl) {
        return mockLoginImpl();
      }
      return "token";
    });
    destroy = vi.fn();

    constructor() {
      super();
      // Store reference to rest emitter for test access
      mockRestEmitter = this.rest;
    }
  }

  return {
    Client: MockClientClass,
    GatewayIntentBits: {
      Guilds: 1,
      GuildMessages: 2,
      DirectMessages: 4,
      MessageContent: 8,
    },
    Events: {
      ClientReady: "ready",
      ShardDisconnect: "shardDisconnect",
      ShardReconnecting: "shardReconnecting",
      ShardResume: "shardResume",
      Error: "error",
      Warn: "warn",
      Debug: "debug",
    },
  };
});

// Mock @discordjs/rest for RESTEvents constant
vi.mock("@discordjs/rest", () => {
  return {
    RESTEvents: {
      RateLimited: "rateLimited",
    },
  };
});

// Import after mock
import { DiscordConnector } from "../discord-connector.js";
import {
  AlreadyConnectedError,
  DiscordConnectionError,
  InvalidTokenError,
} from "../errors.js";

// Type for our mock client
interface MockClient extends EventEmitter {
  user: {
    id: string;
    username: string;
    discriminator: string;
    setActivity: ReturnType<typeof vi.fn>;
  };
  rest: EventEmitter;
  login: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

// Helper to set the login behavior before connecting
function setMockLoginBehavior(
  behavior: "success" | "failure",
  errorMessage?: string
) {
  if (behavior === "failure") {
    mockLoginImpl = () => Promise.reject(new Error(errorMessage || "Login failed"));
  } else {
    mockLoginImpl = null; // Use default success behavior
  }
}

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockAgentConfig(): AgentConfig {
  return {
    name: "test-agent",
    description: "Test agent for Discord connector tests",
  };
}

function createMockDiscordConfig(): AgentChatDiscord {
  return {
    bot_token_env: "TEST_BOT_TOKEN",
    session_expiry_hours: 24,
    log_level: "standard",
    guilds: [
      {
        id: "guild-123",
        channels: [
          {
            id: "channel-456",
            name: "#test",
            mode: "mention",
            context_messages: 10,
          },
        ],
      },
    ],
  };
}

function createMockFleetManager(): FleetManager {
  return {
    trigger: vi.fn(),
    getFleetStatus: vi.fn(),
  } as unknown as FleetManager;
}

function createMockSessionManager(): ISessionManager {
  return {
    agentName: "test-agent",
    getOrCreateSession: vi.fn().mockResolvedValue({ sessionId: "test-session", isNew: true }),
    touchSession: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn().mockResolvedValue(null),
    clearSession: vi.fn().mockResolvedValue(true),
    cleanupExpiredSessions: vi.fn().mockResolvedValue(0),
    getActiveSessionCount: vi.fn().mockResolvedValue(0),
  };
}

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// =============================================================================
// Constructor Tests
// =============================================================================

describe("DiscordConnector", () => {
  let agentConfig: AgentConfig;
  let discordConfig: AgentChatDiscord;
  let fleetManager: FleetManager;
  let sessionManager: ISessionManager;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    vi.clearAllMocks();
    setMockLoginBehavior("success"); // Reset to success by default
    agentConfig = createMockAgentConfig();
    discordConfig = createMockDiscordConfig();
    fleetManager = createMockFleetManager();
    sessionManager = createMockSessionManager();
    mockLogger = createMockLogger();
  });

  describe("constructor", () => {
    it("creates connector with valid options", () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      expect(connector.agentName).toBe("test-agent");
      expect(connector.isConnected()).toBe(false);
    });

    it("throws InvalidTokenError for empty token", () => {
      expect(
        () =>
          new DiscordConnector({
            agentConfig,
            discordConfig,
            botToken: "",
            fleetManager,
            sessionManager,
          })
      ).toThrow(InvalidTokenError);
    });

    it("throws InvalidTokenError for whitespace-only token", () => {
      expect(
        () =>
          new DiscordConnector({
            agentConfig,
            discordConfig,
            botToken: "   ",
            fleetManager,
            sessionManager,
          })
      ).toThrow(InvalidTokenError);
    });

    it("uses default logger when none provided", () => {
      // Should not throw
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
      });

      expect(connector.agentName).toBe("test-agent");
    });
  });

  // =============================================================================
  // getState Tests
  // =============================================================================

  describe("getState", () => {
    it("returns initial disconnected state", () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const state = connector.getState();

      expect(state.status).toBe("disconnected");
      expect(state.connectedAt).toBeNull();
      expect(state.disconnectedAt).toBeNull();
      expect(state.reconnectAttempts).toBe(0);
      expect(state.lastError).toBeNull();
      expect(state.botUser).toBeNull();
    });
  });

  // =============================================================================
  // connect Tests
  // =============================================================================

  describe("connect", () => {
    it("connects successfully and updates state", async () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const connectPromise = connector.connect();

      // Wait for client to be created
      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      // Get the actual mock client and simulate ready event
      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");

      // Emit ready event
      client.emit("ready", { user: client.user });

      await connectPromise;

      expect(connector.isConnected()).toBe(true);
      const state = connector.getState();
      expect(state.status).toBe("connected");
      expect(state.connectedAt).not.toBeNull();
      expect(state.botUser).toEqual({
        id: "123456789",
        username: "TestBot",
        discriminator: "0001",
      });
    });

    it("emits ready event on successful connection", async () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const readyHandler = vi.fn();
      connector.on("ready", readyHandler);

      const connectPromise = connector.connect();

      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");
      client.emit("ready", { user: client.user });

      await connectPromise;

      // Wait for the async ready handler to complete
      await vi.waitFor(() => {
        expect(readyHandler).toHaveBeenCalled();
      });

      expect(readyHandler).toHaveBeenCalledWith({
        agentName: "test-agent",
        botUser: {
          id: "123456789",
          username: "TestBot",
          discriminator: "0001",
        },
      });
    });

    it("throws AlreadyConnectedError when connecting while connected", async () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      // First connect
      const connectPromise = connector.connect();

      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");
      client.emit("ready", { user: client.user });

      await connectPromise;

      // Try to connect again
      await expect(connector.connect()).rejects.toThrow(AlreadyConnectedError);
    });

    it("throws DiscordConnectionError on login failure", async () => {
      // Set up login to fail BEFORE calling connect
      setMockLoginBehavior("failure", "Invalid token");

      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "invalid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      await expect(connector.connect()).rejects.toThrow(DiscordConnectionError);

      const state = connector.getState();
      expect(state.status).toBe("error");
      expect(state.lastError).toBe("Invalid token");
    });

    it("cleans up client on connection failure", async () => {
      // Set up login to fail BEFORE calling connect
      setMockLoginBehavior("failure", "Invalid token");

      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "invalid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      await expect(connector.connect()).rejects.toThrow(DiscordConnectionError);

      expect(connector.client).toBeNull();
    });
  });

  // =============================================================================
  // disconnect Tests
  // =============================================================================

  describe("disconnect", () => {
    it("disconnects successfully", async () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      // Connect first
      const connectPromise = connector.connect();

      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");
      client.emit("ready", { user: client.user });

      await connectPromise;

      // Now disconnect
      await connector.disconnect();

      expect(connector.isConnected()).toBe(false);
      const state = connector.getState();
      expect(state.status).toBe("disconnected");
      expect(state.disconnectedAt).not.toBeNull();
      expect(state.botUser).toBeNull();
    });

    it("handles disconnect when already disconnected", async () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      // Should not throw
      await connector.disconnect();

      expect(connector.isConnected()).toBe(false);
    });

    it("calls client.destroy() on disconnect", async () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const connectPromise = connector.connect();

      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");
      client.emit("ready", { user: client.user });

      await connectPromise;

      await connector.disconnect();

      expect(client.destroy).toHaveBeenCalled();
    });

    it("handles destroy error gracefully", async () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const connectPromise = connector.connect();

      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");
      client.emit("ready", { user: client.user });

      await connectPromise;

      // Make destroy throw
      client.destroy.mockImplementation(() => {
        throw new Error("Destroy failed");
      });

      // Should not throw
      await connector.disconnect();

      expect(connector.isConnected()).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  // =============================================================================
  // Connection Event Tests
  // =============================================================================

  describe("connection events", () => {
    it("emits disconnect event on shard disconnect", async () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const disconnectHandler = vi.fn();
      connector.on("disconnect", disconnectHandler);

      const connectPromise = connector.connect();

      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");
      client.emit("ready", { user: client.user });

      await connectPromise;

      // Simulate disconnect
      client.emit("shardDisconnect", { code: 1001 });

      expect(disconnectHandler).toHaveBeenCalledWith({
        agentName: "test-agent",
        code: 1001,
        reason: "Shard disconnected",
      });
    });

    it("emits reconnecting event on shard reconnecting", async () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const reconnectingHandler = vi.fn();
      connector.on("reconnecting", reconnectingHandler);

      const connectPromise = connector.connect();

      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");
      client.emit("ready", { user: client.user });

      await connectPromise;

      // Simulate reconnecting
      client.emit("shardReconnecting");

      expect(reconnectingHandler).toHaveBeenCalledWith({
        agentName: "test-agent",
        attempt: 1,
      });

      const state = connector.getState();
      expect(state.status).toBe("reconnecting");
      expect(state.reconnectAttempts).toBe(1);
    });

    it("emits reconnected event on shard resume", async () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const reconnectedHandler = vi.fn();
      connector.on("reconnected", reconnectedHandler);

      const connectPromise = connector.connect();

      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");
      client.emit("ready", { user: client.user });

      await connectPromise;

      // Simulate reconnect cycle
      client.emit("shardReconnecting");
      client.emit("shardResume");

      expect(reconnectedHandler).toHaveBeenCalledWith({
        agentName: "test-agent",
      });

      const state = connector.getState();
      expect(state.status).toBe("connected");
    });

    it("emits error event on client error", async () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const errorHandler = vi.fn();
      connector.on("error", errorHandler);

      const connectPromise = connector.connect();

      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");
      client.emit("ready", { user: client.user });

      await connectPromise;

      // Simulate error
      const testError = new Error("Test error");
      client.emit("error", testError);

      expect(errorHandler).toHaveBeenCalledWith({
        agentName: "test-agent",
        error: testError,
      });

      const state = connector.getState();
      expect(state.lastError).toBe("Test error");
    });

    it("tracks multiple reconnection attempts", async () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const connectPromise = connector.connect();

      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");
      client.emit("ready", { user: client.user });

      await connectPromise;

      // Simulate multiple reconnection attempts
      client.emit("shardReconnecting");
      expect(connector.getState().reconnectAttempts).toBe(1);

      client.emit("shardReconnecting");
      expect(connector.getState().reconnectAttempts).toBe(2);

      client.emit("shardReconnecting");
      expect(connector.getState().reconnectAttempts).toBe(3);
    });
  });

  // =============================================================================
  // Presence Tests
  // =============================================================================

  describe("presence", () => {
    it("sets presence when configured", async () => {
      const configWithPresence: AgentChatDiscord = {
        ...discordConfig,
        presence: {
          activity_type: "watching",
          activity_message: "for support requests",
        },
      };

      const connector = new DiscordConnector({
        agentConfig,
        discordConfig: configWithPresence,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const connectPromise = connector.connect();

      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");
      client.emit("ready", { user: client.user });

      await connectPromise;

      expect(client.user.setActivity).toHaveBeenCalledWith(
        "for support requests",
        {
          type: 3, // watching
        }
      );
    });

    it("does not set presence when not configured", async () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig, // No presence configured
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const connectPromise = connector.connect();

      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");
      client.emit("ready", { user: client.user });

      await connectPromise;

      expect(client.user.setActivity).not.toHaveBeenCalled();
    });
  });

  // =============================================================================
  // Rate Limit Tests
  // =============================================================================

  describe("rate limit handling", () => {
    it("emits rateLimit event when rate limited", async () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const rateLimitHandler = vi.fn();
      connector.on("rateLimit", rateLimitHandler);

      const connectPromise = connector.connect();

      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");
      client.emit("ready", { user: client.user });

      await connectPromise;

      // Simulate rate limit event
      client.rest.emit("rateLimited", {
        timeToReset: 5000,
        limit: 50,
        method: "POST",
        hash: "abc123",
        route: "/channels/123/messages",
        global: false,
      });

      expect(rateLimitHandler).toHaveBeenCalledWith({
        agentName: "test-agent",
        timeToReset: 5000,
        limit: 50,
        method: "POST",
        hash: "abc123",
        route: "/channels/123/messages",
        global: false,
      });
    });

    it("logs rate limit at info level", async () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const connectPromise = connector.connect();

      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");
      client.emit("ready", { user: client.user });

      await connectPromise;

      // Simulate rate limit event
      client.rest.emit("rateLimited", {
        timeToReset: 5000,
        limit: 50,
        method: "POST",
        hash: "abc123",
        route: "/channels/123/messages",
        global: false,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Rate limited by Discord API",
        expect.objectContaining({
          route: "/channels/123/messages",
          method: "POST",
          timeToReset: 5000,
          limit: 50,
          global: false,
          hash: "abc123",
        })
      );
    });

    it("tracks rate limit count in state", async () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const connectPromise = connector.connect();

      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");
      client.emit("ready", { user: client.user });

      await connectPromise;

      // Initial state should have no rate limits
      let state = connector.getState();
      expect(state.rateLimits.totalCount).toBe(0);
      expect(state.rateLimits.lastRateLimitAt).toBeNull();
      expect(state.rateLimits.isRateLimited).toBe(false);

      // Simulate first rate limit
      client.rest.emit("rateLimited", {
        timeToReset: 5000,
        limit: 50,
        method: "POST",
        hash: "abc123",
        route: "/channels/123/messages",
        global: false,
      });

      state = connector.getState();
      expect(state.rateLimits.totalCount).toBe(1);
      expect(state.rateLimits.lastRateLimitAt).not.toBeNull();
      expect(state.rateLimits.isRateLimited).toBe(true);
      expect(state.rateLimits.currentResetTime).toBe(5000);

      // Simulate second rate limit
      client.rest.emit("rateLimited", {
        timeToReset: 3000,
        limit: 50,
        method: "GET",
        hash: "def456",
        route: "/guilds/123",
        global: false,
      });

      state = connector.getState();
      expect(state.rateLimits.totalCount).toBe(2);
      expect(state.rateLimits.currentResetTime).toBe(3000);
    });

    it("clears rate limit status after reset time", async () => {
      vi.useFakeTimers();

      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const connectPromise = connector.connect();

      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");
      client.emit("ready", { user: client.user });

      await connectPromise;

      // Simulate rate limit with 5 second reset
      client.rest.emit("rateLimited", {
        timeToReset: 5000,
        limit: 50,
        method: "POST",
        hash: "abc123",
        route: "/channels/123/messages",
        global: false,
      });

      let state = connector.getState();
      expect(state.rateLimits.isRateLimited).toBe(true);

      // Advance time past the reset
      vi.advanceTimersByTime(5001);

      state = connector.getState();
      expect(state.rateLimits.isRateLimited).toBe(false);
      expect(state.rateLimits.currentResetTime).toBe(0);
      // Total count should still be 1
      expect(state.rateLimits.totalCount).toBe(1);

      vi.useRealTimers();
    });

    it("handles global rate limits", async () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const rateLimitHandler = vi.fn();
      connector.on("rateLimit", rateLimitHandler);

      const connectPromise = connector.connect();

      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");
      client.emit("ready", { user: client.user });

      await connectPromise;

      // Simulate global rate limit
      client.rest.emit("rateLimited", {
        timeToReset: 60000,
        limit: 50,
        method: "POST",
        hash: "global",
        route: "/channels/123/messages",
        global: true,
      });

      expect(rateLimitHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          global: true,
        })
      );
    });

    it("clears rate limit timer on disconnect", async () => {
      vi.useFakeTimers();

      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const connectPromise = connector.connect();

      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");
      client.emit("ready", { user: client.user });

      await connectPromise;

      // Simulate rate limit
      client.rest.emit("rateLimited", {
        timeToReset: 5000,
        limit: 50,
        method: "POST",
        hash: "abc123",
        route: "/channels/123/messages",
        global: false,
      });

      let state = connector.getState();
      expect(state.rateLimits.isRateLimited).toBe(true);

      // Disconnect before timer expires
      await connector.disconnect();

      state = connector.getState();
      expect(state.rateLimits.isRateLimited).toBe(false);
      expect(state.rateLimits.currentResetTime).toBe(0);

      vi.useRealTimers();
    });

    it("returns initial rate limit state before connection", () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const state = connector.getState();

      expect(state.rateLimits).toEqual({
        totalCount: 0,
        lastRateLimitAt: null,
        isRateLimited: false,
        currentResetTime: 0,
      });
    });
  });

  // =============================================================================
  // Message Stats Tests
  // =============================================================================

  describe("message stats", () => {
    it("returns initial message stats before connection", () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const state = connector.getState();

      expect(state.messageStats).toEqual({
        received: 0,
        sent: 0,
        ignored: 0,
      });
    });
  });

  // =============================================================================
  // isConnected Tests
  // =============================================================================

  describe("isConnected", () => {
    it("returns false when disconnected", () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      expect(connector.isConnected()).toBe(false);
    });

    it("returns true when connected", async () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const connectPromise = connector.connect();

      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");
      client.emit("ready", { user: client.user });

      await connectPromise;

      expect(connector.isConnected()).toBe(true);
    });

    it("returns false when reconnecting", async () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      const connectPromise = connector.connect();

      await vi.waitFor(() => {
        expect(connector.client).not.toBeNull();
      });

      const client = connector.client as unknown as MockClient;
      client.login.mockResolvedValue("token");
      client.emit("ready", { user: client.user });

      await connectPromise;

      client.emit("shardReconnecting");

      expect(connector.isConnected()).toBe(false);
    });
  });

  // =============================================================================
  // agentName Tests
  // =============================================================================

  describe("agentName", () => {
    it("returns the agent name from config", () => {
      const connector = new DiscordConnector({
        agentConfig,
        discordConfig,
        botToken: "valid-token",
        fleetManager,
        sessionManager,
        logger: mockLogger,
      });

      expect(connector.agentName).toBe("test-agent");
    });
  });
});
