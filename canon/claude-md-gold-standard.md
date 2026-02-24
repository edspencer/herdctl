# CLAUDE.md Gold Standard

This document defines the canonical standard for CLAUDE.md files across the herdctl repository. It governs when files should exist, what they should contain, how they should be written, and how they are maintained.

## Sources

This standard draws from the following sources, referenced throughout as `[S1]`, `[S2]`, etc.

| Ref | Source | URL |
|-----|--------|-----|
| S1 | Anthropic — Claude Code Memory Documentation | https://code.claude.com/docs/en/memory |
| S2 | shanraisshan — Claude Code Best Practice (4.6k stars) | https://github.com/shanraisshan/claude-code-best-practice |
| S3 | shanraisshan — CLAUDE.md for Larger Mono Repos | https://github.com/shanraisshan/claude-code-best-practice/blob/main/reports/claude-md-for-larger-mono-repos.md |
| S4 | SFEIR Institute — CLAUDE.md Memory System Deep Dive | https://institute.sfeir.com/en/claude-code/claude-code-memory-system-claude-md/deep-dive/ |
| S5 | Shrivu Shankar — How I Use Every Claude Code Feature | https://blog.sshh.io/p/how-i-use-every-claude-code-feature |
| S6 | anvodev — How I Organized My CLAUDE.md in a Monorepo | https://dev.to/anvodev/how-i-organized-my-claudemd-in-a-monorepo-with-too-many-contexts-37k7 |
| S7 | claudefa.st — Claude Code Rules Directory | https://claudefa.st/blog/guide/mechanics/rules-directory |
| S8 | paddo.dev — Claude Code Gets Path-Specific Rules | https://paddo.dev/blog/claude-rules-path-specific-native/ |
| S9 | GitHub Issue #16299 — Path-scoped rules load globally | https://github.com/anthropics/claude-code/issues/16299 |

## How CLAUDE.md Loading Works

Understanding the loading mechanics is essential for making good placement decisions.

### Ancestor loading (upward, eager)

When Claude Code starts, it walks upward from the working directory toward the filesystem root and loads every CLAUDE.md it finds. These are loaded immediately and always present in context. [S1]

### Descendant loading (downward, lazy)

CLAUDE.md files in subdirectories below the working directory are NOT loaded at launch. They are only included when Claude reads or edits files in those subdirectories during the session. [S1, S3]

### .claude/rules/ loading

All `.md` files in `.claude/rules/` are loaded at session start with the same priority as `.claude/CLAUDE.md`. The `paths` frontmatter for conditional loading is documented [S1] but currently broken — all rules files load regardless of path scope [S9]. Descendant CLAUDE.md files remain the only reliable mechanism for conditional context loading.

### Practical implication

Putting a CLAUDE.md inside `packages/core/src/scheduler/` costs zero tokens until Claude touches a file in that directory. At that point — and only at that point — the file enters context and provides precisely scoped guidance. This makes per-directory CLAUDE.md files the most context-efficient way to provide targeted instructions.

## When a CLAUDE.md Should Exist

### The three-question test

A directory warrants its own CLAUDE.md when any of the following are true:

1. **Different technology stack.** The directory uses a framework, language, or tooling that differs from what the parent CLAUDE.md describes. [S3, S6]

2. **Conventions that contradict or specialize the parent.** The directory has its own error handling pattern, logging approach, testing conventions, or architectural constraints that Claude would not infer from the parent. [S3, S5]

3. **Claude makes repeatable mistakes without it.** Not "might be slightly less informed" but "will concretely do X wrong." If you find yourself correcting Claude about the same thing in the same directory, that correction belongs in a CLAUDE.md. [S5]

### The reactive principle

Do not preemptively create CLAUDE.md files for every directory. Start with the root and add files reactively when you observe Claude making mistakes or when a directory clearly meets the three-question test. "Your CLAUDE.md should start small, documenting based on what Claude is getting wrong." [S5]

### Size thresholds that indicate splitting

If a CLAUDE.md exceeds 150 lines, it is likely trying to cover too much scope and should be split into child CLAUDE.md files or .claude/rules/ files. [S2] Files under 200 lines achieve a 92% rule application rate; beyond 400 lines, compliance drops to 71%. [S4]

## What Goes In Each Level

### Root CLAUDE.md (always loaded)

The root file covers project-wide concerns that apply regardless of which directory Claude is working in.

**Must include:**
- Project overview (what the project is, one paragraph)
- Repository structure (directory tree, brief descriptions)
- Development commands (build, test, lint, typecheck)
- Code conventions shared across all packages (language, formatting, naming)
- Quality gates (what must pass before merging)

**Must not include:**
- Package-specific conventions (put in package CLAUDE.md)
- Reference material like color palettes, API lists, schema details (put in .claude/rules/ or canon/)
- Anything over 150 lines [S2]

**Target size:** 80-150 lines. [S2]

### Package-level CLAUDE.md (lazy-loaded)

Package-level files cover conventions specific to one package that differ from or extend the root.

**Should include:**
- Package purpose and architectural role (one paragraph)
- Technology stack if different from root (frameworks, libraries)
- Key conventions unique to this package
- Package-specific commands (if different from root)
- Important files or module structure (brief table or list)

