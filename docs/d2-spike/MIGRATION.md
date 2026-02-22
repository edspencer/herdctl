# Diagram Migration Plan: Mermaid → D2

This document catalogs all 21 Mermaid diagrams in the herdctl docs and identifies which should be migrated to D2 for improved rendering quality.

## Migration Decisions

- **Migrate to D2**: Diagrams with nesting, subgroups, 15+ nodes, or architectural containment
- **Keep as Mermaid**: Sequence diagrams, simple decision trees, small linear flows
- **Already migrated**: All 11 diagrams marked for D2 migration

## Catalog

### 1. Fleet Composition — Basic Hierarchy ✅ MIGRATED
- **File**: `concepts/fleet-composition.md` (was line 10)
- **Type**: `graph TD` — 14 nodes
- **Description**: Super fleet with sub-fleets and their agents
- **D2 source**: `d2-spike/fleet-composition.d2`
- **Rendered**: `public/diagrams/fleet-composition.svg`

### 2. Fleet Composition — Sub-Teams ✅ MIGRATED
- **File**: `concepts/fleet-composition.md` (was line 63)
- **Type**: `graph TD` — 18 nodes
- **Description**: Fleet with Engineering/Marketing/Legal team groupings
- **D2 source**: `d2-spike/fleet-composition-subteams.d2`
- **Rendered**: `public/diagrams/fleet-composition-subteams.svg`

### 3. Fleet Composition — Config Merge Priority ⏭️ KEEP MERMAID
- **File**: `concepts/fleet-composition.md` (line 217)
- **Type**: `flowchart LR` — 5 nodes
- **Description**: Simple horizontal chain showing config override priority
- **Reason to keep**: Simple linear flow, Mermaid handles it fine

### 4. Runner Architecture ✅ MIGRATED
- **File**: `internals/runner.md` (was line 10)
- **Type**: `flowchart TD` — 15 nodes
- **Description**: Runner execution engine with job creation, session validation, runtime factory, SDK adapter, message processing, error handling
- **D2 source**: `d2-spike/runner-architecture.d2`
- **Rendered**: `public/diagrams/runner-architecture.svg`

### 5. Agent Composition ✅ MIGRATED
- **File**: `concepts/agents.md` (was line 10)
- **Type**: `flowchart TD` — 24 nodes
- **Description**: Agent with identity, workspace, schedules, permissions, and optional work sources, chat, MCP, hooks, sessions
- **D2 source**: `d2-spike/agent-composition.d2`
- **Rendered**: `public/diagrams/agent-composition.svg`

### 6. Scheduler Architecture ⏭️ KEEP MERMAID (marginal)
- **File**: `internals/scheduler.md` (line 12)
- **Type**: `flowchart TD` — 8 nodes
- **Description**: Scheduler polling loop with schedule checker, trigger callback, state reader
- **Reason to keep**: Small, contained. D2 would be slightly better but Mermaid is adequate

### 7. Package Dependencies ✅ MIGRATED
- **File**: `index.mdx` (was line 72)
- **Type**: `graph TD` — 6 nodes
- **Description**: Package dependency graph (CLI, Web, Discord, Slack → Chat → Core)
- **D2 source**: `d2-spike/package-dependencies.d2`
- **Rendered**: `public/diagrams/package-dependencies.svg`

### 8. State Directory Structure ✅ MIGRATED
- **File**: `internals/state-management.md` (was line 24)
- **Type**: `graph TD` — 14 nodes
- **Description**: `.herdctl/` directory tree with state.yaml, jobs, sessions, logs
- **D2 source**: `d2-spike/state-directory.d2`
- **Rendered**: `public/diagrams/state-directory.svg`

### 9. Session Sequence ⏭️ KEEP MERMAID
- **File**: `concepts/sessions.md` (line 17)
- **Type**: `sequenceDiagram` — 3 participants
- **Description**: User/Schedule → Agent → Tools interaction showing session context
- **Reason to keep**: Sequence diagram — Mermaid's strongest type, D2 would be worse

### 10. Job Execution Flow ⏭️ KEEP MERMAID
- **File**: `concepts/jobs.md` (line 37)
- **Type**: `sequenceDiagram` — 7 participants, 20+ interactions
- **Description**: Full job lifecycle from trigger through execution to completion
- **Reason to keep**: Complex sequence diagram with activation, opt/alt blocks, loops. Mermaid handles these well, D2 would lose visual cues

