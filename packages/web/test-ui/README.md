# @herdctl/web UI / integration tests

End-to-end tests that boot the **real** web server against a **real**
`@herdctl/core` `FleetManager` (per-test temp fleet) with a **fake** `claude`
binary on `PATH`, render the React dashboard in a **real** Chromium browser
(Playwright), and click through the actual user journeys. **Zero Anthropic
calls.**

These complement the existing `vitest` unit tests (`src/**/*.test.ts`), which
cover store slices and server routes/handlers in isolation. The tests here cover
the product as a whole: REST + WebSocket + React + the CLI runtime's
session-file machinery.

## How it works

- `harness.ts` writes a temp `herdctl.yaml` + per-agent workspaces, boots a real
  `FleetManager`, then starts the real Fastify server via the package's own
  `createWebServer(...)` (the exact factory the production `WebManager` uses) on
  an ephemeral port.
- `fixtures/bin/claude` is a deterministic stand-in for the real `claude` CLI.
  herdctl's CLI runtime spawns `claude` from `PATH` and then **watches the
  `<sessionId>.jsonl` transcript it writes** under
  `~/.claude/projects/<encoded-cwd>/` — it does not read stdout. So the fake
  writes a real transcript (`user` / `assistant` / `result` lines) in the exact
  location and shape the parser + chat translator consume. This is what makes
  streaming, history, and `--resume` continuity testable. Replies are scripted
  via `HERD_FAKE_SCRIPT` (a JSON file the harness writes from `fakeScript`).
- The harness `realpathSync`s its temp root so macOS's `/var` → `/private/var`
  symlink doesn't desync the configured `working_directory` from the cwd the
  spawned `claude` reports (otherwise the session watcher times out).
- `fixtures.ts` exposes a Playwright `harness` fixture; each test that requests
  it gets a fresh server + fleet and tears it down afterward.

## Running

```bash
# From the repo root or packages/web — build core + web first (the harness
# imports the built dist/server output and @herdctl/core's dist).
pnpm --filter @herdctl/core... build
pnpm --filter @herdctl/web build

# Run the UI/integration suite
pnpm --filter @herdctl/web test:ui

# One file / one test
pnpm --filter @herdctl/web test:ui -- 03-chat
pnpm --filter @herdctl/web test:ui -- -g "resume continuity"
```

Requires the Playwright Chromium browser (`npx playwright install chromium`).

## Journeys covered

| Spec | Journey |
| --- | --- |
| `00-ws-probe` | raw browser WebSocket ping → pong |
| `01-dashboard` | fleet overview, agent cards, nav, connection status, empty states |
| `02-schedules` | schedule list, enable/disable, trigger, empty state |
| `03-chat` | new chat send → stream reply, resume continuity, history replay |
| `04-jobs` | trigger via modal → run → job history + detail |
| `05-agent-detail` | header, tab navigation, not-found |
| `06-theme-and-chrome` | dark/light theme persistence, SPA deep-link, version footer |
| `07-sessions-and-errors` | All Chats listing, empty + API-error states |
