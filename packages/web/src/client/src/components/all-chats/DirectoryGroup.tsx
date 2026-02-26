/**
 * DirectoryGroup component
 *
 * A collapsible section displaying sessions from a single working directory.
 * Shows agent attribution, session list, and "load more" functionality.
 */

import { ChevronRight, Info } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { agentPath } from "../../lib/paths";
import { sessionMatchesQuery } from "../../lib/session-utils";
import type { DirectoryGroup as DirectoryGroupType } from "../../lib/types";
import { useAllChatsActions } from "../../store";
import { SessionRow } from "./SessionRow";

// =============================================================================
// Types
// =============================================================================

interface DirectoryGroupProps {
  /** The directory group data */
  group: DirectoryGroupType;
  /** Whether the group is expanded */
  expanded: boolean;
  /** Toggle expansion callback */
  onToggle: () => void;
  /** Current search query for filtering */
  searchQuery: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Number of sessions to show before "Show all" button */
const INITIAL_SESSIONS_SHOWN = 10;

// =============================================================================
// Component
// =============================================================================

export function DirectoryGroup({ group, expanded, onToggle, searchQuery }: DirectoryGroupProps) {
  const { loadMoreGroupSessions } = useAllChatsActions();

  // Filter sessions client-side when searching
  const filteredSessions = useMemo(() => {
    if (!searchQuery) return group.sessions;
    return group.sessions.filter((session) => sessionMatchesQuery(session, searchQuery));
  }, [group.sessions, searchQuery]);

  // Determine how many sessions to show
  const sessionsToShow = filteredSessions.slice(0, INITIAL_SESSIONS_SHOWN);
  const hasMoreLoaded = filteredSessions.length > INITIAL_SESSIONS_SHOWN;
  const hasMoreOnServer = group.sessionCount > group.sessions.length;

  // Handle "Show all" click
  const handleShowAll = () => {
    loadMoreGroupSessions(group.encodedPath);
  };

  return (
    <div className="border border-herd-border rounded-[10px] overflow-hidden">
      {/* Clickable header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-herd-hover transition-colors"
      >
        {/* Chevron icon */}
        <ChevronRight
          className={`w-4 h-4 text-herd-muted flex-shrink-0 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />

        {/* Directory path */}
        <span className="flex-1 min-w-0 font-mono text-sm text-herd-fg truncate">
          {group.workingDirectory}
        </span>

        {/* Session count */}
        <span className="flex-shrink-0 text-xs text-herd-muted">
          {group.sessionCount} {group.sessionCount === 1 ? "session" : "sessions"}
        </span>
      </button>

      {/* Agent attribution line */}
      {expanded && (
        <div className="px-4 pb-2 border-b border-herd-border">
          {group.agentName ? (
            <Link
              to={agentPath(group.agentName)}
              className="inline-flex items-center gap-1.5 text-xs text-herd-primary hover:text-herd-primary-hover transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-herd-primary" />
              {group.agentName}
            </Link>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 text-xs text-herd-muted"
              title="Sessions in this directory are not linked to any fleet agent"
            >
              <Info className="w-3 h-3" />
              No matching fleet agent
            </span>
          )}
        </div>
      )}

      {/* Collapsible session list */}
      {expanded && (
        <div className="divide-y divide-herd-border">
          {sessionsToShow.length === 0 ? (
            <div className="px-4 py-3 text-sm text-herd-muted">No sessions match your search</div>
          ) : (
            <>
              {sessionsToShow.map((session) => (
                <SessionRow
                  key={session.sessionId}
                  session={session}
                  agentName={group.agentName}
                  encodedPath={group.encodedPath}
                />
              ))}

              {/* Show more button */}
              {(hasMoreLoaded || hasMoreOnServer) && (
                <div className="px-4 py-2">
                  <button
                    type="button"
                    onClick={handleShowAll}
                    className="text-xs text-herd-primary hover:text-herd-primary-hover transition-colors font-medium"
                  >
                    Show all {group.sessionCount} sessions
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
