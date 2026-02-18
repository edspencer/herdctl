---
"@herdctl/web": minor
"@herdctl/core": minor
"herdctl": minor
---

feat(web): Add web dashboard with real-time fleet monitoring, agent chat, schedule management, and job control

- Fleet dashboard with real-time status updates via WebSocket
- Agent detail pages with live output streaming
- Interactive chat with agents using @herdctl/chat
- Schedule overview with trigger, enable, and disable actions
- Job management with cancel, fork, and CLI command copying
- Dark/light theme system with system preference detection
- Settings page with fleet information
- CLI integration: `--web` and `--web-port` flags on `herdctl start`
- Error boundaries, loading states, toast notifications
- Responsive layout with mobile sidebar
