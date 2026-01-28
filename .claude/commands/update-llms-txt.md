# Update LLMs.txt Documentation

Regenerate the LLM-friendly documentation files based on current documentation state.

## Your Task

You are updating the herdctl LLM documentation files:
- `docs/public/llms.txt` - Condensed overview (~3-5KB)
- `docs/public/llms-full.txt` - Complete reference (~10-20KB)

## Process

### Step 1: Gather Current Documentation State

Read these files to understand the current docs structure:

1. **Sidebar structure**: `docs/astro.config.mjs` - look at the `sidebar` array
2. **All doc pages**: Scan `docs/src/content/docs/**/*.{md,mdx}`
3. **Existing llms.txt**: Read current `docs/public/llms.txt` and `docs/public/llms-full.txt`

### Step 2: Identify What's Changed

Compare the current docs to the existing llms.txt files:
- Are there new pages that aren't documented?
- Have configuration options changed?
- Are there new CLI commands?
- Have core concepts been updated?

### Step 3: Regenerate the Files

Follow the guidelines in `docs/scripts/generate-llms-txt.md` for structure and content.

#### llms.txt Structure (condensed)

```markdown
# herdctl

> One-line tagline

Brief overview (2-3 sentences).

## Quick Links
- Documentation, GitHub, npm links

## Packages
- List of npm packages with descriptions

## Core Concepts
- Brief definitions of key concepts (Agent, Work Source, Job, Fleet, etc.)

## Installation
- Prerequisites and install commands

## Basic Usage
- Minimal working example with code

## Documentation Structure
- List of all doc pages with URLs and brief descriptions
```

#### llms-full.txt Structure (complete)

Same as above, plus:
- Complete configuration reference (all YAML options)
- Full CLI reference (all commands with flags)
- Library API (FleetManager methods, events, error types)
- Integration details (Discord, GitHub)
- Real-world examples
- Troubleshooting section

### Step 4: Write the Files

Use the Write tool to update both files. Make sure to:
- Preserve the overall structure
- Update code examples to match current implementation
- Keep URLs accurate
- Include all new features/pages

## Content Guidelines

**DO include:**
- Code examples (YAML, TypeScript, CLI commands)
- Type information and defaults
- Tables for structured data
- Clear headers
- Links to full docs

**DON'T include:**
- Marketing fluff
- Duplicate information
- Internal implementation details
- Placeholder/example pages that aren't real docs

## After Updating

Report what changed:
- New sections added
- Sections updated
- Any sections removed
- File size changes
