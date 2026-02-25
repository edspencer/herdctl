---
title: Web Dashboard
description: React frontend architecture, component hierarchy, state management, real-time updates, sidebar design, and chat integration in @herdctl/web
---

The `@herdctl/web` package provides a browser-based dashboard for monitoring and interacting with a herdctl fleet. It consists of two halves: a **Fastify server** that provides the REST API and WebSocket endpoints (covered in [HTTP API](/architecture/http-api/)), and a **React single-page application** that renders the dashboard UI. This page covers the React frontend architecture -- components, state management, real-time data flow, and the design system.

For the server-side architecture (REST endpoints, WebSocket protocol, FleetBridge, WebManager lifecycle), see the [HTTP API](/architecture/http-api/) page.

## Where It Fits

The web dashboard is one of four interaction layers in herdctl. Like the [CLI](/architecture/cli/), Discord, and Slack connectors, it is a thin client over [FleetManager](/architecture/overview/). The dashboard adds HTTP routing, WebSocket transport, and React rendering, but contains no business logic of its own.

<img src="/diagrams/package-dependencies.svg" alt="Package dependency graph showing @herdctl/web depending on @herdctl/core and @herdctl/chat" width="100%" />

`@herdctl/web` depends on `@herdctl/core` for fleet management APIs and on `@herdctl/chat` for shared chat infrastructure (session management, streaming response handling, message extraction).

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Build tool** | Vite | 6.x |
| **Frontend framework** | React | 19 |
| **CSS framework** | Tailwind CSS | 4.x (CSS-native `@theme` config) |
| **State management** | Zustand | 5.x |
| **Routing** | React Router | 7.x |
| **Resizable panels** | react-resizable-panels | 2.x |
| **Markdown rendering** | react-markdown + remark-gfm | 10.x / 4.x |
| **Icons** | Lucide React | 0.475+ |
| **Avatar generation** | DiceBear (Bottts style) | 9.x |
| **Server framework** | Fastify | 5.x |
| **WebSocket** | @fastify/websocket (wraps ws) | 11.x |

Vite was chosen over Next.js because the dashboard is a localhost SPA with no SEO requirements, no server-side rendering needs, and full control of the server is required for WebSocket integration. Vite produces static files that Fastify serves directly.

## Source Code Layout

```text
packages/web/
  src/
    server/                          # Backend (Fastify + WebSocket)
      index.ts                       # createWebServer() factory, WebManager class
      chat/
        index.ts                     # Re-exports
        web-chat-manager.ts          # WebChatManager: session lifecycle, message handling
      routes/
        fleet.ts                     # GET /api/fleet/status
        agents.ts                    # GET /api/agents, GET /api/agents/:name
        jobs.ts                      # GET /api/jobs, POST /api/jobs/:id/cancel|fork
        schedules.ts                 # GET /api/schedules, POST enable/disable/trigger
        chat.ts                      # Chat session CRUD, discovery endpoints, ad hoc sessions
      ws/
        handler.ts                   # WebSocketHandler: client management, message routing
        fleet-bridge.ts              # FleetBridge: FleetManager events -> WebSocket broadcast
        types.ts                     # ClientMessage, ServerMessage type definitions
    client/                          # Frontend (React SPA)
      index.html                     # Vite entry point
      src/
        main.tsx                     # React mount point
        index.css                    # Tailwind imports, @theme tokens, keyframes
        App.tsx                      # Root component: routing, WebSocket init, Spotlight
        components/
          layout/                    # Shell: AppLayout, Sidebar, Header, tabs, search
          dashboard/                 # Fleet overview: AgentCard, RecentJobs, FleetDashboard
          agent/                     # Agent detail: tabs, output, jobs, config, chats
          all-chats/                 # All Chats page: AllChatsPage, DirectoryGroup, SessionRow, ReadOnlySessionView
          chat/                      # Chat interface: ChatView, AdhocChatView, MessageFeed, Composer
          jobs/                      # Job history, job detail, trigger modal
          schedules/                 # Schedule list
          spotlight/                 # Cmd+K agent picker dialog
          ui/                        # Shared primitives: Card, StatusBadge, Spinner, Toast
        store/                       # Zustand store with slices
          index.ts                   # Combined store + selector hooks
          fleet-slice.ts             # Fleet status, agents, recent jobs, connection state
          ui-slice.ts                # Sidebar, theme, spotlight, active view
          output-slice.ts            # Live job output messages
          jobs-slice.ts              # Job history with pagination and filtering
          chat-slice.ts              # Chat sessions, messages, streaming state, ad hoc sessions
          all-chats-slice.ts         # All Chats page: directory groups, search, expansion state
          schedule-slice.ts          # Schedule list and actions
          toast-slice.ts             # Toast notification queue
        hooks/
          useWebSocket.ts            # WebSocket init + message dispatch to store
          useFleetStatus.ts          # Initial REST fetch of fleet status
          useAgentDetail.ts          # Agent data loading for detail view
          useJobOutput.ts            # Subscribe/unsubscribe to agent output
        lib/
          api.ts                     # Typed REST client (fetch-based)
          ws.ts                      # WebSocket client with auto-reconnect
          types.ts                   # Client-side type definitions
          paths.ts                   # Route path helpers
          avatar.ts                  # DiceBear avatar generation
          format.ts                  # Relative time, duration formatting
          theme.ts                   # Dark/light/system theme management
  package.json
  vite.config.ts
  tsconfig.server.json               # Server TypeScript config
  tsconfig.client.json               # Client TypeScript config
  DESIGN_SYSTEM.md                   # Visual design system reference
```

