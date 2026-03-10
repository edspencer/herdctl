---
"@herdctl/slack": patch
---

fix(slack): deduplicate assistant messages by finalized snapshot

Claude Code can emit intermediate JSONL snapshots (stop_reason: null) before the
final assistant message. The Slack manager now skips intermediates and deduplicates
by message.id to prevent duplicate messages in channels.
