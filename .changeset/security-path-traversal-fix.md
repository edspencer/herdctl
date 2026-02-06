---
"@herdctl/core": patch
---

Add path traversal protection for agent names and state file paths

Security improvements:
- Add `buildSafeFilePath` utility that validates identifiers before constructing file paths
- Add `PathTraversalError` class for clear error reporting when traversal is detected
- Update session.ts and job-metadata.ts to use safe path construction
- Add `AGENT_NAME_PATTERN` regex validation in schema.ts to reject invalid agent names at config parsing time
- Defense-in-depth: validation at both schema level and file path construction

This prevents attackers from using agent names like `../../../etc/passwd` to read or write files outside the intended state directories.