The build produces two outputs:

- **Client**: Vite builds to `dist/client/` (static HTML, JS, CSS assets)
- **Server**: TypeScript compiles to `dist/server/` (Node.js modules)

The npm package ships both. Fastify serves the pre-built client assets via `@fastify/static`, so consumers do not need a separate build step.

## Application Routing

The React SPA uses React Router for client-side routing. Fastify's SPA fallback handler serves `index.html` for any non-API, non-WebSocket, non-asset path, allowing React Router to handle navigation.

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | `FleetDashboard` | Fleet overview with agent cards and recent jobs |
| `/agents/:name` | `AgentDetail` | Agent detail (Overview tab by default) |
| `/agents/:name/:tab` | `AgentDetail` | Agent detail with specific tab (overview, chats, jobs, output) |
| `/agents/:name/chat` | `ChatView` | Chat session list for an agent |
| `/agents/:name/chat/:sessionId` | `ChatView` | Active chat conversation |
| `/jobs` | `JobHistory` | Fleet-wide job history with filtering and pagination |
| `/schedules` | `ScheduleList` | All schedules across all agents |
| `/chats` | `AllChatsPage` | Machine-wide session discovery across all working directories |
| `/chats/:encodedPath/:sessionId` | `ReadOnlySessionView` | Read-only view of an unattributed session |
| `/adhoc/:encodedPath/chat/:sessionId` | `AdhocChatView` | Interactive ad hoc chat on a native CLI session |

The `:name` parameter accepts qualified agent names (e.g., `herdctl.security-auditor`). The `:encodedPath` parameter is a URL-safe encoding of a working directory path (slashes replaced with dashes). Route path helper functions in `lib/paths.ts` generate these paths consistently across the application.

## Component Architecture

### Layout Shell

The layout is a three-panel structure built with `react-resizable-panels`:

```text
+------------------+----------------------------------+------------------+
|                  |                                  |                  |
|  LEFT SIDEBAR    |  MAIN CONTENT                   |  DETAIL PANEL    |
|  (~260px)        |  (flexible)                      |  (~280px)        |
|  Resizable       |                                  |  Toggleable      |
|  Collapsible     |  Header + ConnectionStatus       |                  |
|                  |  + routed page content            |                  |
+------------------+----------------------------------+------------------+
```

`AppLayout` is the root layout component. It renders three `Panel` components inside a horizontal `PanelGroup`:

- **Left sidebar**: Fixed minimum width, resizable, collapsible. Hidden on mobile with a slide-in drawer and backdrop overlay.
- **Main content**: Flexible width (`min-w-0`). Contains the `Header`, `ConnectionStatus` banner, and routed page content.
- **Right detail panel**: Toggleable, hidden by default on small screens. Reserved for contextual agent information.

