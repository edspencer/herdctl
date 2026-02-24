# Agent Distribution System - Implementation Plan

**Status**: Planning
**Last Updated**: 2026-02-23
**Prerequisite**: Familiarity with [agent-distribution.md](./agent-distribution.md) (the design document)

---

## Preamble: Design Document Analysis

Cross-referencing the design doc against the codebase surfaced several gaps. Most have been resolved by updating the design doc directly. This section documents what was found, what was fixed, and what remains open.

### Issues Found and Resolved

1. **agent.yaml schema mismatch** -- The design doc's `agent.yaml` template used fields and structures that don't exist in `AgentConfigSchema`: `env` as an array of variable names, `identity.claude_md`, `identity.knowledge_dir`, `permissions.mode` / `permissions.allowed_tools` as a nested object, and `schedules` as an array instead of a record. **Fixed**: Updated the design doc so that `agent.yaml` files conform to the existing `AgentConfigSchema`. `permission_mode` and `allowed_tools` are flat top-level fields. `schedules` is a `Record<string, Schedule>`.

2. **`docker.network: none`** -- Appeared in the agent.yaml example and the sandboxing recommendations, violating the project's critical rule about never using `network: none`. **Fixed**: Changed to `bridge` throughout, added a warning note to the sandboxing section.

3. **`knowledge/` and `skills/` directory conventions** -- The design doc used `identity.claude_md: inherit` and `identity.knowledge_dir` which don't exist in the schema. Skills were in a non-standard `skills/` directory. **Fixed**: Updated to use `setting_sources: ["project"]` (the real Claude Code mechanism), documented that knowledge files are just regular files referenced in CLAUDE.md, and changed skills to `.claude/commands/` (standard Claude Code location).

4. **`.herdctl/metadata.json` namespace confusion** -- The fleet-level `.herdctl/` directory (jobs, sessions, logs) and a per-agent `.herdctl/` directory could cause confusion. **Fixed**: Installation metadata is now `metadata.json` directly in the agent directory root, not nested in a `.herdctl/` subdirectory.

5. **Update strategy complexity** -- The three-way merge problem (upstream changes vs user customizations) is complex and not needed for v1. **Fixed**: `herdctl agent update` is deferred to a future version. Users can remove and re-add to "update" for now.

6. **Template variable system was unnecessary** -- The original design had an elaborate install-time template variable system (`@herdctl-var` annotations, install-time vs runtime variable classification, template substitution engine). Analysis showed this was solving a problem that doesn't exist: `agent.yaml` already supports `${VAR}` references that get resolved at runtime by the existing interpolation system in `interpolate.ts`. The agent name is set by the author in the repo's `agent.yaml`. **Fixed**: Removed the entire template system. Agent files are copied as-is during installation. All `${VAR}` references are runtime environment variables resolved from `.env`/`process.env`.

7. **`.env` file management was unnecessary** -- The original design had herdctl reading, writing, and managing the user's `.env` file (duplicate detection, secret masking, cleanup on removal). This adds complexity and risk — `.env` files often contain sensitive values and shared variables. **Fixed**: herdctl never reads or writes `.env`. After installation, it scans `agent.yaml` for `${VAR}` references and prints a clear console message telling the user which variables to add. On removal, it prints which variables the agent used.

### Future-Proofing for Agentic Init

The "Agent Initialization" feature (conversational setup via `claude -p`) is explicitly deferred per the design doc. However, the implementation should ensure:
- The `knowledge/` directory is properly copied during installation (init depends on `knowledge/initialization.md` existing).
- The per-agent `metadata.json` should have an extensible schema that can later include `initialization.required` and `initialization.completed_at` fields.
- The `herdctl agent` command group should reserve the `init` subcommand name.
- The workspace directory must be created during installation so the agent init process has somewhere to write data files.
- Agent repos can include a `knowledge/initialization.md` without any special handling -- it's just another file that gets copied. The agentic init feature only adds the *detection and spawning* logic on top.

### Codebase Context (from exploration)

- **CLI framework**: Commander.js. New `agent` subcommand group follows the same pattern as `config` and `sessions` (create a parent command, attach subcommands).
- **Testing pattern**: Vitest with mocked FleetManager. CLI command tests mock `@herdctl/core` entirely.
- **Agent names**: Validated by `AGENT_NAME_PATTERN` (`/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`). Agent names come from the `name` field in the repo's `agent.yaml`.
- **Config schema**: `AgentConfigSchema` in `packages/core/src/config/schema.ts` uses `.strict()`, rejecting unknown fields.
- **Existing interpolation**: `packages/core/src/config/interpolate.ts` handles `${VAR}` and `${VAR:-default}` at config load time from `process.env`. This is the only variable resolution mechanism needed -- no install-time substitution.

---

## Milestone 1: Agent Metadata and Source Resolution

**Goal**: Define the metadata schemas and build the source fetching layer.

