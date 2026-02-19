# @herdctl/web

## 0.1.2

### Patch Changes

- Updated dependencies [[`04afb3b`](https://github.com/edspencer/herdctl/commit/04afb3bd0b918413351a2e3c88009d803948ddfa)]:
  - @herdctl/core@5.2.2
  - @herdctl/chat@0.2.4

## 0.1.1

### Patch Changes

- [#75](https://github.com/edspencer/herdctl/pull/75) [`11ec259`](https://github.com/edspencer/herdctl/commit/11ec2593986e0f33a7e69ca4f7d56946c03197c5) Thanks [@edspencer](https://github.com/edspencer)! - Add README files for slack, web, and chat packages; update Related Packages in all package READMEs

- Updated dependencies [[`11ec259`](https://github.com/edspencer/herdctl/commit/11ec2593986e0f33a7e69ca4f7d56946c03197c5)]:
  - @herdctl/core@5.2.1
  - @herdctl/chat@0.2.3

## 0.1.0

### Minor Changes

- [#72](https://github.com/edspencer/herdctl/pull/72) [`de00c6b`](https://github.com/edspencer/herdctl/commit/de00c6bf971f582703d3720cc2546173e1b074ea) Thanks [@edspencer](https://github.com/edspencer)! - feat(web): Add web dashboard with real-time fleet monitoring, agent chat, schedule management, and job control

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

### Patch Changes

- Updated dependencies [[`de00c6b`](https://github.com/edspencer/herdctl/commit/de00c6bf971f582703d3720cc2546173e1b074ea)]:
  - @herdctl/core@5.2.0
  - @herdctl/chat@0.2.2