The app fills the viewport exactly (`h-dvh` on the root). Scrolling occurs only within content areas, not the shell.

### Sidebar Architecture

The sidebar is the primary navigation surface. It contains five sections stacked vertically:

1. **Header** -- herdctl logo with connection status indicator
2. **Tab switcher** -- Two-tab toggle: Fleet and Chats
3. **Scrollable content** -- Switches between Fleet View and Recent Conversations based on active tab
4. **Navigation links** -- Dashboard, Jobs, Schedules
5. **Footer** -- Quick stats bar (running/idle/error counts) and version display

#### Tabbed Views

The `SidebarTabs` component renders a compact two-tab toggle. The active tab is stored in the Zustand UI slice as `sidebarTab: "fleet" | "recent"` and persists across navigations within the session.

**Fleet View** renders a hierarchical agent tree via `buildFleetTree()`. Agents are grouped by fleet path segments (e.g., a fleet named `herdctl` containing agents `security-auditor` and `docs-writer`). Single-fleet configurations render a flat list with no grouping. Each agent row shows:

- DiceBear avatar, agent name, status dot
- Up to 5 recent chat sessions with timestamps
- Inline session actions: rename (pencil icon) and delete (trash icon with two-step confirmation)
- Expand/collapse state persisted to `localStorage`

Fleet View includes a search input (`SidebarSearch`) that filters agents by name and fleet name (case-insensitive substring match, client-side).

**Chats View** (`RecentConversationsList`) shows a flat, chronological list of the most recent 100 conversations across all agents. Data comes from `GET /api/chat/recent`. Each item shows the agent avatar, agent name, conversation name (custom name or preview text), and a relative timestamp. Clicking navigates to the chat session. The same inline rename/delete actions are available.

Chats View also has a search input filtering conversations by name, preview text, or agent name.

#### Spotlight Dialog

The `SpotlightDialog` is a Cmd+K / Ctrl+K overlay for quickly starting a new chat with any agent. It renders as a portal overlay with:

- Auto-focused search input
- Filtered agent list with keyboard navigation (Arrow Up/Down, Enter, Escape)
- Status dots showing each agent's current state
- Pre-selection of the most recently active agent (derived from the recent conversations list)

Selecting an agent calls `POST /api/chat/:agentName/sessions` to create a session, then navigates to the new chat URL. The dialog includes focus trapping (Tab/Shift+Tab cycle within the dialog) and enter/exit animations (150ms backdrop fade and panel slide).

### Fleet Dashboard

`FleetDashboard` is the landing page. It renders:

- **Agent card grid** (`AgentCard`) -- Responsive grid (1-3 columns based on viewport). Each card shows the agent name, description, status badge, current job info or idle state with next scheduled run, and connector badges (Discord/Slack/Web). Cards link to the agent detail view.
- **Recent jobs table** (`RecentJobs`) -- The 10 most recent jobs across all agents, showing agent name, status badge, duration, and relative timestamp.

### Agent Detail View

`AgentDetail` is the per-agent page. It uses a URL-based tab bar with four tabs:

| Tab | Component | Description |
|-----|-----------|-------------|
| Overview | `AgentConfig` | Agent configuration display (model, working directory, schedules, connectors) |
| Chats | `AgentChats` | Chat session list for this agent with new-chat creation |
| Jobs | `AgentJobs` | Paginated job history filtered to this agent |
| Output | `AgentOutput` | Live streaming output from the agent's current or most recent job |

The `AgentHeader` component sits above the tab bar, showing the agent name, status badge, model, working directory, and action buttons (Trigger, Chat).

### Chat Interface

`ChatView` provides the interactive chat experience. When a `sessionId` is present in the URL, it renders:

- **MessageFeed** -- Scrollable message list with auto-scroll to bottom on new messages. User messages display right-aligned in `herd-user-bubble` colored bubbles. Agent responses display left-aligned with serif font (Lora) and full markdown rendering. Tool call results render as collapsible `ToolBlock` components with tool-type icons, input summaries, and output.
- **Composer** -- Bottom-pinned text input with send button. Enter sends, Shift+Enter inserts a newline. The input disables while the agent is responding. Placeholder text reads "Send a message to {agent name}..."

