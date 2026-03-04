import { describe, expect, it } from "vitest";
import type { ResolvedAgent } from "../loader.js";
import { injectSchedulerMcpServers } from "../self-scheduling.js";

function makeAgent(overrides: Partial<ResolvedAgent> = {}): ResolvedAgent {
  return {
    name: "test-agent",
    qualifiedName: "test-agent",
    configPath: "/tmp/agents/test-agent/agent.yaml",
    fleetPath: [],
    ...overrides,
  } as ResolvedAgent;
}

describe("injectSchedulerMcpServers", () => {
  it("injects MCP server when self_scheduling.enabled is true", () => {
    const agents = [
      makeAgent({
        self_scheduling: { enabled: true, max_schedules: 10, min_interval: "5m" },
      }),
    ];

    injectSchedulerMcpServers(agents, "/tmp/.herdctl");

    expect(agents[0].mcp_servers).toBeDefined();
    expect(agents[0].mcp_servers!["herdctl-scheduler"]).toBeDefined();

    const server = agents[0].mcp_servers!["herdctl-scheduler"];
    expect(server.command).toBe("node");
    expect(server.args).toHaveLength(1);
    expect(server.args![0]).toContain("scheduler-mcp.js");
    expect(server.env!.HERDCTL_AGENT_NAME).toBe("test-agent");
    expect(server.env!.HERDCTL_STATE_DIR).toBe("/tmp/.herdctl");
    expect(server.env!.HERDCTL_MAX_SCHEDULES).toBe("10");
    expect(server.env!.HERDCTL_MIN_INTERVAL).toBe("5m");
  });

  it("does not inject when self_scheduling is not set", () => {
    const agents = [makeAgent()];

    injectSchedulerMcpServers(agents, "/tmp/.herdctl");

    expect(agents[0].mcp_servers).toBeUndefined();
  });

  it("does not inject when self_scheduling.enabled is false", () => {
    const agents = [
      makeAgent({
        self_scheduling: { enabled: false, max_schedules: 10, min_interval: "5m" },
      }),
    ];

    injectSchedulerMcpServers(agents, "/tmp/.herdctl");

    expect(agents[0].mcp_servers).toBeUndefined();
  });

  it("does not overwrite manually declared herdctl-scheduler", () => {
    const agents = [
      makeAgent({
        self_scheduling: { enabled: true, max_schedules: 10, min_interval: "5m" },
        mcp_servers: {
          "herdctl-scheduler": {
            command: "custom-scheduler",
            args: ["--custom"],
          },
        },
      }),
    ];

    injectSchedulerMcpServers(agents, "/tmp/.herdctl");

    expect(agents[0].mcp_servers!["herdctl-scheduler"].command).toBe("custom-scheduler");
  });

  it("includes static schedule names in env", () => {
    const agents = [
      makeAgent({
        self_scheduling: { enabled: true, max_schedules: 10, min_interval: "5m" },
        schedules: {
          "daily-report": { type: "cron", cron: "0 9 * * *", enabled: true, resume_session: false },
          "hourly-check": {
            type: "interval",
            interval: "1h",
            enabled: true,
            resume_session: false,
          },
        },
      }),
    ];

    injectSchedulerMcpServers(agents, "/tmp/.herdctl");

    const staticSchedules =
      agents[0].mcp_servers!["herdctl-scheduler"].env!.HERDCTL_STATIC_SCHEDULES;
    expect(staticSchedules).toBeDefined();
    expect(staticSchedules).toContain("daily-report");
    expect(staticSchedules).toContain("hourly-check");
  });

  it("uses qualified name for HERDCTL_AGENT_NAME", () => {
    const agents = [
      makeAgent({
        name: "agent",
        qualifiedName: "fleet.subfleet.agent",
        self_scheduling: { enabled: true, max_schedules: 10, min_interval: "5m" },
      }),
    ];

    injectSchedulerMcpServers(agents, "/tmp/.herdctl");

    expect(agents[0].mcp_servers!["herdctl-scheduler"].env!.HERDCTL_AGENT_NAME).toBe(
      "fleet.subfleet.agent",
    );
  });

  it("uses custom max_schedules and min_interval values", () => {
    const agents = [
      makeAgent({
        self_scheduling: { enabled: true, max_schedules: 5, min_interval: "15m" },
      }),
    ];

    injectSchedulerMcpServers(agents, "/tmp/.herdctl");

    const env = agents[0].mcp_servers!["herdctl-scheduler"].env!;
    expect(env.HERDCTL_MAX_SCHEDULES).toBe("5");
    expect(env.HERDCTL_MIN_INTERVAL).toBe("15m");
  });

  it("initializes mcp_servers map when it doesn't exist", () => {
    const agents = [
      makeAgent({
        self_scheduling: { enabled: true, max_schedules: 10, min_interval: "5m" },
        mcp_servers: undefined,
      }),
    ];

    injectSchedulerMcpServers(agents, "/tmp/.herdctl");

    expect(agents[0].mcp_servers).toBeDefined();
    expect(agents[0].mcp_servers!["herdctl-scheduler"]).toBeDefined();
  });

  it("preserves existing MCP servers when injecting", () => {
    const agents = [
      makeAgent({
        self_scheduling: { enabled: true, max_schedules: 10, min_interval: "5m" },
        mcp_servers: {
          "existing-server": {
            command: "node",
            args: ["existing.js"],
          },
        },
      }),
    ];

    injectSchedulerMcpServers(agents, "/tmp/.herdctl");

    expect(agents[0].mcp_servers!["existing-server"]).toBeDefined();
    expect(agents[0].mcp_servers!["herdctl-scheduler"]).toBeDefined();
  });

  it("injects self-scheduling system prompt when enabled", () => {
    const agents = [
      makeAgent({
        self_scheduling: { enabled: true, max_schedules: 5, min_interval: "15m" },
      }),
    ];

    injectSchedulerMcpServers(agents, "/tmp/.herdctl");

    expect(agents[0].system_prompt).toBeDefined();
    expect(agents[0].system_prompt).toContain("# Self-Scheduling");
    expect(agents[0].system_prompt).toContain("herdctl_create_schedule");
    expect(agents[0].system_prompt).toContain("up to 5 dynamic schedules");
    expect(agents[0].system_prompt).toContain("Minimum interval is 15m");
    expect(agents[0].system_prompt).toContain("Never edit agent.yaml");
  });

  it("appends scheduling prompt to existing system_prompt", () => {
    const agents = [
      makeAgent({
        system_prompt: "You are a helpful assistant.",
        self_scheduling: { enabled: true, max_schedules: 10, min_interval: "5m" },
      }),
    ];

    injectSchedulerMcpServers(agents, "/tmp/.herdctl");

    expect(agents[0].system_prompt).toMatch(/^You are a helpful assistant\.\n\n# Self-Scheduling/);
  });

  it("does not inject system prompt when self_scheduling is disabled", () => {
    const agents = [makeAgent()];

    injectSchedulerMcpServers(agents, "/tmp/.herdctl");

    expect(agents[0].system_prompt).toBeUndefined();
  });

  it("does not inject system prompt when operator declared custom MCP server", () => {
    const agents = [
      makeAgent({
        self_scheduling: { enabled: true, max_schedules: 10, min_interval: "5m" },
        mcp_servers: {
          "herdctl-scheduler": {
            command: "custom-scheduler",
            args: ["--custom"],
          },
        },
      }),
    ];

    injectSchedulerMcpServers(agents, "/tmp/.herdctl");

    // Custom MCP server preserved, no system prompt injected
    expect(agents[0].system_prompt).toBeUndefined();
  });
});
