---
"@herdctl/core": minor
---

Add recursive fleet loading for fleet composition. The config loader now recursively resolves sub-fleet YAML files referenced via the `fleets` array, flattening all agents into a single list with correct `fleetPath` and `qualifiedName` metadata. Includes cycle detection, fleet name validation and collision detection, defaults merging across fleet levels, web suppression for sub-fleets, and working directory normalization relative to each config file's location.