When no session is selected, `ChatView` shows the session list with a "Start New Chat" button.

Chat messages stream in real time via WebSocket. The user sends a `chat:send` message, and the server streams back `chat:response` chunks (text), `chat:tool_call` results (structured tool call data), `chat:message_boundary` signals (separating distinct assistant turns), and a final `chat:complete` or `chat:error`.

### All Chats Page

`AllChatsPage` provides machine-wide session discovery. Unlike the sidebar's Chats View (which shows only recent agent-attributed sessions), the All Chats page shows every Claude Code session found across all working directories on the machine, including sessions that were never started through herdctl.

Sessions are grouped by working directory using `DirectoryGroup` components. Each group displays as a collapsible section with the directory path as its header. Within each group, individual sessions render as `SessionRow` components showing the session ID, timestamp, origin badge, and preview text.

Sessions have three possible origins, displayed via the `OriginBadge` component:

| Origin | Meaning |
|--------|---------|
| `herdctl` | Session created by a herdctl fleet agent via `FleetManager.trigger()` |
| `native` | Session created by the Claude Code CLI directly (`claude` command), not through herdctl |
| `ad hoc` | A native session that has been resumed interactively through the web dashboard |

The origin is determined by the `SessionDiscoveryService` in `@herdctl/core`, which checks attribution data stored by `ChatSessionManager` during session creation.

#### Read-Only and Ad Hoc Session Views

Clicking a native (unattributed) session in the All Chats page opens a `ReadOnlySessionView` at `/chats/:encodedPath/:sessionId`. This view fetches the session's JSONL messages via `GET /api/chat/sessions/by-path/:encodedPath/:sessionId` and renders them in a non-interactive `MessageFeed`. Session metadata (git branch, Claude Code version) is displayed when available.

From the read-only view, users can start an ad hoc chat, which navigates to `AdhocChatView` at `/adhoc/:encodedPath/chat/:sessionId`. The ad hoc view provides full interactive chat (with `Composer` for message input and streaming `MessageFeed` for responses) by resuming the native session. On the server side, ad hoc sessions bypass `FleetManager.trigger()` and use `RuntimeFactory` + `JobExecutor` directly, creating a minimal synthetic `ResolvedAgent` with CLI runtime that executes `claude --resume <sessionId>` in the session's working directory.

The WebSocket protocol distinguishes ad hoc sessions by using `agentName: "__adhoc__"` and including a `workingDirectory` field in the `chat:send` payload. The server routes these messages to `WebChatManager.sendAdhocMessage()` instead of the standard `sendMessage()` path.

### Output Streaming

The `AgentOutput` and `JobOutput` components render live job output. When a user navigates to an agent's Output tab, the `useJobOutput` hook sends a WebSocket `subscribe` message for that agent. The FleetBridge then forwards `job:output` events for that agent only (see [Subscription-Based Filtering](/architecture/http-api/#subscription-based-filtering)).

Output messages are discriminated by type:

| Output Type | Rendering |
|-------------|-----------|
| `assistant` | Markdown via `MarkdownRenderer` (react-markdown + remark-gfm) |
| `tool` | Collapsible `ToolBlock` with tool-type icon and expandable body |
| `system` | Styled system message in muted text |
| `stdout` / `stderr` | Monospace pre block (`font-mono`, `herd-code-bg` / `herd-code-fg`) |

The output container auto-scrolls to the bottom while streaming. Leaving the page sends an `unsubscribe` message to stop receiving output events.

### Shared UI Primitives

Reusable components in `components/ui/` enforce visual consistency:

| Component | Purpose |
|-----------|---------|
| `Card` | Container with `bg-herd-card`, border, `rounded-[10px]`, padding |
| `StatusBadge` | Status dot + label using `herd-status-*` color tokens |
| `Spinner` | Loading indicator (`animate-spin`) |
| `ConnectionBanner` | Banner shown when WebSocket is disconnected or reconnecting |
| `ConnectionStatus` | Inline connection indicator in the header |
| `TimeAgo` | Relative time display (e.g., "2m ago") |
| `Toast` / `ToastContainer` | Toast notification system for action feedback |
| `OriginBadge` | Session origin indicator (herdctl/native/ad hoc) with color-coded styling |
| `ErrorBoundary` | React error boundary at layout and page levels |

