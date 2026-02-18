import { describe, it, expect } from "vitest";
import {
  ChatSessionManager,
  ChatSessionStateSchema,
  ChannelSessionSchema,
  SessionErrorCode,
  SessionManagerError,
  SessionStateReadError,
  SessionStateWriteError,
  SessionDirectoryCreateError,
  isSessionManagerError,
  createInitialSessionState,
  createChannelSession,
} from "../index.js";

describe("@herdctl/chat", () => {
  it("exports ChatSessionManager class", () => {
    expect(ChatSessionManager).toBeDefined();
    expect(typeof ChatSessionManager).toBe("function");
  });

  it("exports session schemas", () => {
    expect(ChatSessionStateSchema).toBeDefined();
    expect(ChannelSessionSchema).toBeDefined();
  });

  it("exports session error classes", () => {
    expect(SessionErrorCode).toBeDefined();
    expect(SessionManagerError).toBeDefined();
    expect(SessionStateReadError).toBeDefined();
    expect(SessionStateWriteError).toBeDefined();
    expect(SessionDirectoryCreateError).toBeDefined();
    expect(isSessionManagerError).toBeDefined();
  });

  it("exports factory functions", () => {
    expect(createInitialSessionState).toBeDefined();
    expect(createChannelSession).toBeDefined();
  });
});
