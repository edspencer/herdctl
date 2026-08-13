/**
 * AllChatsPage component tests
 *
 * Regression coverage for herdctl#145: collapsing a group during an active
 * search immediately re-expanded it, because `expandedGroups` was in the
 * auto-expand effect's dependency array and the store always produces a fresh
 * Set on toggle.
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
});
