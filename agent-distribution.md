# Agent Distribution System

**Status**: Design Phase
**Last Updated**: 2026-01-31

This document outlines the agent distribution and sharing system for herdctl, enabling users to easily discover, install, and share pre-configured agents.

---

## Table of Contents

- [Vision](#vision)
- [Agent Repository Structure](#agent-repository-structure)
- [Installation Flow](#installation-flow)
- [Directory Structure](#directory-structure)
- [CLI Commands](#cli-commands)
- [Environment Variables](#environment-variables)
- [Registry Design](#registry-design)
- [Security Model](#security-model)
- [Implementation Plan](#implementation-plan)
- [Use Cases](#use-cases)
- [Agent Initialization (Future)](#agent-initialization-future)

---

## Vision

**"ShadCN for herdctl agents"** - A simple, GitHub-based distribution system that makes it easy to share and reuse agent configurations.

### Goals

1. **Easy sharing**: Publish agents as GitHub repos
2. **Simple installation**: One command to install and configure
3. **Customizable**: Environment variables for personalization
4. **Discoverable**: Optional registry for finding agents
5. **Community-driven**: Anyone can create and share agents

### Non-Goals

- ❌ Complex package management (no dependency resolution, versioning is simple)
- ❌ Centralized hosting (agents live on GitHub, not our servers)
- ❌ Code execution during install (just file copying)

---

## Agent Repository Structure

An agent repository contains all files needed to run the agent.

**For a complete, working example with full file contents, see [example-agent-repo.md](./example-agent-repo.md)** - a website uptime monitor agent.

### Minimal Structure

```
competitive-analysis-agent/          # Repository root
├── agent.yaml                       # Agent configuration (required)
├── CLAUDE.md                        # Agent identity (optional)
└── README.md                        # Installation/usage docs (recommended)
```

### Full Structure

```
competitive-analysis-agent/
├── agent.yaml                       # Agent configuration (required)
├── CLAUDE.md                        # Agent identity/personality
├── README.md                        # Installation and usage guide
├── LICENSE                          # License file
├── herdctl.json                     # Agent metadata (for registry)
├── knowledge/                       # Domain knowledge files (referenced in CLAUDE.md)
│   ├── competitive-research-framework.md
│   ├── market-analysis-guide.md
│   └── industry-glossary.md
├── .claude/                         # Claude Code project config (optional)
│   └── commands/                    # Custom slash commands (optional)
│       ├── analyze-competitor.md
│       └── generate-report.md
└── templates/                       # Report templates (optional)
    ├── daily-summary.md
    └── weekly-report.md
```

**Note on knowledge files:** Knowledge files are regular markdown documents that the agent
reads at runtime. They are referenced in the agent's `CLAUDE.md` (e.g., "See
`knowledge/competitive-research-framework.md` for analysis procedures"). herdctl does not
manage them specially — they're just files that get copied during installation.

**Note on Claude Code integration:** Agents that set `setting_sources: ["project"]` in their
`agent.yaml` will have Claude Code discover their `CLAUDE.md` and `.claude/` directory
(including custom commands/skills) from the workspace. This is the standard Claude Code
project discovery mechanism.

### File Descriptions

| File | Required | Purpose |
|------|----------|---------|
| `agent.yaml` | ✅ | Agent configuration |
| `herdctl.json` | ⚠️ | Metadata for registry (required for registry listing) |
| `README.md` | Recommended | Setup instructions, usage guide |
| `CLAUDE.md` | Optional | Agent personality and instructions (discovered via `setting_sources`) |
| `knowledge/` | Optional | Domain-specific knowledge files (referenced in CLAUDE.md) |
| `.claude/commands/` | Optional | Custom Claude Code slash commands |

---

## Agent Metadata (herdctl.json)

The `herdctl.json` file contains metadata for registry listing and validation.

### Schema

```json
{
  "$schema": "https://herdctl.dev/schemas/agent-metadata.json",
  "name": "competitive-analysis",
  "version": "1.0.0",
  "description": "Daily competitive intelligence agent that monitors competitor websites and generates reports",
  "author": "edspencer",
  "repository": "github:edspencer/competitive-analysis-agent",
  "homepage": "https://github.com/edspencer/competitive-analysis-agent",
  "license": "MIT",
  "keywords": ["marketing", "competitive-analysis", "research", "monitoring"],

  "requires": {
    "herdctl": ">=0.1.0",
    "runtime": "cli",
    "env": [
      "COMPETITOR_WEBSITES",
      "DISCORD_WEBHOOK_URL"
    ],
    "workspace": true,
    "docker": false
  },

  "category": "marketing",
  "tags": ["monitoring", "automation", "reporting"],

  "screenshots": [
    "https://github.com/user/repo/blob/main/screenshots/dashboard.png"
  ],

  "examples": {
    "basic": "Simple daily competitive monitoring",
    "advanced": "Multi-competitor analysis with custom metrics"
  }
}
```

### Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Agent name (kebab-case, unique in registry) |
| `version` | string | Semantic version (1.0.0) |
| `description` | string | Short description (max 200 chars) |
| `author` | string | Author username or name |
| `repository` | string | GitHub repo (github:user/repo) |
| `license` | string | License identifier (MIT, Apache-2.0, etc.) |
| `keywords` | string[] | Search keywords |
| `requires.herdctl` | string | Min herdctl version (semver range) |
| `requires.runtime` | string | Required runtime (sdk/cli/both) |
| `requires.env` | string[] | Required environment variables |
| `requires.workspace` | boolean | Needs workspace directory |
| `requires.docker` | boolean | Requires Docker |
| `category` | string | Primary category |
| `tags` | string[] | Additional categorization |

---

## Agent Configuration (agent.yaml)

The `agent.yaml` is a standard herdctl agent configuration file. It conforms to
`AgentConfigSchema` — the same schema used for all agent config files. There is no
special template syntax or install-time processing.

Environment variable references (`${VAR}` / `${VAR:-default}`) in string values are
resolved at runtime by herdctl's existing interpolation system, using values from
`process.env` (typically loaded from a `.env` file). Agent authors use these for any
values that vary per installation — API keys, webhook URLs, schedule preferences, etc.

### Example

```yaml
name: competitive-analysis
description: "Competitive intelligence agent"

runtime: cli
working_directory: ./workspace  # Relative to agent directory

# Tell Claude Code to discover CLAUDE.md and .claude/ from the agent's workspace
setting_sources:
  - project

schedules:
  daily-competitive-scan:
    type: cron
    cron: "${CRON_SCHEDULE:-0 9 * * *}"
    prompt: |
      Check competitor websites: ${COMPETITOR_WEBSITES}

      Analyze for changes:
      - New features or product updates
      - Pricing changes
      - Blog posts and announcements
      - UI/UX changes
      - Job postings (hiring signals)

      Generate competitive intelligence report and post to:
      Discord: ${DISCORD_WEBHOOK_URL}

permission_mode: acceptEdits
allowed_tools:
  - Read
  - Write
  - WebFetch
  - Bash

docker:
  enabled: ${DOCKER_ENABLED:-false}
  network: bridge  # Agents need network access for Anthropic API
```

### Environment Variables

All `${VAR}` references are resolved at runtime from the user's environment (`.env` file
or `process.env`). There is no install-time variable substitution. This keeps the model
simple: the agent.yaml in the repository is the same file that ends up installed.

| Syntax | Meaning | Example |
|--------|---------|---------|
| `${VAR}` | Required (error if unset) | `${COMPETITOR_WEBSITES}` |
| `${VAR:-default}` | With default value | `${CRON_SCHEDULE:-0 9 * * *}` |

---

## Installation Flow

### Command

```bash
herdctl agent add github:user/repo [options]
```

### Options

```bash
--path <path>          # Install location (default: ./agents/<name>)
--dry-run              # Show what would be installed without installing
```

### Step-by-Step Flow

#### 1. Source Resolution

```bash
# User runs
herdctl agent add github:edspencer/competitive-analysis-agent

# CLI parses source
{
  type: 'github',
  owner: 'edspencer',
  repo: 'competitive-analysis-agent',
  ref: 'main'  // or specific tag/branch
}
```

#### 2. Clone Repository

```bash
# Clone to temporary directory
git clone --depth 1 https://github.com/edspencer/competitive-analysis-agent.git /tmp/herdctl-agent-xyz

# Or for specific version
git clone --branch v1.0.0 --depth 1 https://github.com/...
```

#### 3. Validate Structure

```typescript
// Check required files exist
const hasAgentYaml = existsSync(join(tempDir, 'agent.yaml'));
if (!hasAgentYaml) {
  throw new Error('Invalid agent repository: missing agent.yaml');
}

// Parse and validate agent.yaml against AgentConfigSchema
const agentConfig = await loadAndValidateAgent(tempDir);

// Parse and validate herdctl.json (optional)
const metadata = await loadAndValidateMetadata(tempDir);
```

#### 4. Copy Files

```bash
# Copy agent files to agents/ directory (name comes from agent.yaml)
cp -r /tmp/herdctl-agent-xyz ./agents/competitive-analysis/

# Remove git metadata
rm -rf ./agents/competitive-analysis/.git

# Create workspace directory within agent directory
mkdir -p ./agents/competitive-analysis/workspace
```

#### 5. Update Fleet Config

```yaml
# Append to fleet.yaml
agents:
  - path: ./agents/competitive-analysis/agent.yaml
```

#### 6. Post-Install Summary

```bash
✅ Agent 'competitive-analysis' installed successfully!

Files installed:
  ./agents/competitive-analysis/
    ├── agent.yaml
    ├── CLAUDE.md
    ├── knowledge/ (3 files)
    ├── README.md
    └── workspace/

Fleet config updated:
  herdctl.yaml (added agent reference)

⚠️  This agent requires the following environment variables:
  COMPETITOR_WEBSITES       (no default - required)
  DISCORD_WEBHOOK_URL       (no default - required)
  CRON_SCHEDULE             (default: 0 9 * * *)
  DOCKER_ENABLED            (default: false)

Add required variables to your .env file before starting the fleet.

Next steps:
  1. Add environment variables to .env
  2. Review agent config: cat ./agents/competitive-analysis/agent.yaml
  3. Test the agent: herdctl trigger competitive-analysis
  4. Start the fleet: herdctl start

Documentation:
  ./agents/competitive-analysis/README.md
  https://github.com/edspencer/competitive-analysis-agent
```

---

## CLI Commands

### `herdctl agent add`

Install an agent from a source.

```bash
# From GitHub
herdctl agent add github:user/repo

# From GitHub with version
herdctl agent add github:user/repo@v1.0.0

# From local directory (development)
herdctl agent add ./path/to/agent

# From registry (future)
herdctl agent add competitive-analysis

# Dry run
herdctl agent add github:user/repo --dry-run
```

### `herdctl agent list`

List installed agents.

```bash
# List all agents
herdctl agent list

# Output:
# Name                  Source                                      Version  Installed
# competitor-tracker    github:user/competitive-analysis-agent     1.0.0    2 days ago
# content-writer        github:user/content-agent                  0.5.0    1 week ago
# github-triager        ./agents/custom-triager                    -        3 days ago
```

### `herdctl agent info`

Show information about an installed agent.

```bash
herdctl agent info competitor-tracker

# Output:
# Name: competitor-tracker
# Description: Competitive intelligence for Acme SaaS Platform
# Source: github:edspencer/competitive-analysis-agent
# Version: 1.0.0
# Installed: 2 days ago
#
# Files:
#   ./agents/competitor-tracker/
#     ├── agent.yaml
#     ├── CLAUDE.md
#     ├── knowledge/ (3 files)
#     └── workspace/
#
# Environment variables:
#   COMPETITOR_WEBSITES
#   DISCORD_WEBHOOK_URL
#   SLACK_CHANNEL
#
# Schedules:
#   daily-competitive-scan (0 8 * * *)
```

### `herdctl agent update` (Future)

Update an installed agent to latest version. Deferred to a future release — the merge
strategy for preserving user customizations while applying upstream changes is complex
and not needed for the initial version.

```bash
# Update specific agent
herdctl agent update competitor-tracker

# Update all agents
herdctl agent update --all

# Check for updates without installing
herdctl agent update --check
```

### `herdctl agent remove`

Remove an installed agent.

```bash
# Remove agent
herdctl agent remove competitor-tracker

# Keep workspace
herdctl agent remove competitor-tracker --keep-workspace

# Remove without confirmation
herdctl agent remove competitor-tracker --force
```

**Removal process:**
1. Remove agent directory (`./agents/competitive-analysis/`) - includes all files and workspace
2. Remove agent reference from `herdctl.yaml`
3. Print which environment variables were used by the agent (user removes from `.env` manually)

### `herdctl agent search` (Future)

Search the agent registry.

```bash
# Search by keyword
herdctl agent search competitive

# Filter by category
herdctl agent search --category marketing

# Filter by author
herdctl agent search --author edspencer
```

---

## Directory Structure

### Convention

All agents installed via `herdctl agent add` are placed in the **`agents/`** directory relative to the `fleet.yaml` location. Each agent gets its own subdirectory containing all its files.

```
<fleet-directory>/
├── fleet.yaml                      # Fleet configuration
├── .env                            # Environment variables (user-managed)
├── agents/                         # All installed agents live here
│   ├── <agent-name-1>/            # Each agent in its own directory
│   │   ├── agent.yaml             # Agent herdctl config
│   │   ├── CLAUDE.md              # Agent identity (optional)
│   │   ├── knowledge/             # Knowledge files
│   │   ├── prompts/               # Custom prompts (optional)
│   │   ├── workspace/             # Agent's workspace files
│   │   └── ... (state, data, etc.)
│   └── <agent-name-2>/
│       └── ...
└── .herdctl/                       # Fleet-wide state
    └── state.yaml
```

**Key points:**
- Each agent is fully self-contained within its subdirectory
- Agent's workspace can be within its directory or separate
- State files, data, and logs stay within the agent's directory
- Easy to manage: backup (copy directory), remove (delete directory), version control (per-agent)

### Before Installation

```
my-project/
├── fleet.yaml
├── .env
└── agents/
    └── (empty)
```

### After Installing competitive-analysis

```
my-project/
├── fleet.yaml                      # Updated with agent reference
├── .env                            # User adds required env vars here
└── agents/
    └── competitive-analysis/       # Installed agent files
        ├── agent.yaml              # Copied from repo as-is
        ├── CLAUDE.md
        ├── README.md
        ├── metadata.json           # Installation metadata (created by herdctl)
        ├── knowledge/
        │   ├── competitive-research-framework.md
        │   └── market-analysis-guide.md
        └── workspace/              # Agent's workspace
            └── (agent writes here)
```

### Installation Metadata

Each installed agent gets a `metadata.json` in its directory root:

```json
{
  "source": "github:edspencer/competitive-analysis-agent",
  "version": "1.0.0",
  "ref": "main",
  "installedAt": "2026-01-31T12:00:00Z",
  "installedBy": "herdctl agent add"
}
```

### Multiple Instances

You can install the same agent repo multiple times to different paths. Each instance
gets its own directory and you edit the `name` field in `agent.yaml` to make them
unique:

```bash
herdctl agent add github:user/competitive-analysis-agent --path ./agents/competitive-analysis-acme
herdctl agent add github:user/competitive-analysis-agent --path ./agents/competitive-analysis-widgets
```

```
my-project/
├── fleet.yaml
└── agents/
    ├── competitive-analysis-acme/       # Instance 1
    │   ├── agent.yaml                   # Edit name: competitive-analysis-acme
    │   └── workspace/
    └── competitive-analysis-widgets/    # Instance 2
        ├── agent.yaml                   # Edit name: competitive-analysis-widgets
        └── workspace/
```

Use different environment variable names per instance (e.g., `ACME_WEBSITES`,
`WIDGETS_WEBSITES`) and update each agent.yaml accordingly.

---

## Environment Variables

Agent configuration uses herdctl's existing `${VAR}` / `${VAR:-default}` interpolation
for any values that vary per installation. All variables are resolved at **runtime** from
`process.env` (typically loaded from a `.env` file). There is no install-time variable
substitution.

### How It Works

1. Agent author writes `agent.yaml` with `${VAR}` references for configurable values
2. User installs agent with `herdctl agent add` — files are copied as-is
3. herdctl scans the installed `agent.yaml` for `${VAR}` references and prints what the user needs to set
4. User adds variables to their `.env` file
5. At runtime, herdctl's existing interpolator (`interpolate.ts`) resolves all references

### Variable Scanning

After installation, herdctl scans the agent.yaml for `${VAR}` references to inform the
user which environment variables they need to configure:

```typescript
// Scan agent.yaml for ${VAR} and ${VAR:-default} references
const varRegex = /\$\{([A-Z_][A-Z0-9_]*)(:-([^}]*))?\}/g;

for (const match of content.matchAll(varRegex)) {
  const name = match[1];
  const defaultValue = match[3];  // undefined if no default
  // Report to user: name, whether it has a default, what the default is
}
```

### herdctl Never Touches .env

herdctl does **not** read, write, or modify the user's `.env` file during installation
or removal. It only prints clear console messages telling the user which variables to
add or remove. This keeps the tool predictable and avoids surprises with shared or
sensitive environment files.

---

## Registry Design

### Registry Structure

The agent registry is a simple static JSON file hosted at `https://herdctl.dev/registry.json`:

```json
{
  "version": "1.0.0",
  "agents": {
    "competitive-analysis": {
      "name": "competitive-analysis",
      "version": "1.0.0",
      "description": "Daily competitive intelligence agent",
      "author": "edspencer",
      "repository": "github:edspencer/competitive-analysis-agent",
      "category": "marketing",
      "keywords": ["competitive-analysis", "monitoring", "research"],
      "downloads": 1234,
      "stars": 56,
      "updatedAt": "2026-01-15T10:00:00Z"
    },
    "content-writer": {
      "name": "content-writer",
      "version": "2.1.0",
      "description": "Automated content creation and scheduling",
      "author": "contentcrew",
      "repository": "github:contentcrew/content-writer-agent",
      "category": "content",
      "keywords": ["writing", "content", "automation"],
      "downloads": 5678,
      "stars": 123,
      "updatedAt": "2026-01-20T14:30:00Z"
    }
  },
  "categories": {
    "marketing": { "name": "Marketing", "description": "Marketing automation agents" },
    "development": { "name": "Development", "description": "Developer productivity agents" },
    "content": { "name": "Content", "description": "Content creation and management" },
    "operations": { "name": "Operations", "description": "DevOps and infrastructure" },
    "support": { "name": "Support", "description": "Customer support and engagement" }
  }
}
```

### Registry Submission

To submit an agent to the registry:

```bash
# 1. Ensure your repo has herdctl.json
cat herdctl.json

# 2. Submit PR to registry repo
gh repo clone herdctl/registry
cd registry
./scripts/add-agent.sh github:yourname/your-agent

# 3. Creates PR with validation
# - Validates herdctl.json schema
# - Checks repository exists
# - Verifies agent.yaml is valid
# - Adds entry to registry.json
```

### Registry Website

Simple static site at `herdctl.dev/agents`:

```
┌────────────────────────────────────────────────────┐
│ herdctl Agents                          [Search]   │
├────────────────────────────────────────────────────┤
│                                                    │
│ Categories: [All] [Marketing] [Development]       │
│                                                    │
│ ┌──────────────────────────────────────────────┐  │
│ │ Competitive Analysis              ⭐ 56      │  │
│ │ by edspencer                                 │  │
│ │                                              │  │
│ │ Daily competitive intelligence agent that   │  │
│ │ monitors competitor websites and generates  │  │
│ │ reports.                                     │  │
│ │                                              │  │
│ │ [Install] [View Docs] [GitHub]              │  │
│ └──────────────────────────────────────────────┘  │
│                                                    │
│ ┌──────────────────────────────────────────────┐  │
│ │ Content Writer                    ⭐ 123     │  │
│ │ by contentcrew                               │  │
│ │                                              │  │
│ │ Automated content creation and scheduling   │  │
│ │ with AI-powered writing assistance.         │  │
│ │                                              │  │
│ │ [Install] [View Docs] [GitHub]              │  │
│ └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

---

## Security Model

### Installation Safety

**What's allowed:**
- ✅ Clone public GitHub repos
- ✅ Copy files to local directory
- ✅ Parse and validate YAML/JSON
- ✅ Update fleet config (`herdctl.yaml`)

**What's NOT allowed:**
- ❌ Execute arbitrary code during installation
- ❌ Network requests except git clone
- ❌ Modify files outside project directory
- ❌ Read or write the user's `.env` file

### Repository Validation

```typescript
async function validateAgentRepo(repoPath: string): Promise<ValidationResult> {
  const checks = [
    // Required files
    () => checkFileExists(repoPath, 'agent.yaml'),

    // Valid YAML syntax
    () => validateYamlSyntax(join(repoPath, 'agent.yaml')),

    // Valid schema
    () => validateAgentSchema(join(repoPath, 'agent.yaml')),

    // No malicious patterns
    () => checkForMaliciousContent(repoPath),

    // Metadata validation (if present)
    () => validateMetadata(join(repoPath, 'herdctl.json')),
  ];

  for (const check of checks) {
    const result = await check();
    if (!result.valid) {
      return result;
    }
  }

  return { valid: true };
}
```

### Malicious Content Detection

```typescript
function checkForMaliciousContent(repoPath: string): ValidationResult {
  const dangerousPatterns = [
    // Command injection attempts
    /\$\(.*\)/g,
    /`.*`/g,

    // Suspicious bash commands
    /rm\s+-rf/g,
    /curl.*\|.*bash/g,

    // Credential harvesting
    /aws_secret_access_key/gi,
    /password\s*=\s*['"].*['"]/gi,
  ];

  // Scan all text files
  const files = glob.sync('**/*.{yaml,yml,md,sh}', { cwd: repoPath });

  for (const file of files) {
    const content = readFileSync(join(repoPath, file), 'utf-8');

    for (const pattern of dangerousPatterns) {
      if (pattern.test(content)) {
        return {
          valid: false,
          error: `Suspicious pattern found in ${file}`,
          pattern: pattern.source,
        };
      }
    }
  }

  return { valid: true };
}
```

### Sandboxing Recommendations

```yaml
# Recommended: Install agents with Docker enabled for isolation
agents:
  installed-agent:
    docker:
      enabled: true    # Sandboxed by default
      network: bridge  # Agents MUST have network access for Anthropic API
```

> **Important:** Never use `network: none` for Claude Code agents. Agents must be able to
> reach the Anthropic API to function. The `bridge` network mode provides container isolation
> (separate network namespace) while still allowing outbound internet access.

---

## Implementation Plan

### Phase 1: Core Installation (MVP)

**Goal**: `herdctl agent add github:user/repo` works

**Tasks**:
- [ ] CLI command: `herdctl agent add`
- [ ] Source specifier parsing (github:user/repo, local paths)
- [ ] GitHub repo cloning (shallow, with `GIT_TERMINAL_PROMPT=0`)
- [ ] Repository validation (agent.yaml exists, valid schema)
- [ ] File copying to `./agents/<name>/`
- [ ] Update `herdctl.yaml` (add agent reference)
- [ ] Write `metadata.json` (installation provenance)
- [ ] Scan and print required environment variables
- [ ] Workspace directory creation

**Deliverable**: Can install agents from GitHub

### Phase 2: Management Commands

**Goal**: Agent lifecycle management (install, list, info, remove)

**Tasks**:
- [ ] CLI command: `herdctl agent list`
- [ ] CLI command: `herdctl agent info`
- [ ] CLI command: `herdctl agent remove`
- [ ] Installation metadata tracking

**Deliverable**: Can manage installed agents

### Phase 3: Validation & Safety

**Goal**: Safe installation with validation

**Tasks**:
- [ ] Malicious content detection
- [ ] Dry-run mode
- [ ] Installation rollback on error

**Deliverable**: Safe, validated installations

### Phase 4: Registry

**Goal**: Discoverable agent ecosystem

**Tasks**:
- [ ] Registry JSON schema
- [ ] Registry submission process
- [ ] CLI command: `herdctl agent search`
- [ ] Registry website (static site)
- [ ] Registry validation CI
- [ ] Agent analytics (downloads, stars)

**Deliverable**: herdctl.dev/agents registry

### Phase 5: Developer Experience

**Goal**: Easy agent authoring

**Tasks**:
- [ ] CLI command: `herdctl agent init` (scaffold new agent)
- [ ] Agent template validator
- [ ] Local testing tools
- [ ] Publishing guide
- [ ] Example agent templates
- [ ] Documentation

**Deliverable**: Great DX for creating agents

---

## Use Cases

### Use Case 1: Install Competitive Analysis Agent

**Scenario**: User wants to monitor competitors

```bash
# Discover agent
herdctl agent search competitive

# Install
herdctl agent add github:marketingtools/competitive-analysis

# Add required env vars to .env
# COMPETITOR_WEBSITES=acme.com,widgetco.com
# DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...

# Result: Daily competitive intelligence reports
```

### Use Case 2: Share Internal Agent

**Scenario**: Company wants to share agent across teams

```bash
# Developer creates agent
cd ~/agents
herdctl agent init sales-intelligence
# ... configure agent ...

# Push to private GitHub
gh repo create acme-corp/sales-intelligence-agent --private
git push origin main

# Other teams install
herdctl agent add github:acme-corp/sales-intelligence-agent
# Requires GitHub auth for private repo
```

### Use Case 3: Agent Collection

**Scenario**: Install complete marketing automation suite

```bash
# Install full marketing suite
herdctl agent add github:marketing-suite/competitor-monitor
herdctl agent add github:marketing-suite/content-calendar
herdctl agent add github:marketing-suite/social-media-scheduler
herdctl agent add github:marketing-suite/analytics-reporter

# Result: 4 agents working together
```

### Use Case 4: Customize Community Agent

**Scenario**: Install agent and customize for specific needs

```bash
# Install base agent
herdctl agent add github:community/seo-monitor

# Customize knowledge files
edit ./agents/seo-monitor/knowledge/custom-metrics.md

# Add custom skills
cp my-seo-analyzer.md ./agents/seo-monitor/skills/

# Agent now uses custom knowledge and skills
```

### Use Case 5: Agent Development Workflow

**Scenario**: Developer creates and publishes agent

```bash
# 1. Initialize new agent
herdctl agent init my-awesome-agent
cd my-awesome-agent

# 2. Configure
edit agent.yaml
edit CLAUDE.md
edit herdctl.json

# 3. Test locally
herdctl agent add ./
herdctl trigger my-awesome-agent

# 4. Publish to GitHub
gh repo create my-awesome-agent --public
git push origin main

# 5. Submit to registry
gh repo clone herdctl/registry
./scripts/add-agent.sh github:myname/my-awesome-agent

# 6. Others can now install
# herdctl agent add my-awesome-agent
```

---

## Comparison to Similar Systems

### vs. ShadCN UI

| Aspect | ShadCN | herdctl agents |
|--------|--------|----------------|
| **Source** | Registry + GitHub | GitHub (registry future) |
| **Install command** | `npx shadcn-ui add button` | `herdctl agent add name` |
| **Customization** | Copy source, edit freely | Env vars + knowledge files |
| **Updates** | Re-run add (overwrites) | Remove + re-add (future: `agent update`) |
| **Language** | React/TypeScript | YAML + Markdown |
| **Ownership** | Yours after copy | Reference to source |

### vs. npm packages

| Aspect | npm | herdctl agents |
|--------|-----|----------------|
| **Dependencies** | Complex graph | None (flat) |
| **Versioning** | Semver with ranges | Simple semver |
| **Installation** | `npm install` | `herdctl agent add` |
| **Registry** | npmjs.com | herdctl.dev (future) |
| **Code execution** | install scripts | ❌ Never |
| **Customization** | Fork + publish | Env vars + local files |

### vs. Docker Hub

| Aspect | Docker Hub | herdctl agents |
|--------|------------|----------------|
| **Distribution** | Container images | GitHub repos |
| **Size** | Can be large | Small (text files) |
| **Security** | Image scanning | Content validation |
| **Versioning** | Tags | Git tags |
| **Customization** | Dockerfile extend | Environment variables |

---

## Future Enhancements

### Agent Packs

Bundle multiple related agents:

```bash
herdctl pack add marketing-automation
# Installs: competitor-monitor, content-calendar, social-scheduler
```

### Agent Marketplace

Paid/premium agents with licensing:

```yaml
# herdctl.json
"pricing": {
  "model": "subscription",
  "price": "$20/month",
  "trial": "14 days"
}
```

### Agent Dependencies

Agents that build on other agents:

```yaml
# herdctl.json
"dependencies": {
  "base-reporter": "^1.0.0"
}
```

### Visual Agent Builder

Web UI for creating agents without YAML:

```
herdctl.dev/builder
- Drag-and-drop schedule configuration
- Visual prompt builder
- Knowledge file editor
- One-click publish
```

---

## Open Questions

1. ~~**Agent updates**: How to handle when agent.yaml changes?~~ **Resolved**: Deferred to a future version. Users can remove and re-add to "update" for now.

2. ~~**Knowledge file customization**: Should users edit in place or overlay?~~ **Resolved**: Edit in place. Knowledge files live in the agent directory and users modify them directly.

3. **Multi-instance naming**: Enforce naming convention?
   - `agent-name-1`, `agent-name-2`?
   - User picks arbitrary names?

4. **Registry moderation**: How to prevent malicious agents?
   - Manual review?
   - Automated scanning?
   - Community reporting?

---

## Success Metrics

- **Adoption**: Number of agents installed
- **Creation**: Number of agents published
- **Quality**: Average stars/downloads per agent
- **Diversity**: Number of categories covered
- **Community**: Number of contributors

**Target (6 months post-launch)**:
- 50+ agents in registry
- 1000+ installations
- 20+ contributors
- 5+ categories

---

## Appendix: Example Agent Repository

**Complete example with all file contents:**
- [example-agent-repo.md](./example-agent-repo.md) - Website uptime monitor agent with full file contents

**Official template repository:**
- [github.com/herdctl/agent-template](https://github.com/herdctl/agent-template) - Scaffolding tool and best practices

The example shows:
- Complete directory structure
- All file contents (agent.yaml, CLAUDE.md, knowledge files, etc.)
- Environment variable usage
- Discord webhook integration
- State management in workspace
- Real-world monitoring logic

---

## Agent Initialization (Future)

**Status**: Deferred to Phase 2+
**Rationale**: Focus on producing high-quality basic agent installation flows first. This feature represents the vision for agent personalization but requires the core installation mechanics to be solid.

### Vision

Many agents need to gather personalized information before they can operate effectively. Rather than building complex forms or scripting systems, herdctl will use Claude's natural conversational ability.

### Philosophy

**Use the LLM for what it's good at**: natural conversation, fuzzy understanding, and adaptation. Don't force rigid data structures when a conversation works better.

### How It Would Work

1. **Agent defines init in knowledge files**: Agents document their initialization needs in `knowledge/initialization.md`
2. **Detection**: Agent's CLAUDE.md checks for required data files on startup
3. **User prompt**: If init is needed, herdctl asks user if they want to run it
4. **Simple execution**: Just runs `claude -p` with the agent in its workspace
5. **Agent-driven**: The agent conducts the conversation and writes its own data files

### Example: Hurricane Tracker

**Agent Repository Structure:**
```
hurricane-tracker/
├── agent.yaml
├── CLAUDE.md                      # References initialization.md
├── README.md
└── knowledge/
    ├── initialization.md          # Init instructions for agent
    ├── hurricane-tracking.md
    └── emergency-planning.md
```

**knowledge/initialization.md:**
```markdown
# Initialization

On first run, this agent needs to gather personalized information.

## Check for Existing Data

Look for these files in the workspace:
- `location.json` - User's location and evacuation zone
- `household.json` - Household members, pets, medical needs
- `emergency-plan.md` - Evacuation plan and supplies

If any are missing, run initialization.

## Initialization Process

1. **Location Setup**
   - Ask for Florida address
   - Use WebFetch to look up coordinates via geocoding API
   - Determine evacuation zone (A-E) based on location
   - Ask about distance from coast
   - Create `location.json`

2. **Household Profile**
   - Ask how many people live there (names optional)
   - Ask about pets (type, count)
   - Ask about medical needs (medications, mobility issues)
   - Ask about vehicles available for evacuation
   - Create `household.json`

3. **Emergency Plan**
   - Ask about evacuation destination (family/hotel)
   - Calculate supply needs based on household size
   - Generate personalized supply checklist
   - Create `emergency-plan.md` and `supply-checklist.md`

4. **Verification**
   - Show summary of collected information
   - Ask user to confirm or make corrections
   - Explain what the agent will do (daily checks, alerts, etc.)

Be conversational and reassuring. This is about hurricane safety.
```

**CLAUDE.md:**
```markdown
# Hurricane Tracker Agent

You are a hurricane tracking and emergency preparedness assistant for Florida residents.

## First Run Detection

On startup, check if `location.json` exists in the workspace.

If not, you need to initialize:
1. Read `knowledge/initialization.md`
2. Follow the initialization process
3. Create the required data files

## Daily Operation

Once initialized:
- Check NOAA for active tropical systems
- Calculate distance and trajectory to user's location
- Assess threat level based on evacuation zone
- Provide appropriate alerts and recommendations

See `knowledge/hurricane-tracking.md` for detailed procedures.
```

### Installation Experience

```bash
herdctl agent add github:weather/hurricane-tracker

# Normal installation happens...
✅ Agent 'hurricane-tracker' installed!

# herdctl detects agent may need initialization
This agent requires initial setup. Would you like to run
initialization now? (Y/n): y

Starting initialization conversation...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌀 Hurricane Tracker
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Hi! I'm your hurricane tracking assistant. I see this is
your first time running me. Let me gather some information
to set up personalized tracking and alerts.

First, I need to know where you're located. What's your
home address in Florida?

You: 123 Main St, Tampa, FL 33601

Great! Let me look up your coordinates and evacuation zone...

[Agent uses WebFetch to geocode]

I found your location:
  📍 27.9506°N, 82.4572°W
  🏘️ Evacuation Zone: A (coastal, high-risk)
  📮 Hillsborough County

Since you're in Zone A, you'll need to evacuate for any
Category 3+ hurricanes. I'll monitor storms and alert you
72 hours before projected landfall in your area.

Now, tell me about your household. How many people live
with you?

You: Just me and my wife

Any pets?

You: Two cats

Perfect. For 2 people and 2 cats, I'll calculate supply
needs accordingly. Do either of you have medical needs
or medications I should know about for emergency planning?

You: My wife needs insulin, which has to be refrigerated

That's important - I'll make sure to remind you about
bringing a cooler with ice packs, and I'll recommend
evacuating earlier if extended power outages are expected.

Where would you evacuate to?

You: My brother's place in Atlanta

Excellent - Atlanta is about 450 miles north, well outside
typical hurricane paths. I'll factor in drive time when
recommending when to leave.

Let me create your emergency plan...

[Agent writes files]

✅ Created location.json
✅ Created household.json
✅ Created supply-checklist.md
✅ Created emergency-plan.md

All set! I'll now monitor the Atlantic and Gulf for
tropical activity. You'll get:

📊 Daily updates during hurricane season (Jun-Nov)
⚠️ Immediate alerts when storms threaten your area
📋 Personalized preparation reminders
🚗 Evacuation timing recommendations

You can review your emergency plan anytime at:
  ./workspace/hurricane-tracker/emergency-plan.md

Want to test an alert now? (y/N): n

Great! I'll start monitoring. Stay safe! 🌴

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Agent initialized successfully!

Next steps:
  1. Review emergency plan: ./workspace/hurricane-tracker/
  2. Start monitoring: herdctl start
  3. Manual check anytime: herdctl trigger hurricane-tracker
```

### Implementation Approach

Minimal - just spawn `claude -p`:

```typescript
// In herdctl agent add command

async function maybeRunInit(agent: AgentConfig) {
  // Check if agent suggests initialization
  // (could check for knowledge/initialization.md or init hint in metadata)
  const hasInitDocs = existsSync(join(agentDir, 'knowledge', 'initialization.md'));

  if (!hasInitDocs) {
    return; // No init needed
  }

  // Ask user
  const shouldInit = await confirm(
    'This agent requires initial setup. Would you like to run initialization now?',
    true
  );

  if (!shouldInit) {
    console.log('\nYou can run initialization later with:');
    console.log(`  herdctl agent init ${agent.name}`);
    return;
  }

  console.log('\nStarting initialization conversation...\n');

  // Just spawn claude -p
  const claude = spawn('claude', [
    '-p', 'This is your first run. Please check if you need initialization and run it if necessary.',
    '--permission-mode', 'acceptEdits',  // Can write data files
    '--setting-sources', 'project',      // Load CLAUDE.md and knowledge/
  ], {
    cwd: agent.workspace,
    stdio: 'inherit',  // User interacts directly with Claude
  });

  await waitForExit(claude);

  console.log('\n✅ Agent initialized successfully!\n');
}
```

### Optional Metadata Hint

Agents can optionally hint about initialization in metadata:

```json
// herdctl.json
{
  "name": "hurricane-tracker",
  "version": "1.0.0",
  "initialization": {
    "required": true,
    "description": "Gathers your location and household information for personalized hurricane tracking"
  }
}
```

Or omit entirely - the agent's CLAUDE.md handles detection.

### CLI Commands

**`herdctl agent init`** - Run or re-run agent initialization

```bash
# Initialize an agent
herdctl agent init hurricane-tracker

# Force re-initialization (overwrites existing data)
herdctl agent init hurricane-tracker --force
```

**What it does:**
- Spawns `claude -p` in the agent's workspace
- Agent reads its `knowledge/initialization.md` and CLAUDE.md
- Conducts conversational setup with user
- Creates/updates data files (location.json, etc.)

**When to use:**
- First-time setup (if skipped during installation)
- Update location or household information
- Reset agent's personalized data
- Add new data (e.g., add more products to price tracker)

### Different Agent Types

**Simple (Price Tracker):**
```markdown
# knowledge/initialization.md
Ask user to paste their Amazon wishlist URL or CSV of products.
Parse it and create products.json with target prices.
```

**Medium (Garden Planner):**
```markdown
# knowledge/initialization.md
1. Ask for ZIP code, determine hardiness zone
2. Ask about garden size, sun exposure, soil type
3. Ask what vegetables they want to grow
4. Create planting calendar based on frost dates
```

**Complex (Hurricane Tracker):**
```markdown
# knowledge/initialization.md
Full conversation about location, household, medical needs,
evacuation plans, emergency contacts, supply inventory.
```

All using the same mechanism: `claude -p` + agent's knowledge files.

### Benefits

✅ **No infrastructure** - Just use Claude's natural conversation
✅ **Flexible** - Each agent decides its own init flow
✅ **Natural** - LLM does what it's good at
✅ **Transparent** - User sees exactly what's happening
✅ **Agent-controlled** - Agents write their own data files
✅ **Familiar** - Same Claude interaction users already know

### Why Deferred

This is a compelling feature, but it depends on having solid:
1. Agent installation mechanics
2. Directory structure conventions
3. Workspace management

Focus Phase 1 on getting those right. Once the basic install/remove flow is rock-solid, this conversational initialization will be a natural addition that makes agents even more powerful and personalized.
