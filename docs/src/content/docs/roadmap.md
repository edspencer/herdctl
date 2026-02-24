---
title: Roadmap
description: Planned features and future direction for herdctl
---

This page outlines planned features and areas of active development for herdctl. These are forward-looking plans and may change as the project evolves. For a history of shipped features, see [What's New](/whats-new/).

## Dynamic Scheduling

Currently, agent schedules are static — defined in YAML config and fixed at fleet startup. Dynamic scheduling will allow agents to request their own next run time based on what they observe during a job.

The current approach uses a `metadata.json` file that agents write to their workspace at the end of a job:

```json
{
  "requestedNextRun": "2024-01-15T10:37:00Z",
  "reason": "Storm trajectory update expected"
}
```

herdctl reads this file and adjusts the next trigger accordingly. This works, but we're looking to replace this file-based approach with an injected MCP pattern — giving agents a dedicated tool they can call to request schedule changes directly, rather than relying on file conventions.

This enables agents to respond to real-world conditions — monitoring more frequently when something interesting is happening and backing off when things are quiet.

## Persistent Agent Memory

Agents can maintain a `context.md` file in their workspace — a persistent memory that survives across jobs:

```markdown
# Agent Context

## Learned Preferences
- User prefers concise summaries
- Always include links to source data
- Escalate price drops > 20%

## Current State
- Monitoring: Sony WH-1000XM5
- Target price: $279
- Best seen: $299 at Amazon (2024-01-14)
```

Each job reads this context, acts on it, and can update it for future runs. This gives agents continuity between executions without requiring persistent sessions. An agent that runs once an hour can remember what it learned last hour.

## Agent Self-Modification

Advanced agents will be able to modify their own behavior over time:

- Update their own `CLAUDE.md` instructions based on feedback
- Write new slash command skills to extend their capabilities
- Modify their YAML configuration (e.g., adjusting schedules or permissions)
- Commit and push changes to their own repository

This enables agents that improve themselves over time, learning from each interaction and adapting their behavior accordingly.

## Agent-to-Agent Communication

Agents in a fleet currently operate independently. Agent-to-agent communication will allow agents to delegate tasks to other agents, share results, and coordinate work. For example, a triage agent could assign issues to the most appropriate specialist agent, or a monitoring agent could alert a remediation agent when it detects a problem.

Like dynamic scheduling, we plan to implement this via an injected MCP pattern — agents would have tools available to send messages to and receive responses from other agents in their fleet.

## More Chat Integrations

herdctl currently supports Discord, Slack, and the web dashboard for interactive chat with agents. We don't have plans to add native support for other platforms at this time, but we're working on making the chat integration layer pluggable — allowing anyone to write their own chat connector without requiring changes to herdctl itself.

## Agent Marketplace

A marketplace for sharing and discovering agent configurations. This will allow users to publish reusable agent definitions — complete with prompts, schedules, identity files, and MCP configurations — and for others to install and adapt them for their own fleets.
