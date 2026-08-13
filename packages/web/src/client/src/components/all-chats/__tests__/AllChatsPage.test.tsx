/**
 * AllChatsPage component tests
 *
 * Regression coverage for:
 * - herdctl#145: collapsing a group during an active search immediately
 *   re-expanded it, because `expandedGroups` was in the auto-expand effect's
 *   dependency array and the store always produces a fresh Set on toggle.
 * - herdctl#275: the no-results state must be the single top-level message,
 *   not a per-group one, regardless of how many groups the host machine has.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../lib/api";
import type { DirectoryGroup } from "../../../lib/types";
import { useStore } from "../../../store";
import { AllChatsPage } from "../AllChatsPage";

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return { ...actual, fetchAllSessions: vi.fn() };
});

function makeGroup(name: string, sessionName: string): DirectoryGroup {
  return {
    workingDirectory: `/tmp/${name}`,
    encodedPath: `-tmp-${name}`,
    agentName: name,
    sessionCount: 1,
    sessions: [
      {
        sessionId: `${name}-session`,
        workingDirectory: `/tmp/${name}`,
        mtime: new Date("2025-01-01T00:00:00Z").toISOString(),
        origin: "native",
        agentName: name,
        resumable: true,
        customName: sessionName,
        autoName: undefined,
        preview: undefined,
      },
    ],
  } as DirectoryGroup;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AllChatsPage />
    </MemoryRouter>,
  );
}

describe("AllChatsPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.fetchAllSessions).mockResolvedValue({
      groups: [makeGroup("alpha", "Alpha chat"), makeGroup("beta", "Beta chat")],
      totalGroups: 2,
    });
    useStore.setState({
      allChatsGroups: [],
      allChatsTotalGroups: 0,
      allChatsLoading: false,
      allChatsError: null,
      allChatsSearchQuery: "",
      allChatsExpandedGroups: new Set(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  /** Type into the search box and let the 300ms debounce fire. */
  async function search(query: string) {
    fireEvent.change(screen.getByPlaceholderText(/Search sessions/), { target: { value: query } });
    await vi.advanceTimersByTimeAsync(400);
  }

  it("keeps a group collapsed after the user collapses it during a search (herdctl#145)", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("/tmp/alpha")).toBeInTheDocument());

    await search("chat");
    // Searching auto-expands every group.
    await waitFor(() => expect(screen.getByText("Alpha chat")).toBeInTheDocument());

    // Collapse the alpha group by clicking its header.
    fireEvent.click(screen.getByText("/tmp/alpha"));

    await waitFor(() => {
      expect(screen.queryByText("Alpha chat")).not.toBeInTheDocument();
    });
    // The other group is untouched.
    expect(screen.getByText("Beta chat")).toBeInTheDocument();

    // And it stays collapsed — the effect must not re-expand it on the next render.
    await vi.advanceTimersByTimeAsync(500);
    expect(screen.queryByText("Alpha chat")).not.toBeInTheDocument();
  });

  it("renders the top-level no-results state for an unmatched query (herdctl#275)", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("/tmp/alpha")).toBeInTheDocument());

    await search("zzz-no-such-session-qqq");

    await waitFor(() => {
      expect(screen.getByText("No matching sessions")).toBeInTheDocument();
    });
    // Non-matching groups are dropped entirely rather than rendered empty, so
    // there is never a competing per-group message.
    expect(screen.queryByText("/tmp/alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("/tmp/beta")).not.toBeInTheDocument();
  });

  it("keeps a group whose directory path matches, showing all of its sessions", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("/tmp/alpha")).toBeInTheDocument());

    await search("alpha");

    await waitFor(() => expect(screen.queryByText("/tmp/beta")).not.toBeInTheDocument());
    expect(screen.getByText("/tmp/alpha")).toBeInTheDocument();
    expect(screen.getByText("Alpha chat")).toBeInTheDocument();
  });
});
