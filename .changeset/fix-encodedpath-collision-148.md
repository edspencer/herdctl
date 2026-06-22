---
"@herdctl/core": patch
"@herdctl/web": patch
---

Fix lossy `encodedPath` collisions in session discovery (#148)

`encodePathForCli` maps every non-alphanumeric character to `-`, so different
working directories like `/a/b-c`, `/a-b/c`, and `/a/b/c` all encode to the same
`~/.claude/projects/-a-b-c` transcript directory. This is required to stay
byte-compatible with Claude Code (which collides them the exact same way, so the
encoding cannot be made reversible without pointing at a non-existent
directory), but it meant sessions from two colliding directories could be
cross-attributed during discovery.

Session discovery now disambiguates colliding directories by reading each
transcript's authoritative `cwd` field (Claude Code records the real working
directory inside every session's JSONL). New helpers `readSessionCwd` and
`sessionBelongsToWorkingDirectory` are exported from `@herdctl/core`, and
`getAllSessions` only consults them when an actual collision is detected, so the
common (unique-path) case pays no extra cost.

Also fixes `@herdctl/web`'s `chat.ts`, which derived `encodedPath` with a
slashes-only replacement (`workingDirectory.replace(/[/\\]/g, "-")`) that never
matched core's `DirectoryGroup.encodedPath` for any path containing a dot,
underscore, or other non-alphanumeric character; it now uses the shared
`encodePathForCli` encoder.
