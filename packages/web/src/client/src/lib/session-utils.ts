import type { DiscoveredSession } from "./types.js";

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
