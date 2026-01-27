---
"@herdctl/discord": patch
---

Fix session lifecycle issues discovered during FleetManager integration

- Clean up expired sessions automatically on bot startup
- Session cleanup failures logged but don't prevent connection
- Improved session persistence reliability across restarts
