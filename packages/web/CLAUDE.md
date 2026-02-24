# @herdctl/web — Package CLAUDE.md

Web dashboard for herdctl fleet management. Vite + React 19 + Tailwind v4, with a Fastify backend serving REST API and WebSocket endpoints.

## Before Writing Any UI Code

**Read `DESIGN_SYSTEM.md` in this directory.** It is the authoritative visual reference. The checklist at the bottom is your pre-commit gate.

## Key Conventions

- **Colors**: Always use `herd-*` tokens (`bg-herd-bg`, `text-herd-fg`, `border-herd-border`, etc.). Never use raw Tailwind colors (`bg-gray-800`) or hex values.
- **Fonts**: IBM Plex Sans (`font-sans`), IBM Plex Mono (`font-mono`), Lora (`font-serif` for chat agent responses). Never use Inter, Roboto, or Arial.
- **Icons**: Lucide React (`lucide-react`), sized `w-4 h-4` (standard) or `w-3.5 h-3.5` (compact).
- **Dark mode**: Handled entirely via CSS custom properties on `:root` / `.dark`. Never use Tailwind's `dark:` prefix in component classes.
- **Border radius**: `rounded-[10px]` for cards/panels, `rounded-lg` for buttons/inputs, `rounded-full` only for circles.
- **State management**: Zustand slices in `src/client/src/store/`.
- **Routing**: React Router v7.

## Package Structure

```
src/
  client/                 # Vite root (index.html lives here)
    src/
      components/
        agent/            # Agent detail, output, tool blocks
        chat/             # Chat view, message feed, composer
        dashboard/        # Fleet dashboard, agent cards
        jobs/             # Job history, detail, trigger modal
        layout/           # AppLayout, Sidebar, Header
        schedules/        # Schedule list
        spotlight/        # Command palette dialog
        ui/               # Reusable primitives (Card, StatusBadge, Toast, Spinner, etc.)
      hooks/              # useFleetStatus, useWebSocket, useAgentDetail, useJobOutput
      lib/                # api client, ws client, types, formatting, theme, paths
      store/              # Zustand slices (fleet, chat, output, toast)
      index.css           # Tailwind imports, @theme tokens, keyframes
  server/                 # Fastify backend
    routes/               # REST endpoints (agents, jobs, fleet, schedules, chat)
    ws/                   # WebSocket handler and fleet bridge
    chat/                 # WebChatManager
```

## Testing

- **Framework**: Vitest with `jsdom` environment for client tests, `node` environment for server tests.
- **Libraries**: `@testing-library/react`, `@testing-library/jest-dom`.
- **Test location**: `__tests__/` directories adjacent to source (currently under `src/server/__tests__/`).
- **Path alias**: `@` maps to `./src/client/src` in tests and source.

## Development Commands

```bash
pnpm dev                  # Runs Vite dev server + server TS watch concurrently
pnpm build                # Builds client (Vite) + server (tsc)
pnpm test                 # Vitest with coverage
pnpm typecheck            # Type-checks both client and server tsconfigs
pnpm lint                 # Biome check
```

The Vite dev server proxies `/api` to `localhost:3232` (Fastify) and `/ws` for WebSocket.
