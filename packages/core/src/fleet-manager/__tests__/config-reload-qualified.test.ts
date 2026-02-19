/**
 * Tests for config reload with qualified names (fleet composition)
 *
 * Tests computeConfigChanges() and computeScheduleChanges() using
 * qualifiedName as the diff key, which supports nested fleet agents.
 */

import { describe, it, expect } from "vitest";
import {
  computeConfigChanges,
  computeScheduleChanges,
  getAddedAgentNames,
  getRemovedAgentNames,
  getModifiedAgentNames,
  getChangesSummary,
} from "../config-reload.js";
import type { ResolvedConfig, ResolvedAgent } from "../../config/index.js";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a minimal ResolvedAgent with the given properties.
 * Sets qualifiedName from fleetPath + name automatically.
 *
 * Uses Record<string, unknown> for overrides to avoid strict schedule
 * type requirements in test fixtures -- these are partial mocks cast
 * to ResolvedAgent since computeConfigChanges only reads a few fields.
 */
function makeAgent(
  name: string,
  fleetPath: string[] = [],
  overrides: Record<string, unknown> = {},
): ResolvedAgent {
  const qualifiedName = fleetPath.length > 0 ? fleetPath.join(".") + "." + name : name;
  return {
    name,
    configPath: `/fake/${name}.yaml`,
    fleetPath: [...fleetPath],
    qualifiedName,
    ...overrides,
  } as ResolvedAgent;
}

/**
 * Create a minimal ResolvedConfig wrapping the given agents.
 */