## State Management

The application uses a single Zustand store composed of eight slices. There is no Redux, MobX, or other external state library.

### Store Slices

| Slice | Key State | Purpose |
|-------|-----------|---------|
| `fleet-slice` | `fleetStatus`, `agents`, `recentJobs`, `connectionStatus` | Fleet-wide data from REST and WebSocket |
| `ui-slice` | `sidebarCollapsed`, `sidebarTab`, `spotlightOpen`, `theme`, `selectedAgent` | UI chrome state |
| `output-slice` | `outputsByJob` (Map of job ID to output messages) | Live streaming output per job |
| `jobs-slice` | `jobs`, `totalJobs`, `jobsFilter`, pagination state | Job history with filtering |
| `chat-slice` | `chatSessions`, `chatMessages`, `chatStreaming`, `sidebarSessions`, `recentSessions` | Chat sessions, messages, streaming state, ad hoc session support |
| `all-chats-slice` | `allChatsGroups`, `allChatsSearchQuery`, `allChatsExpandedGroups` | All Chats page: directory groups, search filtering, expand/collapse |
| `schedule-slice` | `schedules`, loading/error state | Schedule list and actions |
| `toast-slice` | `toasts` queue | Toast notification lifecycle |

### Selector Hooks

The store exports focused selector hooks that use `useShallow` to prevent unnecessary re-renders:

```typescript
// Select fleet data (only re-renders when fleet data changes)
const { agents, connectionStatus } = useFleet();

// Select a single agent by name
const agent = useAgent("herdctl.security-auditor");

// Select UI actions (stable references, never re-renders)
const { setSidebarTab, setSpotlightOpen } = useUIActions();

// Select chat messages (only re-renders when chat state changes)
const { chatMessages, chatStreaming } = useChatMessages();
```

### Data Flow

State enters the store from two sources:

1. **REST API** -- Initial data on page load. The `useFleetStatus` hook fetches fleet status on mount. Individual pages fetch their data (agents, jobs, schedules, chat sessions) via the typed API client in `lib/api.ts`.

2. **WebSocket** -- Real-time updates after initial load. The `useWebSocket` hook initializes a WebSocket connection on mount and dispatches incoming messages to the store.

## Real-Time Update Pipeline

The real-time data flow follows a pipeline from FleetManager events through to React component re-renders:

```text
FleetManager events
       |
       v
  FleetBridge                 (server: subscribes to FM events)
       |
       v
  WebSocketHandler.broadcast  (server: sends JSON to connected clients)
       |
       v
  WebSocket client (ws.ts)    (browser: parses JSON, calls onMessage)
       |
       v
  useWebSocket hook           (browser: dispatches to Zustand store)
       |
       v
  Zustand store slices        (browser: update state, notify selectors)
       |
       v
  React components            (browser: re-render with new data)
```

### WebSocket Client

The WebSocket client (`lib/ws.ts`) provides:

- **Auto-connect** on creation
- **Auto-reconnect** with exponential backoff (starting at 1 second, max 30 seconds)
- **Keepalive pings** every 30 seconds to detect stale connections
- **Connection state tracking** (`connected` / `disconnected` / `reconnecting`)
- **Typed message interface** -- `send()`, `subscribe()`, `unsubscribe()`, `disconnect()`

On initial connection, the server sends a `fleet:status` snapshot that populates the entire fleet state. After that, incremental updates flow through individual event messages.

On reconnect after a disconnection, the client receives a fresh `fleet:status` snapshot to resync any state that may have changed while disconnected. The REST API serves as the authoritative source of truth; WebSocket events are an optimization for real-time incremental updates.

### Event Handling in the Store

The `useWebSocket` hook receives parsed `ServerMessage` objects and dispatches them to the appropriate store slice:

