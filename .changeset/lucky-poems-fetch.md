---
"@herdctl/core": patch
---

Fix session adoption offering — and silently losing — sessions owned by another agent (#437)

`scanAdoptionCandidates` asked "is this session **native**?" when it needed to
ask "is this session **unattributed**?". `triggerTypeToOrigin` folds `manual`,
`webhook`, `chat` and `fork` into `origin: "native"`, so a session with a real
job record under a *sibling* agent resolved to
`{ origin: "native", agentName: "sweeper-x" }` — natively originated, but firmly
someone else's. It passed the adoption gate and then failed the per-agent
listing gate (`agentName !== agentName`).

The result was an adoption record that could never win the precedence contest
(job → platform → adopted → native): inert by construction. The import reported
success, the session never appeared, and the burnt marker read as
`already-adopted` on every retry — silent and unrecoverable. Measured on a real
corpus, 1502 of 1531 candidates (98.1%) carried a sibling-agent job record; one
workspace reported "imported 1382" and 26 appeared. Any app that points several
agents at one working directory hits this every time.

- **Only unattributed sessions are adoptable.** `listAdoptableSessions` and
  `adoptSessionsFrom` now skip anything an agent already owns — including the
  adopting agent itself, whose sessions are already visible and so have nothing
  to import.
- **One shared predicate.** The listing gate and the adoption gate encoded the
  same question in two places and drifted; that drift *was* the bug. Both now
  derive from `isOwnedByAgent` in `session-attribution.ts`, with the adopt-time
  gate defined as "would the listing gate pass afterwards"
  (`canAgentAdopt = isOwnedByAgent(attributionAfterAdoptionBy(...))`). Two
  invariants follow and are covered by tests: anything the scan offers, the
  adopt path accepts; anything the adopt path accepts is then visible.
- **Refusal at the write site, not just the scan.** `adoptSession` throws the
  new `SessionAdoptionRefusedError`, and `adoptSessionsFrom` re-checks each
  candidate immediately before recording it and reports a skip instead. The scan
  and the write are separate calls — separated by minutes of file copying in a
  large import, well past the attribution cache TTL — so a sibling's run can
  land in between. Turning that into a legible skip is what keeps it
  recoverable.
- **`AdoptSkippedSession.ownedBy`** (new, optional) names the owning agent on
  `attributed-to-run` and `already-adopted` skips, so a UI can distinguish
  "belongs to another agent" from "already yours". Deliberately a field rather
  than a new `AdoptSkipReason` member, which would break consumers that switch
  on the reason exhaustively.

Behaviour change worth noting: `adoptSession` now throws where it previously
returned an inert record, and `listAdoptableSessions` no longer offers sessions
the agent already owns via a job record. Adopting genuine terminal `claude`
history — the case adoption exists for — is unaffected.
