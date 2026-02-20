import { describe, expect, it } from "vitest";
import {
  ChannelSessionSchema,
  ChatSessionManager,
  ChatSessionStateSchema,
  createChannelSession,
  createInitialSessionState,
  extractToolResultContent,
  extractToolResults,
  extractToolUseBlocks,
  getToolInputSummary,
  isSessionManagerError,
  SessionDirectoryCreateError,
  SessionErrorCode,
  SessionManagerError,
  SessionStateReadError,
  SessionStateWriteError,
  TOOL_EMOJIS,
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

  it("exports tool parsing utilities", () => {
    expect(extractToolUseBlocks).toBeDefined();
    expect(extractToolResults).toBeDefined();
    expect(extractToolResultContent).toBeDefined();
    expect(getToolInputSummary).toBeDefined();
    expect(TOOL_EMOJIS).toBeDefined();
  });
});
