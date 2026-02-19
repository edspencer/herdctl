/**
 * WebSocket handler and type guard tests for @herdctl/web
 *
 * Tests the WebSocket message type guards and handler behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isClientMessage,
  isChatSendMessage,
  isAgentStartedPayload,
  isAgentStoppedPayload,
} from "../ws/types.js";
import { WebSocketHandler } from "../ws/handler.js";

// =============================================================================
// Type Guard Tests
// =============================================================================

describe("isClientMessage", () => {
  it("accepts a valid subscribe message", () => {
    expect(isClientMessage({ type: "subscribe", payload: { agentName: "coder" } })).toBe(true);
  });

  it("accepts a valid unsubscribe message", () => {
    expect(isClientMessage({ type: "unsubscribe", payload: { agentName: "coder" } })).toBe(true);
  });

  it("accepts a valid ping message", () => {
    expect(isClientMessage({ type: "ping" })).toBe(true);
  });

  it("accepts a valid chat:send message", () => {
    expect(
      isClientMessage({
        type: "chat:send",
        payload: {
          agentName: "coder",
          sessionId: "session-1",
          message: "Hello",
        },
      }),
    ).toBe(true);
  });

  it("rejects null", () => {
    expect(isClientMessage(null)).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isClientMessage("string")).toBe(false);
    expect(isClientMessage(42)).toBe(false);
    expect(isClientMessage(undefined)).toBe(false);
  });

  it("rejects object without type", () => {
    expect(isClientMessage({ payload: { agentName: "coder" } })).toBe(false);
  });

  it("rejects unknown type", () => {
    expect(isClientMessage({ type: "unknown" })).toBe(false);
  });

  it("rejects subscribe without agentName", () => {
    expect(isClientMessage({ type: "subscribe", payload: {} })).toBe(false);
    expect(isClientMessage({ type: "subscribe", payload: null })).toBe(false);
    expect(isClientMessage({ type: "subscribe" })).toBe(false);
  });

  it("rejects unsubscribe without agentName", () => {
    expect(isClientMessage({ type: "unsubscribe", payload: {} })).toBe(false);
  });
});

describe("isChatSendMessage", () => {
  it("accepts valid chat:send message", () => {
    expect(
      isChatSendMessage({
        type: "chat:send",
        payload: {
          agentName: "coder",
          sessionId: "session-1",
          message: "Hello",
        },
      }),
    ).toBe(true);
  });

  it("rejects missing payload fields", () => {
    expect(
      isChatSendMessage({
        type: "chat:send",
        payload: { agentName: "coder", sessionId: "session-1" },
      }),
    ).toBe(false);
  });

  it("rejects wrong type", () => {
    expect(
      isChatSendMessage({
        type: "ping",
        payload: {
          agentName: "coder",
          sessionId: "session-1",
          message: "Hello",
        },
      }),
    ).toBe(false);
  });

  it("rejects null payload", () => {
    expect(isChatSendMessage({ type: "chat:send", payload: null })).toBe(false);
  });

  it("rejects non-object", () => {
    expect(isChatSendMessage(null)).toBe(false);
    expect(isChatSendMessage("string")).toBe(false);
  });
});

describe("isAgentStartedPayload", () => {
  it("returns true for started payload", () => {
    expect(
      isAgentStartedPayload({
        agent: { name: "coder", status: "running" },
      } as any),
    ).toBe(true);
  });

  it("returns false for stopped payload", () => {
    expect(
      isAgentStartedPayload({
        agentName: "coder",
        reason: "completed",
      } as any),
    ).toBe(false);
  });
});

describe("isAgentStoppedPayload", () => {
  it("returns true for stopped payload", () => {
    expect(
      isAgentStoppedPayload({
        agentName: "coder",
        reason: "completed",
      } as any),
    ).toBe(true);
  });

  it("returns false for started payload", () => {
    expect(
      isAgentStoppedPayload({
        agent: { name: "coder", status: "running" },
      } as any),
    ).toBe(false);
  });
});

// =============================================================================
// WebSocketHandler Tests
// =============================================================================

describe("WebSocketHandler", () => {
  let mockFleetManager: any;

  beforeEach(() => {
    mockFleetManager = {
      getFleetStatus: vi.fn().mockResolvedValue({
        state: "running",
        counts: { totalAgents: 1 },
      }),
      on: vi.fn(),
      off: vi.fn(),
    };
  });

  it("can be instantiated", () => {
    const handler = new WebSocketHandler(mockFleetManager);
    expect(handler).toBeDefined();
    expect(handler.getConnectedCount()).toBe(0);
  });

  it("reports zero subscribers for unknown agent", () => {
    const handler = new WebSocketHandler(mockFleetManager);
    expect(handler.getSubscriberCount("nonexistent")).toBe(0);
  });

  it("broadcasts to no clients when none connected", () => {
    const handler = new WebSocketHandler(mockFleetManager);
    // Should not throw when broadcasting to empty set
    handler.broadcast({ type: "pong" });
  });

  it("broadcastToSubscribers does not throw with no clients", () => {
    const handler = new WebSocketHandler(mockFleetManager);
    // Should not throw when no one is subscribed
    handler.broadcastToSubscribers("coder", { type: "pong" });
  });

  it("closeAll works on empty handler", () => {
    const handler = new WebSocketHandler(mockFleetManager);
    // Should not throw
    handler.closeAll();
    expect(handler.getConnectedCount()).toBe(0);
  });

  describe("handleConnection", () => {
    it("tracks connected clients", async () => {
      const handler = new WebSocketHandler(mockFleetManager);

      const mockSocket = {
        on: vi.fn(),
        readyState: 1,
        OPEN: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      await handler.handleConnection(mockSocket as any);

      expect(handler.getConnectedCount()).toBe(1);
      expect(mockSocket.on).toHaveBeenCalledWith("message", expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith("close", expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith("error", expect.any(Function));
    });

    it("sends initial fleet status on connection", async () => {
      const handler = new WebSocketHandler(mockFleetManager);

      const mockSocket = {
        on: vi.fn(),
        readyState: 1,
        OPEN: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      await handler.handleConnection(mockSocket as any);

      expect(mockFleetManager.getFleetStatus).toHaveBeenCalled();
      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"fleet:status"'),
      );
    });

    it("handles disconnect", async () => {
      const handler = new WebSocketHandler(mockFleetManager);

      let closeHandler: (() => void) | undefined;
      const mockSocket = {
        on: vi.fn((event: string, cb: any) => {
          if (event === "close") closeHandler = cb;
        }),
        readyState: 1,
        OPEN: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      await handler.handleConnection(mockSocket as any);
      expect(handler.getConnectedCount()).toBe(1);

      // Simulate disconnect
      closeHandler!();
      expect(handler.getConnectedCount()).toBe(0);
    });

    it("handles subscribe and unsubscribe messages", async () => {
      const handler = new WebSocketHandler(mockFleetManager);

      let messageHandler: ((data: any) => void) | undefined;
      const mockSocket = {
        on: vi.fn((event: string, cb: any) => {
          if (event === "message") messageHandler = cb;
        }),
        readyState: 1,
        OPEN: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      await handler.handleConnection(mockSocket as any);

      // Subscribe to an agent
      const subscribeMsg = JSON.stringify({
        type: "subscribe",
        payload: { agentName: "coder" },
      });
      messageHandler!(Buffer.from(subscribeMsg));
      expect(handler.getSubscriberCount("coder")).toBe(1);

      // Unsubscribe from the agent
      const unsubscribeMsg = JSON.stringify({
        type: "unsubscribe",
        payload: { agentName: "coder" },
      });
      messageHandler!(Buffer.from(unsubscribeMsg));
      expect(handler.getSubscriberCount("coder")).toBe(0);
    });

    it("responds to ping with pong", async () => {
      const handler = new WebSocketHandler(mockFleetManager);

      let messageHandler: ((data: any) => void) | undefined;
      const mockSocket = {
        on: vi.fn((event: string, cb: any) => {
          if (event === "message") messageHandler = cb;
        }),
        readyState: 1,
        OPEN: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      await handler.handleConnection(mockSocket as any);

      // Clear the initial fleet:status send
      mockSocket.send.mockClear();

      const pingMsg = JSON.stringify({ type: "ping" });
      messageHandler!(Buffer.from(pingMsg));

      expect(mockSocket.send).toHaveBeenCalledWith(JSON.stringify({ type: "pong" }));
    });

    it("ignores invalid JSON messages", async () => {
      const handler = new WebSocketHandler(mockFleetManager);

      let messageHandler: ((data: any) => void) | undefined;
      const mockSocket = {
        on: vi.fn((event: string, cb: any) => {
          if (event === "message") messageHandler = cb;
        }),
        readyState: 1,
        OPEN: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      await handler.handleConnection(mockSocket as any);
      mockSocket.send.mockClear();

      // Should not throw on invalid JSON
      messageHandler!(Buffer.from("not valid json"));
      expect(mockSocket.send).not.toHaveBeenCalled();
    });

    it("ignores unknown message types", async () => {
      const handler = new WebSocketHandler(mockFleetManager);

      let messageHandler: ((data: any) => void) | undefined;
      const mockSocket = {
        on: vi.fn((event: string, cb: any) => {
          if (event === "message") messageHandler = cb;
        }),
        readyState: 1,
        OPEN: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      await handler.handleConnection(mockSocket as any);
      mockSocket.send.mockClear();

      // Should not throw on unknown type (it's just filtered out)
      messageHandler!(Buffer.from(JSON.stringify({ type: "unknown" })));
      expect(mockSocket.send).not.toHaveBeenCalled();
    });
  });

  describe("broadcast", () => {
    it("sends message to all connected clients", async () => {
      const handler = new WebSocketHandler(mockFleetManager);

      const socket1 = {
        on: vi.fn(),
        readyState: 1,
        OPEN: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      const socket2 = {
        on: vi.fn(),
        readyState: 1,
        OPEN: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      await handler.handleConnection(socket1 as any);
      await handler.handleConnection(socket2 as any);
      expect(handler.getConnectedCount()).toBe(2);

      socket1.send.mockClear();
      socket2.send.mockClear();

      handler.broadcast({ type: "pong" });

      expect(socket1.send).toHaveBeenCalledWith(JSON.stringify({ type: "pong" }));
      expect(socket2.send).toHaveBeenCalledWith(JSON.stringify({ type: "pong" }));
    });
  });

  describe("broadcastToSubscribers", () => {
    it("sends message only to subscribed clients", async () => {
      const handler = new WebSocketHandler(mockFleetManager);

      let messageHandler1: ((data: any) => void) | undefined;
      const socket1 = {
        on: vi.fn((event: string, cb: any) => {
          if (event === "message") messageHandler1 = cb;
        }),
        readyState: 1,
        OPEN: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      const socket2 = {
        on: vi.fn(),
        readyState: 1,
        OPEN: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      await handler.handleConnection(socket1 as any);
      await handler.handleConnection(socket2 as any);

      // Subscribe socket1 to "coder"
      messageHandler1!(
        Buffer.from(JSON.stringify({ type: "subscribe", payload: { agentName: "coder" } })),
      );

      socket1.send.mockClear();
      socket2.send.mockClear();

      handler.broadcastToSubscribers("coder", { type: "pong" });

      // socket1 subscribed, should receive
      expect(socket1.send).toHaveBeenCalledWith(JSON.stringify({ type: "pong" }));
      // socket2 not subscribed, should not receive
      expect(socket2.send).not.toHaveBeenCalled();
    });
  });

  describe("closeAll", () => {
    it("closes all connected clients", async () => {
      const handler = new WebSocketHandler(mockFleetManager);

      const socket1 = {
        on: vi.fn(),
        readyState: 1,
        OPEN: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      const socket2 = {
        on: vi.fn(),
        readyState: 1,
        OPEN: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      await handler.handleConnection(socket1 as any);
      await handler.handleConnection(socket2 as any);
      expect(handler.getConnectedCount()).toBe(2);

      handler.closeAll();

      expect(socket1.close).toHaveBeenCalledWith(1000, "Server shutting down");
      expect(socket2.close).toHaveBeenCalledWith(1000, "Server shutting down");
      expect(handler.getConnectedCount()).toBe(0);
    });
  });
});
