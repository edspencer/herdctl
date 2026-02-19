/**
 * Tests for chat connector errors
 */

import { describe, it, expect } from "vitest";
import {
  ChatErrorCode,
  ChatConnectorError,
  ChatConnectionError,
  AlreadyConnectedError,
  InvalidTokenError,
  MissingTokenError,
  isChatConnectorError,
  isChatConnectionError,
  isAlreadyConnectedError,
  isInvalidTokenError,
  isMissingTokenError,
} from "../errors.js";

describe("errors", () => {
  describe("ChatErrorCode", () => {
    it("has expected error codes", () => {
      expect(ChatErrorCode.CONNECTION_FAILED).toBe("CHAT_CONNECTION_FAILED");
      expect(ChatErrorCode.ALREADY_CONNECTED).toBe("CHAT_ALREADY_CONNECTED");
      expect(ChatErrorCode.INVALID_TOKEN).toBe("CHAT_INVALID_TOKEN");
      expect(ChatErrorCode.MISSING_TOKEN).toBe("CHAT_MISSING_TOKEN");
    });
  });

  describe("ChatConnectorError", () => {
    it("creates error with message, code, and agentName", () => {
      const error = new ChatConnectorError(
        "Test error",
        ChatErrorCode.CONNECTION_FAILED,
        "test-agent",
      );

      expect(error.message).toBe("Test error");
      expect(error.code).toBe(ChatErrorCode.CONNECTION_FAILED);
      expect(error.agentName).toBe("test-agent");
      expect(error.name).toBe("ChatConnectorError");
    });

    it("supports cause option", () => {
      const cause = new Error("Original error");
      const error = new ChatConnectorError(
        "Wrapper error",
        ChatErrorCode.CONNECTION_FAILED,
        "test-agent",
        { cause },
      );

      expect(error.cause).toBe(cause);
    });

    it("is instance of Error", () => {
      const error = new ChatConnectorError("Test", ChatErrorCode.CONNECTION_FAILED, "agent");
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("ChatConnectionError", () => {
    it("creates formatted connection error message", () => {
      const error = new ChatConnectionError("test-agent", "Connection refused");

      expect(error.message).toBe(
        "Chat connection failed for agent 'test-agent': Connection refused",
      );
      expect(error.code).toBe(ChatErrorCode.CONNECTION_FAILED);
      expect(error.agentName).toBe("test-agent");
      expect(error.name).toBe("ChatConnectionError");
    });

    it("supports cause option", () => {
      const cause = new Error("Network error");
      const error = new ChatConnectionError("agent", "Failed", { cause });

      expect(error.cause).toBe(cause);
    });
  });

  describe("AlreadyConnectedError", () => {
    it("creates formatted already connected error message", () => {
      const error = new AlreadyConnectedError("test-agent");

      expect(error.message).toBe("Chat connector for agent 'test-agent' is already connected");
      expect(error.code).toBe(ChatErrorCode.ALREADY_CONNECTED);
      expect(error.agentName).toBe("test-agent");
      expect(error.name).toBe("AlreadyConnectedError");
    });
  });

  describe("InvalidTokenError", () => {
    it("creates formatted invalid token error message", () => {
      const error = new InvalidTokenError("test-agent", "Token expired");

      expect(error.message).toBe("Invalid chat token for agent 'test-agent': Token expired");
      expect(error.code).toBe(ChatErrorCode.INVALID_TOKEN);
      expect(error.agentName).toBe("test-agent");
      expect(error.name).toBe("InvalidTokenError");
    });
  });

  describe("MissingTokenError", () => {
    it("creates formatted missing token error message", () => {
      const error = new MissingTokenError("test-agent", "BOT_TOKEN");

      expect(error.message).toBe(
        "Missing chat token for agent 'test-agent': environment variable 'BOT_TOKEN' is not set",
      );
      expect(error.code).toBe(ChatErrorCode.MISSING_TOKEN);
      expect(error.agentName).toBe("test-agent");
      expect(error.envVar).toBe("BOT_TOKEN");
      expect(error.name).toBe("MissingTokenError");
    });

    it("supports token type", () => {
      const error = new MissingTokenError("test-agent", "APP_TOKEN", "app");

      expect(error.message).toBe(
        "Missing chat app token for agent 'test-agent': environment variable 'APP_TOKEN' is not set",
      );
      expect(error.tokenType).toBe("app");
    });
  });

  describe("type guards", () => {
    describe("isChatConnectorError", () => {
      it("returns true for ChatConnectorError", () => {
        const error = new ChatConnectorError("Test", ChatErrorCode.CONNECTION_FAILED, "agent");
        expect(isChatConnectorError(error)).toBe(true);
      });

      it("returns true for subclasses", () => {
        expect(isChatConnectorError(new ChatConnectionError("agent", "msg"))).toBe(true);
        expect(isChatConnectorError(new AlreadyConnectedError("agent"))).toBe(true);
        expect(isChatConnectorError(new InvalidTokenError("agent", "reason"))).toBe(true);
        expect(isChatConnectorError(new MissingTokenError("agent", "env"))).toBe(true);
      });

      it("returns false for regular Error", () => {
        expect(isChatConnectorError(new Error("Test"))).toBe(false);
      });

      it("returns false for non-errors", () => {
        expect(isChatConnectorError("string")).toBe(false);
        expect(isChatConnectorError(null)).toBe(false);
        expect(isChatConnectorError(undefined)).toBe(false);
        expect(isChatConnectorError({})).toBe(false);
      });
    });

    describe("isChatConnectionError", () => {
      it("returns true for ChatConnectionError", () => {
        const error = new ChatConnectionError("agent", "msg");
        expect(isChatConnectionError(error)).toBe(true);
      });

      it("returns false for other ChatConnectorError subclasses", () => {
        expect(isChatConnectionError(new AlreadyConnectedError("agent"))).toBe(false);
      });
    });

    describe("isAlreadyConnectedError", () => {
      it("returns true for AlreadyConnectedError", () => {
        const error = new AlreadyConnectedError("agent");
        expect(isAlreadyConnectedError(error)).toBe(true);
      });

      it("returns false for other errors", () => {
        expect(isAlreadyConnectedError(new ChatConnectionError("agent", "msg"))).toBe(false);
      });
    });

    describe("isInvalidTokenError", () => {
      it("returns true for InvalidTokenError", () => {
        const error = new InvalidTokenError("agent", "reason");
        expect(isInvalidTokenError(error)).toBe(true);
      });

      it("returns false for other errors", () => {
        expect(isInvalidTokenError(new MissingTokenError("agent", "env"))).toBe(false);
      });
    });

    describe("isMissingTokenError", () => {
      it("returns true for MissingTokenError", () => {
        const error = new MissingTokenError("agent", "env");
        expect(isMissingTokenError(error)).toBe(true);
      });

      it("returns false for other errors", () => {
        expect(isMissingTokenError(new InvalidTokenError("agent", "reason"))).toBe(false);
      });
    });
  });
});
