/**
 * MessageFeed empty-state tests
 *
 * Regression coverage for herdctl#170: an EXISTING session that loaded zero
 * messages showed "Send a message to start the conversation", which reads as
 * "this chat is new" when in fact the transcript could not be read.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../../../store";
import { MessageFeed } from "../MessageFeed";

describe("MessageFeed empty states", () => {
  beforeEach(() => {
    useStore.setState({
      chatMessages: [],
      chatMessagesLoading: false,
      chatStreaming: false,
      chatStreamingContent: "",
      messageGrouping: "separate",
    });
  });

  it("prompts the user to start the conversation for a new chat", () => {
    render(<MessageFeed agentName="coder" />);

    expect(screen.getByText("Send a message to start the conversation")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("reports a missing transcript for an existing session (herdctl#170)", () => {
    render(<MessageFeed agentName="coder" sessionId="session-1" />);

    expect(screen.getByText("No messages found for this session")).toBeInTheDocument();
    expect(screen.queryByText("Send a message to start the conversation")).not.toBeInTheDocument();
  });

  it("offers a retry for an existing session with no messages", () => {
    const onRetry = vi.fn();
    render(<MessageFeed agentName="coder" sessionId="session-1" onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows the loading state while messages are being fetched", () => {
    useStore.setState({ chatMessagesLoading: true });

    render(<MessageFeed agentName="coder" sessionId="session-1" />);

    expect(screen.getByText("Loading messages...")).toBeInTheDocument();
  });
});
