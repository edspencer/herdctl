---
"@herdctl/core": patch
---

Fix same-process cross-agent session resume and resume-after-cwd-change (issues #263, #126).

The job executor's resume gate (`JobExecutor.execute`, step 3.5) only honored a caller-provided `resume` session ID when the agent already had a *matching agent-level session pointer* on disk (`.herdctl/sessions/<agent>.json`). When an agent was asked to resume a session it had never owned — e.g. adopting a session another agent created in the same process (#263) — the explicit `resume` was silently dropped and the runtime forked a brand-new session, losing all prior context. A process restart appeared to "fix" it; nothing at runtime did.

This change makes the executor adopt an explicit caller-provided session when the agent has *never* owned an agent-level session (distinguished from the expired-and-cleared case via a non-timeout pointer read), persisting an agent-level pointer so future runs and restarts treat the session as owned. For the native CLI runtime it only adopts when the transcript actually exists in the agent's working directory (Claude Code keys session storage by spawn cwd); SDK/Docker runtimes adopt directly.

It also adds a post-loop session-not-found retry: the CLI runtime *yields* a terminal error (rather than throwing) when `claude --resume` can't find a session — e.g. after a `working_directory` change relocates the transcript — so the existing catch-block retry never ran. The yielded-error path now clears the stale pointer and retries once with a fresh session, mirroring the thrown-error recovery.
