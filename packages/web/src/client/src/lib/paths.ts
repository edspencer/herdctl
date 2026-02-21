/**
 * Centralized route path builders for the web client.
 *
 * Every in-app link to an agent page should use these helpers so that
 * qualified names are encoded consistently.
 */

/** Route path for an agent's detail / overview page. */
export function agentPath(qualifiedName: string): string {
  return `/agents/${encodeURIComponent(qualifiedName)}`;
}

/** Route path for an agent tab (e.g. "jobs", "output"). */
export function agentTabPath(qualifiedName: string, tab: string): string {
  return `/agents/${encodeURIComponent(qualifiedName)}/${tab}`;
}

/** Route path for agent chat, optionally with a session. */
export function agentChatPath(qualifiedName: string, sessionId?: string): string {
  const base = `/agents/${encodeURIComponent(qualifiedName)}/chat`;
  return sessionId ? `${base}/${encodeURIComponent(sessionId)}` : base;
}
