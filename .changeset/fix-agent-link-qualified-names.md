---
"@herdctl/core": patch
"@herdctl/web": patch
---

Fix agent links to use qualified names for correct navigation

Jobs now store the agent's qualified name (e.g., `herdctl.engineer`) instead of the local name (`engineer`) in job metadata. The web server also resolves older jobs with local names back to qualified names via a fallback lookup.

On the client side, all agent link construction is now centralized through path helper functions (`agentPath`, `agentChatPath`, `agentTabPath`) to prevent future inconsistencies.
