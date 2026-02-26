# CLAUDE.md File Standard

When creating, editing, or reviewing CLAUDE.md files anywhere in the repository, follow the gold standard defined in `canon/claude-md-gold-standard.md`.

Key rules:
- Root CLAUDE.md stays under 150 lines. Package-level files target 30-60 lines. Module-level files target 15-30 lines.
- Use imperative language ("Use X", "Never do Y"), not descriptive ("The project uses X").
- Never duplicate content from a parent CLAUDE.md — it's already inherited.
- Only create a new CLAUDE.md when the directory has a different tech stack, contradicts parent conventions, or Claude makes repeatable mistakes without it.
- Reference detailed material rather than embedding it: tell Claude *when and why* to read a file, not just that it exists.
