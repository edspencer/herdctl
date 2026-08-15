/**
 * chat-slice tests
 *
 * Regression coverage for herdctl#170: fetchChatMessages had no timeout, so a
 * hung API call left the message feed on "Loading messages..." indefinitely.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../lib/api";
import { CHAT_MESSAGES_TIMEOUT_MS } from "../chat-slice";
import { useStore } from "../index";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    fetchChatSession: vi.fn(),
    fetchSessionByPath: vi.fn(),
  };
});

/** Resolve only when the supplied AbortSignal fires — mimics a hung request. */
function hangUntilAborted(_agent: string, _session: string, options?: { signal?: AbortSignal }) {
  return new Promise<never>((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });
}

describe("fetchChatMessages", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.setState({
      chatMessages: [],
      chatMessagesLoading: false,
      chatError: null,
      activeChatSessionId: null,
      activeChatAgent: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("loads messages for a session", async () => {
    vi.mocked(api.fetchChatSession).mockResolvedValue({
      messages: [{ role: "user", content: "hi", timestamp: "2025-01-01T00:00:00Z" }],
    } as Awaited<ReturnType<typeof api.fetchChatSession>>);

    await useStore.getState().fetchChatMessages("coder", "session-1");

    const state = useStore.getState();
    expect(state.chatMessages).toHaveLength(1);
    expect(state.chatMessagesLoading).toBe(false);
    expect(state.chatError).toBeNull();
    expect(state.activeChatSessionId).toBe("session-1");
  });

  it("aborts and surfaces a timeout error when the request hangs (herdctl#170)", async () => {
    vi.mocked(api.fetchChatSession).mockImplementation(hangUntilAborted as never);

    const pending = useStore.getState().fetchChatMessages("coder", "session-1");
    expect(useStore.getState().chatMessagesLoading).toBe(true);

    await vi.advanceTimersByTimeAsync(CHAT_MESSAGES_TIMEOUT_MS + 10);
    await pending;

    const state = useStore.getState();
    expect(state.chatMessagesLoading).toBe(false);
    expect(state.chatError).toMatch(/Timed out loading messages/);
    // The session stays active so the Retry control knows what to re-fetch.
    expect(state.activeChatSessionId).toBe("session-1");
    expect(state.activeChatAgent).toBe("coder");
  });

  it("surfaces the underlying error message when the request fails outright", async () => {
    vi.mocked(api.fetchChatSession).mockRejectedValue(new Error("HTTP 500: boom"));

    await useStore.getState().fetchChatMessages("coder", "session-1");

    expect(useStore.getState().chatError).toBe("HTTP 500: boom");
    expect(useStore.getState().chatMessagesLoading).toBe(false);
  });
});

describe("fetchAdhocChatMessages", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.setState({ chatMessagesLoading: false, chatError: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("times out a hung ad hoc session fetch too", async () => {
    vi.mocked(api.fetchSessionByPath).mockImplementation(hangUntilAborted as never);

    const pending = useStore.getState().fetchAdhocChatMessages("-tmp-project", "session-1");
    await vi.advanceTimersByTimeAsync(CHAT_MESSAGES_TIMEOUT_MS + 10);
    await pending;

    expect(useStore.getState().chatMessagesLoading).toBe(false);
    expect(useStore.getState().chatError).toMatch(/Timed out loading messages/);
  });
});
