---
"@herdctl/web": minor
"@herdctl/core": minor
"herdctl": minor
---

feat(web): Add web dashboard with real-time fleet monitoring, agent chat, schedule management, and job control

- Fleet dashboard with real-time status updates via WebSocket
- Agent detail pages with live output streaming and DiceBear avatars
- Interactive chat with agents using @herdctl/chat
- Sidebar with agent sections and nested recent chat sessions
- Schedule overview with trigger, enable, and disable actions
- Job management with cancel, fork, and CLI command copying
- Dark/light/system theme toggle in header
- CLI integration: `--web` and `--web-port` flags on `herdctl start`
- Error boundaries, loading states, toast notifications
- Responsive layout with collapsible sidebar
