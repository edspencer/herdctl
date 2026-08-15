import type { DirectoryGroup, DiscoveredSession } from "./types.js";

/**
 * Check if a session matches the search query.
 * Matches against customName, autoName, preview, or agentName.
 */
export function sessionMatchesQuery(session: DiscoveredSession, query: string): boolean {
  const lowerQuery = query.toLowerCase();
  const customName = session.customName?.toLowerCase() ?? "";
  const autoName = session.autoName?.toLowerCase() ?? "";
  const preview = session.preview?.toLowerCase() ?? "";
  const agentName = session.agentName?.toLowerCase() ?? "";

  return (
    customName.includes(lowerQuery) ||
    autoName.includes(lowerQuery) ||
    preview.includes(lowerQuery) ||
    agentName.includes(lowerQuery)
  );
}

/**
 * Check if a directory group's own header matches the search query — i.e. its
 * working directory path or the agent it is attributed to.
 *
 * Kept separate from {@link groupMatchesQuery} so callers can distinguish
 * "this group matched because of what it *is*" (show all of its sessions) from
 * "this group matched because one of its sessions did" (show only the matches).
 */
export function groupHeaderMatchesQuery(group: DirectoryGroup, query: string): boolean {
  const lowerQuery = query.toLowerCase();
  return (
    group.workingDirectory.toLowerCase().includes(lowerQuery) ||
    (group.agentName?.toLowerCase().includes(lowerQuery) ?? false)
  );
}

/**
 * Check if a directory group should survive the search filter.
 *
 * A group matches when its header matches (directory path / agent name) or when
 * at least one of its loaded sessions matches. Groups that match neither are
 * removed entirely, so the page renders a single top-level "no matching
 * sessions" state rather than a list of empty groups.
 */
export function groupMatchesQuery(group: DirectoryGroup, query: string): boolean {
  if (groupHeaderMatchesQuery(group, query)) return true;
  return group.sessions.some((session) => sessionMatchesQuery(session, query));
}