This milestone establishes the data model and fetching infrastructure. An agent repository contains an `agent.yaml` (a standard herdctl agent config with `${VAR}` references for runtime environment variables), an optional `herdctl.json` (registry metadata), and supporting files (CLAUDE.md, knowledge/, etc.). We need a Zod schema for the `herdctl.json` metadata format, a schema for installation metadata (`metadata.json`), a source specifier parser, and repository fetching. This milestone produces no CLI commands or user-facing features -- it's pure library code in `@herdctl/core` with comprehensive tests.

### Phases

**Phase 1.1 - Agent Metadata Schema (`herdctl.json`)**
Define an `AgentRepoMetadataSchema` (Zod) that validates the `herdctl.json` file from agent repositories. This includes fields like `name`, `version`, `description`, `author`, `repository`, `license`, `keywords`, `requires` (herdctl version, runtime, env vars, workspace, docker), `category`, and `tags`. Write comprehensive tests covering valid metadata, missing required fields, and edge cases. This schema is used both during installation validation and (later) for registry listing.

**Phase 1.2 - Installation Metadata Schema (`metadata.json`)**
Define the schema for `metadata.json` that lives in each installed agent's directory root. This tracks: source (type, URL, ref/version) and installation timestamp. Design this schema to be extensible for the future agentic init feature (e.g., `initialization` fields can be added later without breaking existing installs).

**Phase 1.3 - Source Specifier Parsing**
Build a parser that takes a source string and resolves it to a structured specifier. Supported formats: `github:user/repo`, `github:user/repo@v1.0.0`, `github:user/repo@branch-name`, `./local/path`, and (reserved for future) bare names like `competitive-analysis` which would hit the registry. The parser should produce a typed union: `{ type: 'github', owner, repo, ref? }`, `{ type: 'local', path }`, or `{ type: 'registry', name }`. Include validation (e.g., GitHub owner/repo format) and good error messages for malformed specifiers.

**Phase 1.4 - Repository Fetching**
Implement the GitHub fetcher: shallow-clone a public or private repo to a temporary directory, optionally at a specific tag/branch/commit. Use `git clone --depth 1 [--branch <ref>]` via child process. Set `GIT_TERMINAL_PROMPT=0` to prevent interactive auth prompts from hanging. Handle auth failures gracefully with a helpful error message suggesting credential setup. Handle the temp directory lifecycle (create, return path, provide cleanup function). Also implement the local directory source: validate the path exists and contains agent repository files, then copy to a temp directory for consistent processing. Test with mocked git commands.

**Phase 1.5 - Repository Validation**
After fetching, validate that the directory looks like a valid agent repository: `agent.yaml` must exist and parse as valid YAML that conforms to `AgentConfigSchema`, `herdctl.json` is optional but validated against `AgentRepoMetadataSchema` if present. Validation should produce a structured result with warnings (not just pass/fail) so we can inform the user about optional files they might want to add. Also validate that `docker.network` is not set to `none`.

---

## Milestone 2: Installation Engine (Core MVP)

**Goal**: `herdctl agent add github:user/repo` works end-to-end as a CLI command, installing an agent into the local fleet.

This is the MVP milestone. It connects source fetching, validation, file copying, fleet config updating, and env var scanning into a complete installation flow. It also adds the first CLI command. By the end, a user can install an agent from GitHub and have it show up in their fleet.

### Phases

