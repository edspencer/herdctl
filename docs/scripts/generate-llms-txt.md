# Generating llms.txt Files

This document describes how to regenerate the LLM-friendly documentation files when the docs change significantly.

## Files We Generate

| File | Purpose | Size Target |
|------|---------|-------------|
| `/public/llms.txt` | Condensed overview for quick context | ~3-5KB |
| `/public/llms-full.txt` | Complete reference documentation | ~10-20KB |

## When to Regenerate

Regenerate these files when:
- Adding new major features or concepts
- Changing CLI commands or API
- Restructuring documentation
- Major configuration schema changes

Minor typo fixes or prose improvements don't require regeneration.

## Process

### Step 1: Gather Current Documentation Structure

```bash
# List all documentation pages
find docs/src/content/docs -name "*.md" -o -name "*.mdx" | sort

# Check the sidebar structure in astro.config.mjs
# This shows the canonical organization of docs
```

### Step 2: Identify Key Content Areas

The llms.txt should cover these sections (in order of importance):

1. **Project Overview** - What is herdctl, what problem does it solve
2. **Quick Links** - GitHub, npm, docs URL
3. **Packages** - List of npm packages and their purposes
4. **Core Concepts** - Agents, Work Sources, Jobs, Fleet (brief definitions)
5. **Installation** - Prerequisites and install commands
6. **Basic Usage** - Minimal working example
7. **Documentation Map** - List of all doc pages with URLs and brief descriptions

### Step 3: For llms-full.txt, Add

8. **Complete Configuration Reference** - All YAML options with types and examples
9. **CLI Reference** - All commands with flags
10. **Library API** - FleetManager methods, events, error types
11. **Integration Details** - Discord setup, GitHub work source
12. **Examples** - Real-world agent configurations
13. **Troubleshooting** - Common issues and solutions

### Step 4: Content Guidelines

#### Do Include
- Code examples (YAML configs, TypeScript snippets, CLI commands)
- Type information and defaults for config options
- Tables for structured reference data
- Clear section headers with consistent hierarchy
- Links to full documentation pages

#### Don't Include
- Marketing language or promotional content
- Lengthy explanations when a code example suffices
- Internal implementation details unless relevant to users
- Duplicate information (reference once, link elsewhere)

#### Formatting Rules
- Use markdown headers (`#`, `##`, `###`)
- Use fenced code blocks with language tags
- Keep line lengths reasonable (no hard wrap needed)
- Use tables for option references
- Start with a blockquote summary

### Step 5: Validate

After regenerating:

```bash
# Check file sizes are reasonable
ls -la docs/public/llms*.txt

# Build docs to verify files are included
cd docs && pnpm build

# Check output
ls -la docs/dist/llms*.txt
```

## Using Claude Code to Regenerate

You can ask Claude Code to regenerate these files:

```
Please regenerate docs/public/llms.txt and docs/public/llms-full.txt based on the current documentation.

Read these files to understand current docs:
- docs/astro.config.mjs (for structure)
- All files in docs/src/content/docs/

Follow the process in docs/scripts/generate-llms-txt.md
```

## Template Structure

### llms.txt Template

```markdown
# herdctl

> One-line description

Brief 2-3 sentence overview.

## Quick Links

- Documentation: https://herdctl.dev
- GitHub: https://github.com/edspencer/herdctl
- npm: https://www.npmjs.com/package/herdctl

## Packages

- `package-name` - Description

## Core Concepts

### Concept Name
Brief definition (1-2 sentences max)

## Installation

\`\`\`bash
npm install -g herdctl
\`\`\`

## Basic Usage

Minimal working example with code.

## Documentation Structure

### Section Name
- /path/to/page/ - Brief description
```

### llms-full.txt Template

Same as above, plus:

```markdown
---

## Configuration Reference

### Section (e.g., Fleet Configuration)

Complete YAML schema with all options documented.

## CLI Reference

### Command Category

All commands with flags and examples.

## Library Reference

### Class/Function

Methods, events, types.

## Examples

Real-world configurations.

## Troubleshooting

Common issues and solutions.
```

## Automation Ideas

Future improvements could include:
- Script to extract headings and code blocks from all .md/.mdx files
- Auto-generate documentation map from astro.config.mjs sidebar
- CI check that llms.txt was updated when docs change significantly
- Diff tool to highlight what changed in docs since last llms.txt update
