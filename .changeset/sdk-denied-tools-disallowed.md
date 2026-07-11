---
"@herdctl/core": patch
---

Fix `denied_tools` being silently ignored on `runtime: sdk` agents (edspencer/herdctl#322).

The SDK adapter passed an agent's `denied_tools` to the Claude Agent SDK as `deniedTools`, but the SDK's actual option is named `disallowedTools`. Because the options object is spread into `query()` untyped, the misspelled key was silently dropped — so tools listed in `denied_tools` remained fully available to SDK-runtime agents. The CLI runtime was unaffected (it already passes `--disallowedTools`).

`toSDKOptions` now emits `disallowedTools`, and `SDKQueryOptions` declares the correctly named field so the compiler catches any future drift.
