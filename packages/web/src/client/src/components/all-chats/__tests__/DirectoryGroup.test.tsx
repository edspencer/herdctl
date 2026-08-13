/**
 * DirectoryGroup component tests
 *
 * Regression coverage for herdctl#150: the "Show all" button fetched more
 * sessions from the server but the render slice stayed pinned to
 * INITIAL_SESSIONS_SHOWN, so a directory group could never display more than
 * 10 sessions.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryGroup as DirectoryGroupType, DiscoveredSession } from "../../../lib/types";
import { useStore } from "../../../store";
import { DirectoryGroup } from "../DirectoryGroup";

const loadMoreGroupSessions = vi.fn();

function makeSession(index: number, overrides: Partial<DiscoveredSession> = {}): DiscoveredSession {
  return {
    sessionId: `session-${index}`,
    workingDirectory: "/tmp/project",
    mtime: new Date("2025-01-01T00:00:00Z").toISOString(),
    origin: "native",
    agentName: "coder",
    resumable: true,
    customName: `Session ${index}`,
    autoName: undefined,
    preview: `preview ${index}`,
    ...overrides,
  } as DiscoveredSession;
}

function makeGroup(sessionsLoaded: number, sessionCount = sessionsLoaded): DirectoryGroupType {
  return {
    workingDirectory: "/tmp/project",
    encodedPath: "-tmp-project",
    agentName: "coder",
    sessionCount,
    sessions: Array.from({ length: sessionsLoaded }, (_, i) => makeSession(i + 1)),
  };
}

function renderGroup(group: DirectoryGroupType, searchQuery = "") {
  return render(
    <MemoryRouter>
      <DirectoryGroup group={group} expanded onToggle={() => {}} searchQuery={searchQuery} />
    </MemoryRouter>,
  );
}

describe("DirectoryGroup", () => {
  beforeEach(() => {
    loadMoreGroupSessions.mockReset().mockResolvedValue(undefined);
    useStore.setState({ loadMoreGroupSessions });
  });

  it("shows only the first 10 sessions before 'Show all' is clicked", () => {
    renderGroup(makeGroup(25));

    expect(screen.getByText("Session 10")).toBeInTheDocument();
    expect(screen.queryByText("Session 11")).not.toBeInTheDocument();
  });

  it("renders every locally-loaded session after clicking 'Show all' (herdctl#150)", async () => {
    renderGroup(makeGroup(25));

    fireEvent.click(screen.getByRole("button", { name: /Show all 25 sessions/ }));

    await waitFor(() => {
      expect(screen.getByText("Session 25")).toBeInTheDocument();
    });
    expect(screen.getByText("Session 11")).toBeInTheDocument();
    // Everything is loaded and shown, so there is nothing left to fetch.
    expect(loadMoreGroupSessions).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
  });

  it("fetches the next page from the server when the group is only partly loaded", async () => {
    renderGroup(makeGroup(12, 40));

    fireEvent.click(screen.getByRole("button", { name: /Show all 40 sessions/ }));

    await waitFor(() => {
      expect(loadMoreGroupSessions).toHaveBeenCalledWith("-tmp-project");
    });
    // Locally-loaded sessions beyond the initial cap are revealed immediately.
    expect(screen.getByText("Session 12")).toBeInTheDocument();
    // The button stays available because the server still has more.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Load more \(28 remaining\)/ }),
      ).toBeInTheDocument();
    });
  });

  it("shows all sessions of a group whose directory path matches the query", () => {
    renderGroup(makeGroup(3), "project");

    expect(screen.getByText("Session 1")).toBeInTheDocument();
    expect(screen.getByText("Session 3")).toBeInTheDocument();
  });

  it("shows only matching sessions when the group header does not match", () => {
    const group = makeGroup(0);
    group.sessions = [
      makeSession(1, { customName: "alpha" }),
      makeSession(2, { customName: "beta" }),
    ];
    group.sessionCount = 2;

    renderGroup(group, "alpha");

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
  });
});