| Message Type | Store Action | Effect |
|-------------|-------------|--------|
| `fleet:status` | `setFleetStatus`, `setAgents`, `setRecentJobs` | Full state replacement |
| `agent:updated` | `updateAgent` | Update single agent in list |
| `job:created` | `addJob` | Add to recent jobs, update agent's current job |
| `job:completed` | `completeJob` | Update agent status, move job to history |
| `job:failed` | `failJob` | Update agent status, record error |
| `job:cancelled` | `cancelJob` | Update agent status |
| `job:output` | `appendOutput` | Append to output buffer for the job |
| `schedule:triggered` | `updateScheduleFromWS` | Update schedule last run time |
| `chat:response` | `appendStreamingChunk` | Append text to streaming buffer |
| `chat:tool_call` | (handled in chat slice) | Add tool call to message list |
| `chat:message_boundary` | `flushStreamingMessage` | Flush accumulated text as a separate message |
| `chat:complete` | `completeStreaming` | Finalize chat response |
| `chat:error` | `setChatError` | Display error in chat UI |

The `chat:*` message types are shared between agent-attributed sessions and ad hoc sessions. The `WebSocketHandler` routes `chat:send` messages based on the `agentName` field: when `agentName` is `"__adhoc__"`, the message is dispatched to `WebChatManager.sendAdhocMessage()` with the `workingDirectory` from the payload; otherwise, it follows the standard `WebChatManager.sendMessage()` path through FleetManager. Response messages (`chat:response`, `chat:tool_call`, `chat:message_boundary`, `chat:complete`) use `agentName: "__adhoc__"` for ad hoc sessions so the frontend can route them to the correct view.

## API Layer

The REST API client (`lib/api.ts`) provides typed functions for every endpoint. It uses the browser's native `fetch` API with typed request/response generics.

```typescript
// Typed fetch with error handling
const status = await fetchFleetStatus();        // GET /api/fleet/status
const agents = await fetchAgents();             // GET /api/agents
const agent = await fetchAgent("my-agent");     // GET /api/agents/:name
const jobs = await fetchJobs({ limit: 20 });    // GET /api/jobs?limit=20
const schedules = await fetchSchedules();       // GET /api/schedules
```

The base URL defaults to `window.location.origin`, so in production (where Fastify serves both the SPA and the API) no configuration is needed. In development, Vite's proxy forwards `/api/*` to the Fastify dev server.

API errors throw an `ApiError` class with `status`, `statusText`, and the extracted error message from the response body. Store slices catch these errors and surface them in the UI via error state fields or toast notifications.

### Chat API

Chat operations use a combination of REST and WebSocket:

| Operation | Transport | Endpoint |
|-----------|-----------|----------|
| List sessions (per agent) | REST | `GET /api/chat/:agentName/sessions` |
| List recent (cross-agent) | REST | `GET /api/chat/recent` |
| List all (grouped by directory) | REST | `GET /api/chat/all` |
| Expand a directory group | REST | `GET /api/chat/all/:encodedPath` |
| Get session + messages (agent) | REST | `GET /api/chat/:agentName/sessions/:sessionId` |
| Get session + messages (by path) | REST | `GET /api/chat/sessions/by-path/:encodedPath/:sessionId` |
| Get session usage (agent) | REST | `GET /api/chat/:agentName/sessions/:sessionId/usage` |
| Get session usage (by path) | REST | `GET /api/chat/sessions/by-path/:encodedPath/:sessionId/usage` |
| Rename session | REST | `PATCH /api/chat/:agentName/sessions/:sessionId` |
| Send message (streaming) | WebSocket | `chat:send` message |
| Send ad hoc message (streaming) | WebSocket | `chat:send` message (with `agentName: "__adhoc__"`) |
| Get chat config | REST | `GET /api/chat/config` |
| Send message (non-streaming) | REST | `POST /api/chat/:agentName/messages` |

Session lifecycle is managed via REST. Message sending uses WebSocket for real-time streaming. The `chat:send` WebSocket message triggers `WebChatManager.sendMessage()`, which creates a FleetManager job with `triggerType: "web"` and streams the response back through callbacks that the `WebSocketHandler` relays to the requesting client.

The API has two addressing schemes for sessions:

