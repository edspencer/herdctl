---
"@herdctl/slack": patch
---

feat: convert agent markdown output to Slack mrkdwn format

Wire `markdownToMrkdwn()` into the reply path so agent output renders correctly in Slack. Add conversions for headers, strikethrough, images, and horizontal rules.
