# @herdctl/chat

> Shared chat infrastructure for herdctl connectors

[![npm version](https://img.shields.io/npm/v/@herdctl/chat.svg)](https://www.npmjs.com/package/@herdctl/chat)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Documentation**: [herdctl.dev](https://herdctl.dev)

## Overview

`@herdctl/chat` is the shared foundation that powers chat integrations in [herdctl](https://herdctl.dev). It provides session management, streaming message delivery, error handling, and message splitting used by `@herdctl/discord`, `@herdctl/slack`, and `@herdctl/web`.

Herdctl is an open-source system for running fleets of autonomous AI agents powered by Claude Code. This package is part of the herdctl monorepo.

> **Note**: This is an internal infrastructure package. Most users should use the platform-specific connectors (`@herdctl/discord`, `@herdctl/slack`) or the web dashboard (`@herdctl/web`) rather than this package directly.

## Installation

```bash
npm install @herdctl/chat
```

## What It Provides

### Session Management

`ChatSessionManager` tracks conversation sessions per channel or DM. Sessions are persisted to disk and automatically expire after a configurable timeout (default: 24 hours). When a user sends a message, the session manager either resumes the existing session or creates a new one, preserving conversation context via Claude SDK session resumption.

### Streaming Responses

`StreamingResponder` delivers agent responses incrementally as they are generated, rather than waiting for the full response. It buffers content and sends complete chunks at configurable intervals, respecting platform rate limits.

### Message Splitting

Long agent responses are automatically split at natural breakpoints (paragraph breaks, sentences, clauses) to fit within platform character limits (Discord: 2,000, Slack: 4,000). This ensures messages remain readable without cutting mid-sentence.

### Error Handling

A shared error handler classifies errors (transient, rate limit, authentication, etc.), provides user-friendly messages, and implements retry logic with exponential backoff. Platform connectors use this to handle failures gracefully without crashing.

### DM Filtering

The DM filter enforces access control for direct messages: enabled/disabled toggle, allowlist, blocklist, and chat mode (auto vs. mention). Blocklist takes precedence over allowlist.

### Message Extraction

Utilities for extracting text content from Claude SDK message formats, handling direct strings, nested message objects, and content block arrays.

## Architecture

```
@herdctl/chat (shared infrastructure)
    |
    +-- @herdctl/discord (Discord-specific integration)
    +-- @herdctl/slack   (Slack-specific integration)
    +-- @herdctl/web     (Web dashboard chat)
```

Each platform connector implements the `IChatConnector` interface and uses the shared infrastructure for everything that isn't platform-specific.

## Documentation

For more on how chat works in herdctl, visit [herdctl.dev](https://herdctl.dev):

- [Chat Configuration](https://herdctl.dev/configuration/agent-config/#chat)
- [Discord Quick Start](https://herdctl.dev/guides/discord-quick-start/)
- [Slack Quick Start](https://herdctl.dev/guides/slack-quick-start/)

## Related Packages

- [`herdctl`](https://www.npmjs.com/package/herdctl) - CLI for running agent fleets
- [`@herdctl/core`](https://www.npmjs.com/package/@herdctl/core) - Core library for programmatic use
- [`@herdctl/discord`](https://www.npmjs.com/package/@herdctl/discord) - Discord connector
- [`@herdctl/slack`](https://www.npmjs.com/package/@herdctl/slack) - Slack connector
- [`@herdctl/web`](https://www.npmjs.com/package/@herdctl/web) - Web dashboard

## License

MIT