### 11. Core Architecture ✅ MIGRATED
- **File**: `internals/architecture.md` (was line 10)
- **Type**: `flowchart TD` — 8 nodes
- **Description**: FleetManager as central orchestrator connecting ConfigLoader, Scheduler, StateManager, Runner, JobManager, Web/Chat
- **D2 source**: `d2-spike/core-architecture.d2`
- **Rendered**: `public/diagrams/core-architecture.svg`

### 12. Trigger Decision Tree ⏭️ KEEP MERMAID
- **File**: `concepts/triggers.md` (line 463)
- **Type**: `flowchart TD` — 7 nodes
- **Description**: Decision tree for choosing between Cron, Webhook, Chat, and Interval triggers
- **Reason to keep**: Uses Mermaid's native diamond decision shapes, which D2 handles less well

### 13. Error Hierarchy ✅ MIGRATED
- **File**: `library-reference/error-handling.mdx` (was line 14)
- **Type**: `graph LR` — 26 nodes
- **Description**: Full error type hierarchy (FleetManager, Runner, Scheduler, State, WorkSource, Config errors with subtypes)
- **D2 source**: `d2-spike/error-hierarchy.d2`
- **Rendered**: `public/diagrams/error-hierarchy.svg`

### 14. Work Source Adapter Pattern ⏭️ KEEP MERMAID
- **File**: `concepts/work-sources.md` (line 14)
- **Type**: `flowchart LR` — 3 nodes
- **Description**: External System ↔ Work Source Adapter ↔ Agent
- **Reason to keep**: 3 nodes, trivially simple

### 15. Work Source Adapter Implementations ⏭️ KEEP MERMAID
- **File**: `concepts/work-sources.md` (line 39)
- **Type**: `graph TD` — 4 nodes
- **Description**: WorkSourceAdapter interface with GitHub, Linear, Jira implementations
- **Reason to keep**: 4 nodes, trivially simple

### 16. Work Item Lifecycle ⏭️ KEEP MERMAID
- **File**: `concepts/work-sources.md` (line 80)
- **Type**: `flowchart TD` — 4 nodes
- **Description**: Work item state machine (AVAILABLE → CLAIMED → COMPLETED/RELEASED)
- **Reason to keep**: Simple state machine

### 17. GitHub Label Workflow ⏭️ KEEP MERMAID
- **File**: `configuration/github-work-source.md` (line 93)
- **Type**: `flowchart TD` — 5 nodes
- **Description**: GitHub issue state transitions with label changes
- **Reason to keep**: Simple state machine with annotations

### 18. Chat Architecture — Top Level ✅ MIGRATED
- **File**: `internals/chat-architecture.md` (was line 12)
- **Type**: `flowchart TD` — 10 nodes
- **Description**: FleetManager → IChatManager → Discord/Slack managers → connectors → APIs
- **D2 source**: `d2-spike/chat-architecture.d2`
- **Rendered**: `public/diagrams/chat-architecture.svg`

### 19. Chat Package Dependencies ⏭️ KEEP MERMAID (marginal)
- **File**: `internals/chat-architecture.md` (line 72)
- **Type**: `flowchart LR` — 6 nodes
- **Description**: Package dependency flow (Discord, Slack → Chat → Core)
- **Reason to keep**: Small dependency graph, adequate in Mermaid

### 20. Chat Infrastructure Components ✅ MIGRATED
- **File**: `internals/chat-architecture.md` (was line 105)
- **Type**: `flowchart TD` — 17 nodes
- **Description**: @herdctl/chat internals with types, utilities, error handling, formatting subgroups
- **D2 source**: `d2-spike/chat-infrastructure.d2`
- **Rendered**: `public/diagrams/chat-infrastructure.svg`

### 21. Chat Message Flow ✅ MIGRATED
- **File**: `internals/chat-architecture.md` (was line 214)
- **Type**: `flowchart TD` — 13 nodes
- **Description**: User message through platform layer, shared layer, core execution, reply path
- **D2 source**: `d2-spike/chat-message-flow.d2`
- **Rendered**: `public/diagrams/chat-message-flow.svg`

## Summary

| Action | Count | Diagrams |
|--------|-------|----------|
| ✅ Migrated to D2 | 11 | #1, #2, #4, #5, #7, #8, #11, #13, #18, #20, #21 |
| ⏭️ Keep as Mermaid | 10 | #3, #6, #9, #10, #12, #14, #15, #16, #17, #19 |
| **Total** | **21** | |
