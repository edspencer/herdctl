# herdctl HTTP API Specification

> **Status**: Design document
> **Last Updated**: 2025-01-20

This document defines the HTTP API for herdctl. The API enables programmatic control of the fleet and powers the web dashboard.

---

## Overview

The API is implemented as part of `@herdctl/web` using Next.js API routes. It can run:
- **Locally**: Bundled with `herdctl start --web`
- **Standalone**: As a separate Next.js deployment connecting to a fleet

All endpoints are prefixed with `/api`.

---

## Authentication

### Current State (MVP)

**No authentication** - The API is intended for local use initially. Access control is handled at the network level (localhost only, or behind a VPN/firewall).

### Future Plans

The API is designed to support authentication when needed:

1. **API Keys** - Simple token-based auth for scripts and CI
2. **OIDC/OAuth** - Enterprise SSO integration

Authentication will be added via middleware without changing endpoint signatures:

```typescript
// Future: All endpoints will check auth
// Headers: Authorization: Bearer <token>
// Or: X-API-Key: <key>
```

When auth is enabled, unauthenticated requests will receive `401 Unauthorized`.

---

## Response Format

All responses are JSON with consistent structure:

**Success:**
```json
{
  "data": { ... },
  "meta": {
    "timestamp": "2025-01-20T12:00:00Z"
  }
}
```