**Phase 2.1 - File Installation**
Implement the file copy pipeline: copy agent files from the fetched/temp directory to `./agents/<name>/` (where `<name>` comes from the `name` field in the repo's `agent.yaml`), strip `.git/` metadata, create the workspace directory, and write `metadata.json` with installation tracking info. If `./agents/<name>/` already exists, error with a clear message. The result is a fully self-contained agent directory with an `agent.yaml` that can be loaded by the existing config loader.

**Phase 2.2 - Fleet Config Integration**
Implement programmatic updating of `herdctl.yaml` to add the new agent reference. This means reading the existing fleet config, adding a new entry to the `agents:` array (`{ path: "./agents/<name>/agent.yaml" }`), and writing it back. Use the `yaml` library's document model to preserve comments and formatting as much as possible. If no `herdctl.yaml` exists, provide a helpful error telling the user to run `herdctl init` first.

**Phase 2.3 - Environment Variable Scanning**
Build a scanner that reads the installed `agent.yaml` as raw text, extracts all `${VAR}` and `${VAR:-default}` references, deduplicates them, and returns a structured list of variable names with their defaults (if any). This is used to print the post-install console message telling the user which environment variables to configure. No `.env` file is read or written.

**Phase 2.4 - CLI Command: `herdctl agent add`**
Wire everything together into the CLI command. Register an `agent` command group on the Commander program, add the `add` subcommand with options (`--path`, `--dry-run`). The command orchestrates: parse source specifier, fetch repository, validate, copy files, update fleet config, scan for env vars, print summary. Follow the existing CLI patterns (error handling, option conventions). Include the post-install summary showing installed files, config changes, and required environment variables.

**Phase 2.5 - Integration Testing**
Write integration-level tests for the full installation flow. Create a fixture agent repository (a minimal agent.yaml + herdctl.json) in the test fixtures, test installing from a local path, test fleet config updating, test env var scanning output. Mock git for GitHub source tests. Verify that the installed agent's config can be loaded by the existing `loadConfig()` function -- this is the critical integration point that proves installed agents work with the rest of herdctl.

---

## Milestone 3: Agent Lifecycle Management

**Goal**: List, inspect, and remove installed agents.

With installation working, this milestone adds the remaining management commands. Users need to see what's installed, inspect agent details, and remove agents cleanly.

### Phases

**Phase 3.1 - Agent Discovery and Listing**
Implement agent discovery: scan the `agents/` directory for installed agents (identified by having `metadata.json`), load their metadata, and return a structured list. Build the `herdctl agent list` CLI command that displays a table of installed agents with name, source, version, and install date. Distinguish between "installed" agents (have metadata.json, came from `agent add`) and "manual" agents (referenced in fleet config but not installed via the distribution system). The list command should work even when the fleet isn't running.

**Phase 3.2 - Agent Info Command**
Build `herdctl agent info <name>` that shows detailed information about an installed agent: full metadata (source, version, author, description), file listing, environment variables used (scanned from agent.yaml), schedules configured, workspace location, and installation date. For non-installed agents, show whatever info is available from the agent config file.

**Phase 3.3 - Agent Removal**
Implement `herdctl agent remove <name>` with confirmation prompt (skippable with `--force`). Removal should: delete the agent's directory from `agents/`, remove the agent reference from `herdctl.yaml`, and print which environment variables were used by this agent (so the user can clean up `.env` manually). Support `--keep-workspace` to preserve workspace data while removing the agent config. Verify the agent isn't currently running before removal.

---

## Milestone 4: Registry, Search, and Ecosystem

**Goal**: A discoverable agent ecosystem where users can find and install agents by name.

This milestone adds the registry -- a static JSON file hosted at herdctl.dev that maps agent names to GitHub repositories. It also adds search and browse capabilities. The registry is intentionally simple (a JSON file in a GitHub repo, no backend service) to keep operational complexity low.

### Phases

**Phase 4.1 - Registry Schema and Client**
Define the registry JSON schema (list of agent entries with name, description, author, repository, category, keywords, stats). Build a registry client in `@herdctl/core` that can fetch and cache the registry JSON from `https://herdctl.dev/registry.json`, search/filter entries by keyword and category, and resolve a bare agent name to a GitHub source specifier. The registry client should handle offline scenarios gracefully (cache with TTL, fall back to cached version if network unavailable).

**Phase 4.2 - CLI Search and Browse**
Add `herdctl agent search <query>` that searches the registry by keyword, name, and description. Support `--category` filtering. Display results as a table with name, description, author, and install command. Also support `herdctl agent search` with no args to show featured/popular agents. Wire the registry into `herdctl agent add` so that bare names (e.g., `herdctl agent add website-monitor`) resolve via the registry to their GitHub source.

**Phase 4.3 - Registry Infrastructure**
Set up the registry repository (`herdctl/registry` on GitHub): registry.json file, a submission script that validates an agent repo and adds it to the registry, a GitHub Actions CI pipeline that validates PRs (check that referenced repos exist, validate herdctl.json, run agent template validation), and documentation for how to submit an agent. This is infrastructure/ops work, not code in the main herdctl repo.

**Phase 4.4 - Documentation and Agent Authoring Guide**
Write comprehensive documentation for the agent distribution system: how to install agents (user guide), how to create and publish agents (author guide), agent.yaml reference, herdctl.json metadata reference, and registry submission process. Add docs pages at herdctl.dev covering the full workflow. Include the example agent repo as a reference implementation that agent authors can fork.

---

## Summary

| Milestone | Focus | Key Deliverables |
|-----------|-------|-----------------|
| **1. Metadata & Fetching** | Data model + source resolution | AgentRepoMetadataSchema, source parser, GitHub cloner, repo validation |
| **2. Installation MVP** | End-to-end install | File installation, fleet config integration, env var scanning, `herdctl agent add` command |
| **3. Lifecycle Mgmt** | List, info, remove | `agent list`, `agent info`, `agent remove` |
| **4. Registry** | Ecosystem | Registry schema/client, search command, registry infra, documentation |

Each milestone builds on the previous one and produces a usable increment. Milestone 2 is the critical MVP -- after that, users can install agents from GitHub. Milestones 3-4 add management and ecosystem.

### Design simplifications

The installation model is deliberately simple: **copy files, update fleet config, print what env vars are needed.** There is no template variable system, no install-time substitution, no interactive prompts, and no `.env` file management. Agent files in the repo are the same files that end up installed. All `${VAR}` references are runtime environment variables resolved by herdctl's existing interpolation system. The agent name comes from the `name` field in the repo's `agent.yaml` — the user doesn't choose it.

Agent updates (`herdctl agent update`) are intentionally deferred. The three-way merge problem (upstream changes vs user customizations) adds significant complexity without being essential for v1. Users can remove and re-add agents to pick up new versions.

The agentic init feature (conversational agent setup via `claude -p`) is intentionally excluded from this plan per the design doc's recommendation. However, every milestone is designed to be compatible with it: knowledge files are copied, metadata is extensible, the `init` command name is reserved, and workspaces are created during installation. When the time comes to add agentic init, it should be a contained addition on top of the infrastructure built here.