**Must not include:**
- Repetition of root CLAUDE.md content (it's already inherited)
- Full API documentation (link to docs or source instead)
- Content that applies equally to sibling packages (put in a shared .claude/rules/ file or parent CLAUDE.md)

**Target size:** 30-60 lines.

### Module-level CLAUDE.md (lazy-loaded, deep)

Module-level files are placed inside subdirectories within a package (e.g., `packages/core/src/scheduler/CLAUDE.md`). These are the most precisely scoped and context-efficient files.

**Should include:**
- Module purpose (one or two sentences)
- Key types and their relationships
- Non-obvious patterns or gotchas Claude should know
- Critical invariants that must not be violated

**Must not include:**
- Anything the parent or root CLAUDE.md already covers
- Documentation that belongs in code comments
- Implementation details that are obvious from reading the code

**Target size:** 15-30 lines.

## How to Write Effective Instructions

### Use imperative language

Imperative rules ("Use createLogger, never raw console.log") achieve 94% compliance. Descriptive language ("The project uses createLogger for logging") achieves 73%. [S4]

### Be specific and concrete

"Use 2-space indentation" is better than "Format code properly." [S1] Include specific function names, file paths, and patterns rather than abstract guidance.

### Treat context as scarce

"Keeping your CLAUDE.md as short as possible is a fantastic forcing function for simplifying your codebase and internal tooling." [S5] Every line must earn its place. If removing a line would not cause Claude to make a mistake, remove it.

### Reference rather than reproduce

For detailed reference material (color palettes, full API surfaces, configuration schemas), use the pointer pattern: a brief instruction in the CLAUDE.md that tells Claude when and where to look up the details.

Example: "For color tokens and component patterns, read packages/web/DESIGN_SYSTEM.md before writing any UI code."

This is more effective than embedding the reference material directly, because it loads only when relevant and the instruction tells Claude *when* to read it, not just that it exists. "You have to pitch the agent on why and when to read the file." [S5]

### One topic per file in .claude/rules/

Modular rule files (5 files of ~30 lines each) achieve a 96% application rate, compared to 92% for a single 150-line CLAUDE.md. [S4] Keep each rules file focused on one concern.

## Relationship Between CLAUDE.md and .claude/rules/

These two mechanisms serve different purposes:

| Mechanism | Loaded when | Best for |
|-----------|-------------|----------|
| Root CLAUDE.md | Always (eager) | Project overview, structure, shared conventions |
| .claude/rules/*.md | Always (eager, despite path frontmatter [S9]) | Topic-specific instructions that apply broadly |
| Package/module CLAUDE.md | On file access (lazy) | Directory-specific conventions that differ from parent |

**Use .claude/rules/** when the instruction applies across multiple directories or is a cross-cutting concern (git workflow, commit conventions, testing philosophy).

**Use a directory CLAUDE.md** when the instruction is specific to one directory subtree and Claude doesn't need it when working elsewhere.

Do not duplicate content between the two. Each piece of guidance should live in exactly one place.

## Maintenance

### Staleness is worse than absence

A CLAUDE.md with outdated instructions will cause Claude to confidently follow wrong guidance. An absent CLAUDE.md means Claude infers from context, which is usually acceptable. When in doubt, delete rather than leave stale content.

### Update triggers

A CLAUDE.md should be reviewed when:
- A function, type, or pattern it references is renamed or removed
- A convention it describes changes
- A new module is added that changes the directory's scope
- Claude repeatedly does something wrong that the file should prevent

### Automated maintenance

The herdctl project uses a daily scheduled agent to check recent commits against existing CLAUDE.md files and propose updates via pull request. This agent:
1. Examines commits since the last run
2. Identifies directories with meaningful code changes
3. Checks whether CLAUDE.md files in those directories still accurately reflect the code
4. Proposes a PR with updates if any files are stale, missing, or should be created

The agent measures the repository against this gold standard document.

## Current herdctl File Inventory

This table is the authoritative list of CLAUDE.md files that should exist in the repository. It should be updated when files are added or removed.

| File | Lines | Justification |
|------|-------|---------------|
| `CLAUDE.md` (root) | ~102 | Project overview, shared conventions, quality gates |
| `packages/core/CLAUDE.md` | ~44 | Unique module structure, relative imports, specific coverage thresholds |
| `packages/cli/CLAUDE.md` | ~41 | Thin-client boundary enforcement — prevents business logic in CLI handlers |
| `packages/web/CLAUDE.md` | ~61 | Different tech stack (React/Vite/Tailwind), design system, Zustand/Router |
| `packages/chat/CLAUDE.md` | ~46 | Dependency-injected logger, session management, typed ChatErrorCode |
| `packages/discord/CLAUDE.md` | ~40 | Custom DiscordLogger, discord.js mocking, DiscordErrorCode hierarchy |
| `packages/slack/CLAUDE.md` | ~39 | Socket Mode, mrkdwn formatting, SlackErrorCode hierarchy |

Additional CLAUDE.md files may be added at the module level (e.g., `packages/core/src/scheduler/CLAUDE.md`) following the three-question test and reactive principle described above.
