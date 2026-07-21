---
"@herdctl/core": minor
---

Persist per-run, per-model token accounting and SDK cost on the job record

herdctl already receives the SDK's authoritative `total_cost_usd` + `usage` on the terminal result message and aggregates CLI-runtime tokens, but discarded all of it before the final `updateJob`. The job record now carries a `usage` field capturing this accounting at run-end:

- **Per model** (`usage.per_model`, keyed by model id) — each model's four token classes (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`). A single run can span multiple models (e.g. an Opus main agent delegating to Haiku subagents), so counts are broken down per model rather than summed.
- **`usage.num_turns`** — total agentic turns reported by the runtime.
- **`usage.total_cost_usd`** — the SDK's own authoritative run cost, when reported. Absent for CLI / Max-plan runs that have no real per-token spend.

New `extractRunUsage` reader maps the SDK result's camelCase `modelUsage` to the persisted snake-case shape; the CLI runtime now aggregates per-model usage (incl. cache classes) into its synthesized result so both runtimes persist a uniform breakdown. Pricing stays out of herdctl — only raw token counts and the SDK's own cost figure are stored; the consuming app applies a price table. Additive and backward-compatible: existing job records without the field still parse, and headless fleets see no behaviour change.