1. **Agent-scoped** (`/api/chat/:agentName/sessions/:sessionId`) -- for sessions attributed to a fleet agent. The agent's working directory is resolved from FleetManager.
2. **Path-scoped** (`/api/chat/sessions/by-path/:encodedPath/:sessionId`) -- for unattributed sessions discovered on disk. The `encodedPath` is a URL-safe encoding of the working directory, resolved back to a filesystem path via the directory group index.

The `GET /api/chat/all` endpoint returns sessions grouped into `DirectoryGroup` objects, each containing a `workingDirectory`, `encodedPath`, and array of `DiscoveredSession` objects. Pagination is supported via `limit` (number of directory groups) and `sessionsPerGroup` (sessions per group) query parameters.

## Chat Integration

The web chat system integrates with `@herdctl/chat` for session attribution and message extraction, and with `SessionDiscoveryService` from `@herdctl/core` for session enumeration and message reading.

### Shared Infrastructure

From `@herdctl/chat`:

- **`ChatSessionManager`** -- Per-agent session tracking. Used by `WebChatManager` to record attribution when sessions are created through the web dashboard, so they can be distinguished from native CLI sessions.
- **`extractMessageContent()`** -- Extracts text from Claude SDK response objects during streaming.

From `@herdctl/core`:

- **`SessionDiscoveryService`** -- Discovers Claude Code sessions on disk by scanning `.claude/projects/` directories. Provides session enumeration, message reading (from JSONL files), metadata extraction, and usage tracking. This is the single source of truth for what sessions exist.
- **`extractToolResults()`** / **`extractToolUseBlocks()`** -- Parses tool call data from SDK messages during streaming.
- **`getToolInputSummary()`** -- Generates human-readable summaries of tool inputs.
- **`SessionMetadataStore`** -- Persists custom session names (renames) in `.herdctl/session-metadata/`.

### WebChatManager

`WebChatManager` is the server-side orchestrator for all chat operations. It delegates read operations (listing sessions, reading messages, fetching usage) to `SessionDiscoveryService` and handles write operations (sending messages, renaming sessions) itself. Sessions are:

- **Discovered from disk** -- Session enumeration comes from `SessionDiscoveryService`, which scans the filesystem for Claude Code JSONL session files rather than maintaining its own session registry.
- **Per-agent or unattributed** -- Agent-attributed sessions are scoped by agent name and working directory. Unattributed sessions (from native CLI usage) are accessed by working directory path alone.
- **Shared** -- No per-user scoping; any browser sees and can interact with any session.
- **Origin-aware** -- Each session carries an `origin` field (`herdctl`, `native`, or `adhoc`) determined by checking attribution data.

When a user sends a message to an agent-attributed session, `WebChatManager` triggers a FleetManager job and processes the agent's streaming response through SDK message callbacks. Text chunks, tool call results, and message boundaries are relayed back to the browser via WebSocket in real time.

For ad hoc sessions (native sessions resumed interactively), `WebChatManager.sendAdhocMessage()` bypasses FleetManager entirely. It constructs a minimal synthetic `ResolvedAgent` with CLI runtime and uses `RuntimeFactory` + `JobExecutor` directly to execute `claude --resume <sessionId>` in the session's working directory. The streaming callback pipeline is identical to agent-attributed sessions.

### Conversation Continuity

Each web chat session maps to a Claude SDK session. On the first message, the SDK creates a new session. `WebChatManager` stores the returned SDK session ID via `ChatSessionManager.setSession()` for attribution. On subsequent messages in the same web session, the stored SDK session ID is passed as `resume`, allowing the agent to continue the conversation with full context.

Ad hoc sessions always use `resume` since they are, by definition, continuations of existing native CLI sessions.

## Design System

All UI components follow the design system defined in `packages/web/DESIGN_SYSTEM.md`. The design system establishes:

### Color Tokens

Colors are defined as CSS custom properties using Tailwind v4's `@theme` directive, with a `herd-` prefix namespace. Components reference tokens via Tailwind classes (`bg-herd-bg`, `text-herd-fg`, `border-herd-border`) and never use raw hex values.

