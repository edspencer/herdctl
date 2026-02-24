# Context Management

## Use Sub-Agents for Non-Trivial Work

Your context window is finite. Protect it aggressively.

**Default to sub-agents** (Task tool) whenever work involves:
- Reading more than 2-3 files to gather information
- Exploring the codebase for patterns, conventions, or understanding
- Implementing changes across multiple files
- Running audits, reviews, or analysis passes
- Any task where you'd be tempted to read a lot of code yourself

**Parallelize sub-agents** when tasks are independent. Launch them in a single message with multiple Task tool calls rather than sequentially.

**Be specific in sub-agent prompts.** Each sub-agent starts with a blank context — tell it exactly what to do, what files matter, and what format to return results in. Don't assume it knows what you've been discussing.

## Minimize Direct Context Usage

- Don't read files speculatively. Know what you need before reading it.
- Use Glob/Grep to locate targets, then read only the relevant files.
- For open-ended exploration, use the Explore sub-agent type — that's what it's for.
- Prefer editing existing files over reading the whole file and rewriting it.

## Break Work Into Commits

Commit completed work before moving on to the next piece. If context runs out mid-session, committed work is safe. Uncommitted work may be lost or require re-doing after automatic summarization.

## Plan Before Executing

For multi-step tasks, use plan mode or the TodoWrite tool to decompose work before starting. Each sub-task should be completable within a reasonable context budget. If a task feels too large for one pass, it is — split it up and use sub-agents.
