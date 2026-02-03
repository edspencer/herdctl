---
"@herdctl/core": patch
---

Fix job summary extraction and improve Discord notification formatting.

**Summary extraction fix:**
Previously, the `extractSummary` function captured summaries from short assistant messages (≤500 characters), which meant if an agent sent a short preliminary message ("I'll fetch the weather...") followed by a long final response, the preliminary message would be used as the summary.

Now the logic tracks the last non-partial assistant message content separately and uses it as the summary, ensuring Discord hooks receive the actual final response.

**Truncation changes:**
- Removed truncation from core summary extraction (job-executor, message-processor) - full content is now stored
- Truncation is now handled solely by downstream consumers at their specific limits

**Discord notification improvements:**
- Moved output from embed field (1024 char limit) to embed description (4096 char limit)
- This allows much longer agent responses to be displayed in Discord notifications
- Metadata and error fields remain in their own fields with appropriate limits

This ensures Discord hooks and other consumers receive the full final response from the agent, with each consumer handling truncation at their own appropriate limits.