| Token | Light Mode | Dark Mode | Usage |
|-------|-----------|-----------|-------|
| `herd-bg` | `#F4F1EB` (warm parchment) | `#1C1B18` (warm dark) | Page background |
| `herd-fg` | `#1C1B18` | `#E8E6E1` | Primary text |
| `herd-card` | `#FDFCFA` (warm white) | `#252320` | Card/panel surfaces |
| `herd-sidebar` | `#EBE8E1` | `#1A1917` | Sidebar background |
| `herd-primary` | `#326CE5` | `#5B8DEF` | Primary accent (brand blue) |
| `herd-muted` | `#7A776D` | `#8A877F` | Secondary text |
| `herd-status-running` | `#2D7D46` | `#48BB78` | Running/connected state |
| `herd-status-error` | `#C53030` | `#FC8181` | Error/failed state |
| `herd-status-pending` | `#B7791F` | `#F6E05E` | Pending/starting state |

The primary blue (`#326CE5`) is derived from the herdctl logo, which references the Kubernetes/kubectl color palette.

### Typography

Three font stacks are defined:

- **`font-sans`** (IBM Plex Sans) -- All UI chrome: navigation, labels, buttons, tables
- **`font-mono`** (IBM Plex Mono) -- Code blocks, terminal output, job IDs, file paths
- **`font-serif`** (Lora) -- Agent response body text in chat view only

Text sizes are constrained to `text-[11px]`, `text-xs`, `text-sm`, and `text-lg`. Nothing larger than 18px appears in the UI.

### Dark Mode

Dark mode uses Tailwind's class-based approach (`darkMode: 'class'`). CSS custom properties are defined in `:root` (light) and `.dark` (dark) blocks. Components use the same token-based classes in both modes -- no `dark:` prefix appears in component code.

Theme preference is stored in `localStorage` (`herd-theme` key) with three options: `light`, `dark`, `system`. The `system` option uses the `prefers-color-scheme` media query.

### Animation

Animations are minimal and purposeful:

- `fadeSlideIn` (150ms) for new messages and list items
- `transition-colors` (150ms) on all interactive elements
- `animate-pulse` only on status dots for running agents
- `animate-spin` only on loading spinners

No page transition animations. No skeleton shimmer effects (placeholder blocks use `opacity-50 animate-pulse`).

## Build and Development

### Development Mode

In development, two servers run concurrently:

```bash
pnpm dev  # Runs both via concurrently
```

- **Vite dev server** (port 5173) -- Serves the React app with HMR
- **TypeScript watch** -- Recompiles server code on changes

Vite's proxy configuration forwards `/api/*` and `/ws` requests to the Fastify server.

### Production Build

```bash
pnpm build  # Builds client (Vite) then server (tsc)
```

1. `vite build` compiles the React SPA to `dist/client/` (static HTML, JS, CSS)
2. `tsc -p tsconfig.server.json` compiles server TypeScript to `dist/server/`
3. The npm package includes both `dist/` directories

In production, everything runs on a single port. Fastify serves the static client assets via `@fastify/static` and handles API requests and WebSocket connections on the same host.

### Package Entry Point

The npm package entry point is `dist/server/index.js`, which exports the `WebManager` class. FleetManager dynamically imports this when `web.enabled: true` in the fleet configuration:

```typescript
// In @herdctl/core, during FleetManager initialization:
if (config.fleet.web?.enabled) {
  const { WebManager } = await import("@herdctl/web");
  const webManager = new WebManager(ctx);
  await webManager.initialize();
}
```

## Related Pages

- [System Architecture](/architecture/overview/) -- Overall system design, FleetManager orchestration, event system
- [HTTP API](/architecture/http-api/) -- REST endpoints, WebSocket protocol, FleetBridge, WebManager lifecycle
- [Chat Infrastructure](/architecture/chat-infrastructure/) -- Shared chat layer (ChatSessionManager, StreamingResponder)
- [Job Lifecycle](/architecture/job-system/) -- Job creation, status transitions, output streaming
- [Schedule System](/architecture/scheduler/) -- Polling loop, interval/cron parsing, trigger mechanics
- [CLI](/architecture/cli/) -- The other thin client over FleetManager
