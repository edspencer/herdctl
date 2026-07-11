---
"@herdctl/core": patch
---

perf(state): stop duplicating tool output in the parsed message payload

`parseSessionMessages` stored each tool result's (often large) output **twice** —
once as the message's top-level `content` and again as `toolCall.output` — so both
copies were serialized into the `/messages` payload, roughly doubling tool-output
bytes on the wire for tool-heavy chats.

Consumers (the web dashboard, Paddock's chat UI, the sweep summary) render tool
messages exclusively from `toolCall.output`; the top-level `content` copy for a
tool message was never read. `content` is now left empty (`""`) for tool messages,
keeping the single copy on `toolCall.output`. Smaller payloads and less client-side
`JSON.parse` for chats dominated by large tool results.