function makeConfig(agents: ResolvedAgent[]): ResolvedConfig {
  return {
    fleet: { version: 1, agents: [] } as unknown as ResolvedConfig["fleet"],
    agents,
    configPath: "/fake/herdctl.yaml",
    configDir: "/fake",
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("computeConfigChanges with qualified names", () => {
  describe("sub-fleet agent added", () => {
    it("detects a new agent in a sub-fleet as added with qualified name", () => {
      const oldConfig = makeConfig([makeAgent("auditor", ["project-a"])]);
      const newConfig = makeConfig([
        makeAgent("auditor", ["project-a"]),
        makeAgent("new-agent", ["project-a"]),
      ]);

      const changes = computeConfigChanges(oldConfig, newConfig);

      expect(changes).toContainEqual(
        expect.objectContaining({
          type: "added",
          category: "agent",
          name: "project-a.new-agent",
        }),
      );

      const addedNames = getAddedAgentNames(changes);
      expect(addedNames).toContain("project-a.new-agent");
    });

    it("detects a new agent with schedules in a sub-fleet", () => {
      const oldConfig = makeConfig([makeAgent("auditor", ["project-a"])]);
      const newConfig = makeConfig([
        makeAgent("auditor", ["project-a"]),
        makeAgent("new-agent", ["project-a"], {
          schedules: {
            hourly: { type: "interval", interval: "1h" },
            daily: { type: "interval", interval: "24h" },
          },
        }),
      ]);

      const changes = computeConfigChanges(oldConfig, newConfig);

      // Agent added
      expect(changes).toContainEqual(
        expect.objectContaining({
          type: "added",
          category: "agent",
          name: "project-a.new-agent",
        }),
      );

      // Schedules added with qualified name prefix
      expect(changes).toContainEqual(
        expect.objectContaining({
          type: "added",
          category: "schedule",
          name: "project-a.new-agent/hourly",
        }),
      );
      expect(changes).toContainEqual(
        expect.objectContaining({
          type: "added",
          category: "schedule",
          name: "project-a.new-agent/daily",
        }),
      );
    });
  });

  describe("sub-fleet removed entirely", () => {
    it("detects all agents as removed when a sub-fleet is removed", () => {
      const oldConfig = makeConfig([
        makeAgent("auditor", ["project-a"]),
        makeAgent("engineer", ["project-a"]),
        makeAgent("monitor", []), // root-level agent
      ]);
      const newConfig = makeConfig([
        makeAgent("monitor", []), // only root-level agent remains
      ]);

      const changes = computeConfigChanges(oldConfig, newConfig);

      const removedNames = getRemovedAgentNames(changes);
      expect(removedNames).toContain("project-a.auditor");
      expect(removedNames).toContain("project-a.engineer");
      expect(removedNames).not.toContain("monitor");
    });

    it("detects removed agents with schedules include schedule removal", () => {
      const oldConfig = makeConfig([
        makeAgent("auditor", ["project-a"], {
          schedules: {
            check: { type: "interval", interval: "1h" },
          },
        }),
        makeAgent("monitor", []),
      ]);
      const newConfig = makeConfig([makeAgent("monitor", [])]);

      const changes = computeConfigChanges(oldConfig, newConfig);

      expect(changes).toContainEqual(
        expect.objectContaining({
          type: "removed",
          category: "agent",
          name: "project-a.auditor",
        }),
      );
      expect(changes).toContainEqual(
        expect.objectContaining({
          type: "removed",
          category: "schedule",
          name: "project-a.auditor/check",
        }),
      );
    });
  });

  describe("agent config changes in a sub-fleet", () => {
    it("detects modified agent with qualified name", () => {
      const oldConfig = makeConfig([
        makeAgent("auditor", ["project-a"], { description: "Original" }),
      ]);
      const newConfig = makeConfig([
        makeAgent("auditor", ["project-a"], { description: "Updated" }),
      ]);

      const changes = computeConfigChanges(oldConfig, newConfig);

      expect(changes).toContainEqual(
        expect.objectContaining({
          type: "modified",
          category: "agent",
          name: "project-a.auditor",
          details: expect.stringContaining("description"),
        }),
      );

      const modifiedNames = getModifiedAgentNames(changes);
      expect(modifiedNames).toContain("project-a.auditor");
    });

    it("detects model change in deeply nested fleet agent", () => {
      const oldConfig = makeConfig([
        makeAgent("designer", ["project-b", "frontend"], {
          model: "claude-sonnet",
        }),
      ]);
      const newConfig = makeConfig([
        makeAgent("designer", ["project-b", "frontend"], {
          model: "claude-opus",
        }),
      ]);

      const changes = computeConfigChanges(oldConfig, newConfig);

      expect(changes).toContainEqual(
        expect.objectContaining({
          type: "modified",
          category: "agent",
          name: "project-b.frontend.designer",
          details: expect.stringContaining("model"),
        }),
      );
    });
  });

  describe("ordering changes with no actual differences", () => {
    it("reports no changes when sub-fleet ordering changes but agents are the same", () => {
      const oldConfig = makeConfig([
        makeAgent("auditor", ["project-a"]),
        makeAgent("engineer", ["project-b"]),
        makeAgent("monitor", []),
      ]);
      // Same agents, different order
      const newConfig = makeConfig([
        makeAgent("monitor", []),
        makeAgent("engineer", ["project-b"]),
        makeAgent("auditor", ["project-a"]),
      ]);

      const changes = computeConfigChanges(oldConfig, newConfig);

      expect(changes).toHaveLength(0);
      expect(getChangesSummary(changes)).toBe("no changes");
    });
  });

  describe("single-fleet backward compatibility", () => {
    it("uses bare name when fleetPath is empty (qualifiedName === name)", () => {
      const oldConfig = makeConfig([makeAgent("agent-1", [])]);
      const newConfig = makeConfig([makeAgent("agent-1", []), makeAgent("agent-2", [])]);

      const changes = computeConfigChanges(oldConfig, newConfig);

      expect(changes).toContainEqual(
        expect.objectContaining({
          type: "added",
          category: "agent",
          name: "agent-2",
        }),
      );

      // Verify name is the bare name, not prefixed
      const addedNames = getAddedAgentNames(changes);
      expect(addedNames).toEqual(["agent-2"]);
    });

    it("detects removal using bare name for root agents", () => {
      const oldConfig = makeConfig([makeAgent("agent-1", []), makeAgent("agent-2", [])]);
      const newConfig = makeConfig([makeAgent("agent-1", [])]);

      const changes = computeConfigChanges(oldConfig, newConfig);

      expect(changes).toContainEqual(
        expect.objectContaining({
          type: "removed",
          category: "agent",
          name: "agent-2",
        }),
      );
    });

    it("detects modifications using bare name for root agents", () => {
      const oldConfig = makeConfig([makeAgent("agent-1", [], { description: "Old" })]);
      const newConfig = makeConfig([makeAgent("agent-1", [], { description: "New" })]);

      const changes = computeConfigChanges(oldConfig, newConfig);

      expect(changes).toContainEqual(
        expect.objectContaining({
          type: "modified",
          category: "agent",
          name: "agent-1",
          details: expect.stringContaining("description"),
        }),
      );
    });

    it("reports no changes when root-level agents are identical", () => {
      const oldConfig = makeConfig([makeAgent("agent-1", [], { description: "Same" })]);
      const newConfig = makeConfig([makeAgent("agent-1", [], { description: "Same" })]);

      const changes = computeConfigChanges(oldConfig, newConfig);
      expect(changes).toHaveLength(0);
    });
  });

  describe("agents with same local name in different fleets", () => {
    it("treats same-named agents in different fleets as distinct", () => {
      const oldConfig = makeConfig([
        makeAgent("auditor", ["project-a"]),
        makeAgent("auditor", ["project-b"]),
      ]);
      // Remove only from project-b
      const newConfig = makeConfig([makeAgent("auditor", ["project-a"])]);

      const changes = computeConfigChanges(oldConfig, newConfig);

      const removedNames = getRemovedAgentNames(changes);
      expect(removedNames).toContain("project-b.auditor");
      expect(removedNames).not.toContain("project-a.auditor");
    });

    it("detects modification only in the changed fleet", () => {
      const oldConfig = makeConfig([
        makeAgent("auditor", ["project-a"], { description: "A auditor" }),
        makeAgent("auditor", ["project-b"], { description: "B auditor" }),
      ]);
      const newConfig = makeConfig([
        makeAgent("auditor", ["project-a"], { description: "A auditor" }),
        makeAgent("auditor", ["project-b"], { description: "Updated B auditor" }),
      ]);

      const changes = computeConfigChanges(oldConfig, newConfig);

      const modifiedNames = getModifiedAgentNames(changes);
      expect(modifiedNames).toContain("project-b.auditor");
      expect(modifiedNames).not.toContain("project-a.auditor");
    });

    it("detects addition in one fleet without affecting another", () => {
      const oldConfig = makeConfig([makeAgent("auditor", ["project-a"])]);
      const newConfig = makeConfig([
        makeAgent("auditor", ["project-a"]),
        makeAgent("auditor", ["project-b"]),
      ]);

      const changes = computeConfigChanges(oldConfig, newConfig);

      const addedNames = getAddedAgentNames(changes);
      expect(addedNames).toContain("project-b.auditor");
      expect(addedNames).not.toContain("project-a.auditor");
    });
  });

  describe("null oldConfig (first load)", () => {
    it("treats all agents as added on first load", () => {
      const newConfig = makeConfig([makeAgent("auditor", ["project-a"]), makeAgent("monitor", [])]);

      const changes = computeConfigChanges(null, newConfig);

      const addedNames = getAddedAgentNames(changes);
      expect(addedNames).toContain("project-a.auditor");
      expect(addedNames).toContain("monitor");
    });
  });
});

describe("computeScheduleChanges with qualified names", () => {
  it("uses qualified name for added schedule change names", () => {
    const oldAgent = makeAgent("auditor", ["project-a"], {
      schedules: {},
    });
    const newAgent = makeAgent("auditor", ["project-a"], {
      schedules: {
        hourly: { type: "interval", interval: "1h" },
      },
    });

    const changes = computeScheduleChanges(oldAgent, newAgent);

    expect(changes).toContainEqual(
      expect.objectContaining({
        type: "added",
        category: "schedule",
        name: "project-a.auditor/hourly",
      }),
    );
  });

  it("uses qualified name for removed schedule change names", () => {
    const oldAgent = makeAgent("auditor", ["project-a"], {
      schedules: {
        hourly: { type: "interval", interval: "1h" },
      },
    });
    const newAgent = makeAgent("auditor", ["project-a"], {
      schedules: {},
    });

    const changes = computeScheduleChanges(oldAgent, newAgent);

    expect(changes).toContainEqual(
      expect.objectContaining({
        type: "removed",
        category: "schedule",
        name: "project-a.auditor/hourly",
      }),
    );
  });

  it("uses qualified name for modified schedule change names", () => {
    const oldAgent = makeAgent("auditor", ["project-a"], {
      schedules: {
        hourly: { type: "interval", interval: "1h", prompt: "Old" },
      },
    });
    const newAgent = makeAgent("auditor", ["project-a"], {
      schedules: {
        hourly: { type: "interval", interval: "2h", prompt: "New" },
      },
    });

    const changes = computeScheduleChanges(oldAgent, newAgent);

    expect(changes).toContainEqual(
      expect.objectContaining({
        type: "modified",
        category: "schedule",
        name: "project-a.auditor/hourly",
      }),
    );
  });

  it("uses deeply nested qualified name for schedule changes", () => {
    const oldAgent = makeAgent("designer", ["project-b", "frontend"], {
      schedules: {
        check: { type: "interval", interval: "1h" },
      },
    });
    const newAgent = makeAgent("designer", ["project-b", "frontend"], {
      schedules: {
        check: { type: "cron", expression: "0 * * * *" },
      },
    });

    const changes = computeScheduleChanges(oldAgent, newAgent);

    expect(changes).toContainEqual(
      expect.objectContaining({
        type: "modified",
        category: "schedule",
        name: "project-b.frontend.designer/check",
      }),
    );
  });

  it("uses bare name for root-level agent schedule changes", () => {
    const oldAgent = makeAgent("monitor", [], {
      schedules: {
        check: { type: "interval", interval: "1h" },
      },
    });
    const newAgent = makeAgent("monitor", [], {
      schedules: {
        check: { type: "interval", interval: "2h" },
      },
    });

    const changes = computeScheduleChanges(oldAgent, newAgent);

    expect(changes).toContainEqual(
      expect.objectContaining({
        type: "modified",
        category: "schedule",
        name: "monitor/check",
      }),
    );
  });
});

describe("getChangesSummary with qualified names", () => {
  it("provides correct summary for mixed fleet changes", () => {
    const oldConfig = makeConfig([
      makeAgent("auditor", ["project-a"]),
      makeAgent("engineer", ["project-a"], { description: "Old" }),
      makeAgent("designer", ["project-b"]),
    ]);
    const newConfig = makeConfig([
      makeAgent("engineer", ["project-a"], { description: "New" }),
      makeAgent("designer", ["project-b"]),
      makeAgent("tester", ["project-b"]),
    ]);

    const changes = computeConfigChanges(oldConfig, newConfig);
    const summary = getChangesSummary(changes);

    expect(summary).toContain("1 agent added");
    expect(summary).toContain("1 agent removed");
    expect(summary).toContain("1 agent modified");
  });
});
