---
"@herdctl/core": minor
---

Add session discovery service and metadata store for unified Claude Code session enumeration. `SessionDiscoveryService` ties together JSONL parsing, session attribution, and CLI session path utilities into a single cached API for discovering sessions across all project directories. `SessionMetadataStore` provides CRUD operations for custom session names stored in `.herdctl/session-metadata/`.
