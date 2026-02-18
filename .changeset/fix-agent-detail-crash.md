---
"@herdctl/web": patch
---

Fix white screen crash when clicking agent links in the dashboard.

Multiple bugs were fixed:

1. **useAgentDetail hook**: Now correctly wraps agent data in AgentStartedPayload format `{ agent: agentData }` instead of passing it directly to updateAgent(), which was causing store update failures and type mismatches.

2. **SPA fallback handler**: Now correctly excludes `/assets/` routes from the 404 handler fallback, preventing static assets from being served as HTML.

3. **useJobOutput selector**: Returns a stable empty array reference instead of creating new `[]` on every call, which was causing infinite re-render loops from Zustand warnings.

4. **Dependency array cleanup**: Removed store action functions from useEffect dependency arrays in useFleetStatus, useWebSocket, and useJobOutput since these actions are stable and should not trigger re-runs.