**Error:**
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Agent 'foo' not found"
  },
  "meta": {
    "timestamp": "2025-01-20T12:00:00Z"
  }
}
```

---

## Endpoints

### Fleet Management

#### `GET /api/fleet`

Get fleet overview.

**Response:**
```json
{
  "data": {
    "status": "running",
    "agents": 3,
    "activeJobs": 1,
    "scheduledTriggers": 5,
    "uptime": 3600
  }
}
```

#### `GET /api/fleet/status`

Get detailed fleet status including all agents and schedules.

**Response:**
```json
{
  "data": {
    "status": "running",
    "startedAt": "2025-01-20T10:00:00Z",
    "agents": [
      {
        "name": "bragdoc-coder",
        "status": "running",
        "activeJobs": 1,
        "lastJobAt": "2025-01-20T11:55:00Z",
        "nextTriggerAt": "2025-01-20T12:00:00Z"
      }
    ],
    "stats": {
      "totalJobs": 142,
      "completedJobs": 140,
      "failedJobs": 2
    }
  }
}
```

#### `POST /api/fleet/start`

Start the fleet.

**Request Body (optional):**
```json
{
  "agents": ["bragdoc-coder", "bragdoc-writer"]
}
```

**Response:**
```json
{
  "data": {
    "status": "running",
    "agentsStarted": ["bragdoc-coder", "bragdoc-writer"]
  }
}
```

#### `POST /api/fleet/stop`

Stop the fleet gracefully.

**Request Body (optional):**
```json
{
  "force": false,
  "timeout": 30000
}
```

**Response:**
```json
{
  "data": {
    "status": "stopped",
    "agentsStopped": ["bragdoc-coder", "bragdoc-writer"],
    "jobsCancelled": 0
  }
}
```

#### `GET /api/fleet/config`

Get current fleet configuration.

**Response:**
```json
{
  "data": {
    "name": "my-fleet",
    "configPath": "/path/to/herdctl.yaml",
    "stateDir": "/path/to/.herdctl",
    "defaults": { ... },
    "agentPaths": ["./agents/coder", "./agents/writer"]
  }
}
```

---

### Agents

#### `GET /api/agents`

List all agents.

**Query Parameters:**
- `status` - Filter by status: `running`, `idle`, `stopped`

**Response:**
```json
{
  "data": [
    {
      "name": "bragdoc-coder",
      "description": "Implements features and fixes bugs",
      "status": "running",
      "workspace": "bragdoc-ai",
      "scheduleCount": 2,
      "totalJobs": 142
    }
  ]
}
```

#### `GET /api/agents/:name`

Get agent details.

**Response:**
```json
{
  "data": {
    "name": "bragdoc-coder",
    "description": "Implements features and fixes bugs",
    "status": "running",
    "workspace": {
      "path": "~/herdctl-workspace/bragdoc-ai",
      "repo": "edspencer/bragdoc-ai"
    },
    "permissions": {
      "mode": "acceptEdits",
      "allowedTools": ["Read", "Edit", "Bash"]
    },
    "schedules": [
      {
        "name": "issue-check",
        "type": "interval",
        "interval": "5m",
        "lastRunAt": "2025-01-20T11:55:00Z",
        "nextRunAt": "2025-01-20T12:00:00Z",
        "enabled": true
      }
    ],
    "workSource": {
      "type": "github",
      "repo": "edspencer/bragdoc-ai"
    },
    "stats": {
      "totalJobs": 142,
      "completedJobs": 140,
      "failedJobs": 2,
      "averageDuration": 45000
    }
  }
}
```

#### `GET /api/agents/:name/status`

Get agent runtime status.

**Response:**
```json
{
  "data": {
    "name": "bragdoc-coder",
    "status": "running",
    "activeJobs": 1,
    "currentJob": {
      "id": "job-2025-01-20-abc123",
      "startedAt": "2025-01-20T11:58:00Z",
      "schedule": "issue-check"
    },
    "lastJobAt": "2025-01-20T11:55:00Z",
    "nextTriggerAt": "2025-01-20T12:00:00Z"
  }
}
```

#### `POST /api/agents/:name/start`

Start a specific agent.

**Response:**
```json
{
  "data": {
    "name": "bragdoc-coder",
    "status": "running"
  }
}
```

#### `POST /api/agents/:name/stop`

Stop a specific agent.

**Request Body (optional):**
```json
{
  "force": false
}
```

**Response:**
```json
{
  "data": {
    "name": "bragdoc-coder",
    "status": "stopped",
    "jobsCancelled": 0
  }
}
```

#### `POST /api/agents/:name/trigger`

Manually trigger an agent.

**Request Body (optional):**
```json
{
  "schedule": "issue-check",
  "prompt": "Custom prompt override"
}
```

**Response:**
```json
{
  "data": {
    "job": {
      "id": "job-2025-01-20-xyz789",
      "agent": "bragdoc-coder",
      "schedule": "issue-check",
      "status": "running",
      "startedAt": "2025-01-20T12:00:00Z"
    }
  }
}
```

#### `GET /api/agents/:name/schedules`

List agent's schedules.

**Response:**
```json
{
  "data": [
    {
      "name": "issue-check",
      "type": "interval",
      "interval": "5m",
      "prompt": "Check for ready GitHub issues...",
      "lastRunAt": "2025-01-20T11:55:00Z",
      "nextRunAt": "2025-01-20T12:00:00Z",
      "enabled": true,
      "runCount": 142
    }
  ]
}
```

#### `POST /api/agents/:name/schedules/:schedule/trigger`

Trigger a specific schedule.

**Response:**
```json
{
  "data": {
    "job": {
      "id": "job-2025-01-20-xyz789",
      "agent": "bragdoc-coder",
      "schedule": "issue-check",
      "status": "running"
    }
  }
}
```

#### `GET /api/agents/:name/jobs`

List jobs for this agent.

**Query Parameters:**
- `status` - Filter: `running`, `completed`, `failed`, `cancelled`
- `limit` - Max results (default: 50)
- `offset` - Pagination offset

**Response:**
```json
{
  "data": [
    {
      "id": "job-2025-01-20-abc123",
      "schedule": "issue-check",
      "status": "completed",
      "startedAt": "2025-01-20T11:55:00Z",
      "finishedAt": "2025-01-20T11:56:30Z",
      "duration": 90000
    }
  ],
  "meta": {
    "total": 142,
    "limit": 50,
    "offset": 0
  }
}
```

#### `GET /api/agents/:name/logs`

Get recent logs for this agent.

**Query Parameters:**
- `limit` - Max lines (default: 100)
- `since` - ISO timestamp

**Response:**
```json
{
  "data": [
    {
      "timestamp": "2025-01-20T11:55:00Z",
      "jobId": "job-2025-01-20-abc123",
      "type": "assistant",
      "content": "I'll check for ready issues..."
    }
  ]
}
```

---

### Jobs

#### `GET /api/jobs`

List jobs across all agents.

**Query Parameters:**
- `agent` - Filter by agent name
- `status` - Filter: `running`, `completed`, `failed`, `cancelled`
- `since` - Jobs started after this ISO timestamp
- `until` - Jobs started before this ISO timestamp
- `limit` - Max results (default: 50)
- `offset` - Pagination offset

**Response:**
```json
{
  "data": [
    {
      "id": "job-2025-01-20-abc123",
      "agent": "bragdoc-coder",
      "schedule": "issue-check",
      "status": "completed",
      "startedAt": "2025-01-20T11:55:00Z",
      "finishedAt": "2025-01-20T11:56:30Z",
      "duration": 90000,
      "exitReason": "success"
    }
  ],
  "meta": {
    "total": 500,
    "limit": 50,
    "offset": 0
  }
}
```

#### `GET /api/jobs/:id`

Get job details.

**Response:**
```json
{
  "data": {
    "id": "job-2025-01-20-abc123",
    "agent": "bragdoc-coder",
    "schedule": "issue-check",
    "status": "completed",
    "startedAt": "2025-01-20T11:55:00Z",
    "finishedAt": "2025-01-20T11:56:30Z",
    "duration": 90000,
    "exitReason": "success",
    "sessionId": "claude-session-xyz",
    "prompt": "Check for ready GitHub issues...",
    "summary": "Fixed issue #123: Add dark mode support",
    "workItem": {
      "source": "github",
      "id": "123",
      "title": "Add dark mode support"
    }
  }
}
```

#### `GET /api/jobs/:id/output`

Get job output as parsed JSON array.

**Query Parameters:**
- `types` - Filter by message types: `assistant`, `tool_use`, `tool_result`, `error`
- `limit` - Max messages
- `offset` - Pagination offset

**Response:**
```json
{
  "data": [
    {
      "type": "assistant",
      "content": "I'll check for ready issues...",
      "timestamp": "2025-01-20T11:55:01Z"
    },
    {
      "type": "tool_use",
      "tool_name": "Bash",
      "input": "gh issue list --label ready",
      "timestamp": "2025-01-20T11:55:02Z"
    }
  ]
}
```

#### `GET /api/jobs/:id/output/raw`

Get raw JSONL output.

**Response:** `text/plain` with JSONL content

#### `DELETE /api/jobs/:id`

Cancel a running job.

**Response:**
```json
{
  "data": {
    "id": "job-2025-01-20-abc123",
    "status": "cancelled"
  }
}
```

#### `POST /api/jobs/:id/resume`

Resume a job from its session.

**Request Body (optional):**
```json
{
  "prompt": "Continue where you left off"
}
```

**Response:**
```json
{
  "data": {
    "job": {
      "id": "job-2025-01-20-newjob",
      "agent": "bragdoc-coder",
      "status": "running",
      "resumedFrom": "job-2025-01-20-abc123"
    }
  }
}
```

#### `POST /api/jobs/:id/fork`

Fork a job (create new job from session state).

**Request Body:**
```json
{
  "prompt": "Try a different approach to the issue"
}
```

**Response:**
```json
{
  "data": {
    "job": {
      "id": "job-2025-01-20-forked",
      "agent": "bragdoc-coder",
      "status": "running",
      "forkedFrom": "job-2025-01-20-abc123"
    }
  }
}
```

---

### Sessions

#### `GET /api/sessions`

List all sessions.

**Response:**
```json
{
  "data": [
    {
      "agent": "bragdoc-coder",
      "sessionId": "claude-session-xyz",
      "createdAt": "2025-01-19T08:00:00Z",
      "lastUsedAt": "2025-01-20T11:55:00Z",
      "jobCount": 142,
      "mode": "autonomous"
    }
  ]
}
```

#### `GET /api/sessions/:agent`

Get session for specific agent.

**Response:**
```json
{
  "data": {
    "agent": "bragdoc-coder",
    "sessionId": "claude-session-xyz",
    "createdAt": "2025-01-19T08:00:00Z",
    "lastUsedAt": "2025-01-20T11:55:00Z",
    "jobCount": 142,
    "mode": "autonomous"
  }
}
```

#### `DELETE /api/sessions/:agent`

Clear agent session (next job starts fresh).

**Response:**
```json
{
  "data": {
    "agent": "bragdoc-coder",
    "cleared": true
  }
}
```

---

### Work Sources

#### `GET /api/work-sources`

List configured work sources.

**Response:**
```json
{
  "data": [
    {
      "agent": "bragdoc-coder",
      "type": "github",
      "repo": "edspencer/bragdoc-ai",
      "labels": {
        "ready": "ready-for-ai",
        "inProgress": "ai-working"
      }
    }
  ]
}
```

#### `GET /api/work-sources/:agent/items`

Get available work items for agent.

**Response:**
```json
{
  "data": [
    {
      "id": "github-123",
      "source": "github",
      "externalId": "123",
      "title": "Add dark mode support",
      "url": "https://github.com/edspencer/bragdoc-ai/issues/123",
      "labels": ["ready-for-ai", "feature"],
      "createdAt": "2025-01-18T10:00:00Z"
    }
  ]
}
```

#### `POST /api/work-sources/:agent/items/:id/claim`

Manually claim a work item.

**Response:**
```json
{
  "data": {
    "id": "github-123",
    "claimed": true,
    "claimedAt": "2025-01-20T12:00:00Z"
  }
}
```

#### `POST /api/work-sources/:agent/items/:id/release`

Release a claimed work item.

**Response:**
```json
{
  "data": {
    "id": "github-123",
    "released": true
  }
}
```

#### `POST /api/work-sources/:agent/items/:id/complete`

Mark work item as complete.

**Request Body:**
```json
{
  "summary": "Implemented dark mode with CSS variables",
  "close": true
}
```

**Response:**
```json
{
  "data": {
    "id": "github-123",
    "completed": true,
    "closed": true
  }
}
```

---

### Logs & Streaming

#### `GET /api/logs`

Get recent logs across all agents.

**Query Parameters:**
- `agent` - Filter by agent
- `job` - Filter by job ID
- `type` - Filter by type: `assistant`, `tool_use`, `tool_result`, `error`
- `since` - ISO timestamp
- `limit` - Max lines (default: 100)

**Response:**
```json
{
  "data": [
    {
      "timestamp": "2025-01-20T11:55:00Z",
      "agent": "bragdoc-coder",
      "jobId": "job-2025-01-20-abc123",
      "type": "assistant",
      "content": "I'll check for ready issues..."
    }
  ]
}
```

#### `WS /api/ws/fleet`

WebSocket for fleet events.

**Events:**
```json
{"event": "fleet:started", "timestamp": "..."}
{"event": "fleet:stopped", "timestamp": "..."}
{"event": "agent:started", "agent": "bragdoc-coder", "timestamp": "..."}
{"event": "agent:stopped", "agent": "bragdoc-coder", "timestamp": "..."}
{"event": "schedule:triggered", "agent": "bragdoc-coder", "schedule": "issue-check", "timestamp": "..."}
{"event": "job:created", "job": {...}, "timestamp": "..."}
{"event": "job:completed", "job": {...}, "timestamp": "..."}
{"event": "job:failed", "job": {...}, "error": "...", "timestamp": "..."}
```

#### `WS /api/ws/logs`

WebSocket for streaming logs.

**Query Parameters:**
- `agent` - Filter by agent
- `types` - Filter by message types

**Events:**
```json
{"agent": "bragdoc-coder", "jobId": "...", "type": "assistant", "content": "...", "timestamp": "..."}
```

#### `WS /api/ws/jobs/:id`

WebSocket for streaming specific job output.

**Events:**
```json
{"type": "assistant", "content": "...", "timestamp": "..."}
{"type": "tool_use", "tool_name": "Bash", "input": "...", "timestamp": "..."}
{"type": "tool_result", "result": "...", "timestamp": "..."}
{"type": "complete", "exitReason": "success", "timestamp": "..."}
```

---

### System

#### `GET /api/health`

Health check for load balancers.

**Response:**
```json
{
  "status": "healthy",
  "version": "0.1.0",
  "uptime": 3600
}
```

#### `GET /api/version`

Version information.

**Response:**
```json
{
  "data": {
    "version": "0.1.0",
    "core": "0.1.0",
    "node": "20.10.0"
  }
}
```

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `NOT_FOUND` | 404 | Resource not found |
| `INVALID_REQUEST` | 400 | Invalid request parameters |
| `AGENT_NOT_RUNNING` | 409 | Agent is not running |
| `JOB_NOT_RUNNING` | 409 | Job is not running (can't cancel) |
| `FLEET_NOT_RUNNING` | 409 | Fleet is not running |
| `ALREADY_RUNNING` | 409 | Resource already running |
| `INTERNAL_ERROR` | 500 | Internal server error |

---

## Rate Limiting (Future)

When authentication is enabled, rate limiting will be applied:

- **Default**: 1000 requests/minute per API key
- **WebSocket**: 100 connections per API key
- **Streaming**: Unlimited once connected

Rate limit headers:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 950
X-RateLimit-Reset: 1705752000
```
