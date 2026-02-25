import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import yaml from "yaml";
import type { JobMetadata, JobStatus, TriggerType } from "../schemas/job-metadata.js";
import { buildAttributionIndex } from "../session-attribution.js";

// Mock listJobs
vi.mock("../job-metadata.js", () => ({
  listJobs: vi.fn(),
}));

// Import after mock
import { listJobs } from "../job-metadata.js";

const mockListJobs = vi.mocked(listJobs);

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a temporary directory for tests
 */
async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-attribution-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(baseDir, { recursive: true });
  // Resolve to real path to handle macOS /var -> /private/var symlink
  return await realpath(baseDir);
}

/**
 * Create a platform session YAML file
 */
async function createPlatformSession(
  stateDir: string,
  platform: "discord" | "slack" | "web",
  agentName: string,
  channels: Record<string, { sessionId: string; lastMessageAt: string }>,
): Promise<void> {
  const dir = join(stateDir, `${platform}-sessions`);
  await mkdir(dir, { recursive: true });
  const content = yaml.stringify({
    version: 1,
    agentName,
    channels,
  });
  await writeFile(join(dir, `${agentName}.yaml`), content);
}

/**
 * Create a minimal valid job object for mocking
 */
function createMockJob(overrides: {
  id?: string;
  agent?: string;
  session_id?: string | null;
  trigger_type?: TriggerType;
  status?: JobStatus;
  started_at?: string;
}): JobMetadata {
  return {
    id: overrides.id ?? "job-2024-01-15-abc123",
    agent: overrides.agent ?? "test-fleet/test-agent",
    session_id: overrides.session_id ?? null,
    trigger_type: overrides.trigger_type ?? "manual",
    status: overrides.status ?? "completed",
    started_at: overrides.started_at ?? "2024-01-15T10:00:00Z",
    schedule: null,
    exit_reason: null,
    forked_from: null,
    finished_at: null,
    duration_seconds: null,
    prompt: null,
    summary: null,
    output_file: null,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("buildAttributionIndex", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    mockListJobs.mockReset();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("job-attributed sessions", () => {
    it("attributes session from job with trigger_type web", async () => {
      mockListJobs.mockResolvedValue({
        jobs: [
          createMockJob({
            session_id: "sess-web-1",
            trigger_type: "web",
            agent: "fleet/web-agent",
          }),
        ],
        errors: 0,
      });

      const index = await buildAttributionIndex(tempDir);
      const attribution = index.getAttribute("sess-web-1");

      expect(attribution).toEqual({
        origin: "web",
        agentName: "fleet/web-agent",
        triggerType: "web",
      });
    });

    it("attributes session from job with trigger_type schedule", async () => {
      mockListJobs.mockResolvedValue({
        jobs: [
          createMockJob({
            session_id: "sess-sched-1",
            trigger_type: "schedule",
            agent: "fleet/scheduled-agent",
          }),
        ],
        errors: 0,
      });

      const index = await buildAttributionIndex(tempDir);
      const attribution = index.getAttribute("sess-sched-1");

      expect(attribution).toEqual({
        origin: "schedule",
        agentName: "fleet/scheduled-agent",
        triggerType: "schedule",
      });
    });

    it("attributes session from job with trigger_type discord", async () => {
      mockListJobs.mockResolvedValue({
        jobs: [
          createMockJob({
            session_id: "sess-discord-job",
            trigger_type: "discord",
            agent: "fleet/discord-agent",
          }),
        ],
        errors: 0,
      });

      const index = await buildAttributionIndex(tempDir);
      const attribution = index.getAttribute("sess-discord-job");

      expect(attribution).toEqual({
        origin: "discord",
        agentName: "fleet/discord-agent",
        triggerType: "discord",
      });
    });

    it("attributes session from job with trigger_type slack", async () => {
      mockListJobs.mockResolvedValue({
        jobs: [
          createMockJob({
            session_id: "sess-slack-job",
            trigger_type: "slack",
            agent: "fleet/slack-agent",
          }),
        ],
        errors: 0,
      });

      const index = await buildAttributionIndex(tempDir);
      const attribution = index.getAttribute("sess-slack-job");

      expect(attribution).toEqual({
        origin: "slack",
        agentName: "fleet/slack-agent",
        triggerType: "slack",
      });
    });
  });

  describe("trigger type mapping to native", () => {
    it.each([
      ["manual", "native"],
      ["webhook", "native"],
      ["chat", "native"],
      ["fork", "native"],
    ] as const)("maps trigger_type %s to origin %s", async (triggerType, expectedOrigin) => {
      mockListJobs.mockResolvedValue({
        jobs: [
          createMockJob({
            session_id: `sess-${triggerType}`,
            trigger_type: triggerType,
            agent: "fleet/agent",
          }),
        ],
        errors: 0,
      });

      const index = await buildAttributionIndex(tempDir);
      const attribution = index.getAttribute(`sess-${triggerType}`);

      expect(attribution.origin).toBe(expectedOrigin);
      expect(attribution.triggerType).toBe(triggerType);
    });
  });

  describe("platform YAML-attributed sessions", () => {
    it("attributes session from discord YAML when not in jobs", async () => {
      mockListJobs.mockResolvedValue({ jobs: [], errors: 0 });

      await createPlatformSession(tempDir, "discord", "my-discord-bot", {
        "channel-123": {
          sessionId: "sess-discord-yaml",
          lastMessageAt: "2024-01-15T10:00:00Z",
        },
      });

      const index = await buildAttributionIndex(tempDir);
      const attribution = index.getAttribute("sess-discord-yaml");

      expect(attribution).toEqual({
        origin: "discord",
        agentName: "my-discord-bot",
        triggerType: undefined,
      });
    });

    it("attributes session from slack YAML when not in jobs", async () => {
      mockListJobs.mockResolvedValue({ jobs: [], errors: 0 });

      await createPlatformSession(tempDir, "slack", "my-slack-bot", {
        "channel-456": {
          sessionId: "sess-slack-yaml",
          lastMessageAt: "2024-01-15T11:00:00Z",
        },
      });

      const index = await buildAttributionIndex(tempDir);
      const attribution = index.getAttribute("sess-slack-yaml");

      expect(attribution).toEqual({
        origin: "slack",
        agentName: "my-slack-bot",
        triggerType: undefined,
      });
    });

    it("attributes session from web YAML when not in jobs", async () => {
      mockListJobs.mockResolvedValue({ jobs: [], errors: 0 });

      await createPlatformSession(tempDir, "web", "my-web-agent", {
        "session-789": {
          sessionId: "sess-web-yaml",
          lastMessageAt: "2024-01-15T12:00:00Z",
        },
      });

      const index = await buildAttributionIndex(tempDir);
      const attribution = index.getAttribute("sess-web-yaml");

      expect(attribution).toEqual({
        origin: "web",
        agentName: "my-web-agent",
        triggerType: undefined,
      });
    });

    it("handles multiple channels in a single YAML file", async () => {
      mockListJobs.mockResolvedValue({ jobs: [], errors: 0 });

      await createPlatformSession(tempDir, "discord", "multi-channel-bot", {
        "channel-1": { sessionId: "sess-ch1", lastMessageAt: "2024-01-15T10:00:00Z" },
        "channel-2": { sessionId: "sess-ch2", lastMessageAt: "2024-01-15T11:00:00Z" },
        "channel-3": { sessionId: "sess-ch3", lastMessageAt: "2024-01-15T12:00:00Z" },
      });

      const index = await buildAttributionIndex(tempDir);

      expect(index.getAttribute("sess-ch1").origin).toBe("discord");
      expect(index.getAttribute("sess-ch2").origin).toBe("discord");
      expect(index.getAttribute("sess-ch3").origin).toBe("discord");
      expect(index.getAttribute("sess-ch1").agentName).toBe("multi-channel-bot");
    });
  });

  describe("priority: job takes precedence over YAML", () => {
    it("uses job attribution when session exists in both job and platform YAML", async () => {
      const sharedSessionId = "sess-shared";

      // Job says it's a web session
      mockListJobs.mockResolvedValue({
        jobs: [
          createMockJob({
            session_id: sharedSessionId,
            trigger_type: "web",
            agent: "fleet/job-agent",
          }),
        ],
        errors: 0,
      });

      // Slack YAML also has this session
      await createPlatformSession(tempDir, "slack", "slack-bot", {
        "channel-xyz": {
          sessionId: sharedSessionId,
          lastMessageAt: "2024-01-15T10:00:00Z",
        },
      });

      const index = await buildAttributionIndex(tempDir);
      const attribution = index.getAttribute(sharedSessionId);

      // Job should win
      expect(attribution).toEqual({
        origin: "web",
        agentName: "fleet/job-agent",
        triggerType: "web",
      });
    });
  });

  describe("unattributed sessions", () => {
    it("returns native origin for unknown session", async () => {
      mockListJobs.mockResolvedValue({ jobs: [], errors: 0 });

      const index = await buildAttributionIndex(tempDir);
      const attribution = index.getAttribute("sess-unknown");

      expect(attribution).toEqual({
        origin: "native",
        agentName: undefined,
        triggerType: undefined,
      });
    });

    it("returns native origin when session not in any source", async () => {
      // Some jobs exist but not matching session
      mockListJobs.mockResolvedValue({
        jobs: [
          createMockJob({
            session_id: "sess-other",
            trigger_type: "web",
            agent: "fleet/agent",
          }),
        ],
        errors: 0,
      });

      // Some platform sessions exist but not matching
      await createPlatformSession(tempDir, "discord", "bot", {
        "ch-1": { sessionId: "sess-discord-other", lastMessageAt: "2024-01-15T10:00:00Z" },
      });

      const index = await buildAttributionIndex(tempDir);
      const attribution = index.getAttribute("sess-not-found");

      expect(attribution).toEqual({
        origin: "native",
        agentName: undefined,
        triggerType: undefined,
      });
    });
  });

  describe("batch attribution (getAttributes)", () => {
    it("returns correct Map for multiple session IDs", async () => {
      mockListJobs.mockResolvedValue({
        jobs: [
          createMockJob({
            id: "job-2024-01-15-job001",
            session_id: "sess-job-web",
            trigger_type: "web",
            agent: "fleet/web-agent",
          }),
          createMockJob({
            id: "job-2024-01-15-job002",
            session_id: "sess-job-schedule",
            trigger_type: "schedule",
            agent: "fleet/cron-agent",
          }),
        ],
        errors: 0,
      });

      await createPlatformSession(tempDir, "discord", "discord-bot", {
        "ch-1": { sessionId: "sess-discord", lastMessageAt: "2024-01-15T10:00:00Z" },
      });
      await createPlatformSession(tempDir, "slack", "slack-bot", {
        "ch-2": { sessionId: "sess-slack", lastMessageAt: "2024-01-15T11:00:00Z" },
      });

      const index = await buildAttributionIndex(tempDir);
      const results = index.getAttributes([
        "sess-job-web",
        "sess-job-schedule",
        "sess-discord",
        "sess-slack",
        "sess-unknown",
      ]);

      expect(results.size).toBe(5);

      expect(results.get("sess-job-web")).toEqual({
        origin: "web",
        agentName: "fleet/web-agent",
        triggerType: "web",
      });

      expect(results.get("sess-job-schedule")).toEqual({
        origin: "schedule",
        agentName: "fleet/cron-agent",
        triggerType: "schedule",
      });

      expect(results.get("sess-discord")).toEqual({
        origin: "discord",
        agentName: "discord-bot",
        triggerType: undefined,
      });

      expect(results.get("sess-slack")).toEqual({
        origin: "slack",
        agentName: "slack-bot",
        triggerType: undefined,
      });

      expect(results.get("sess-unknown")).toEqual({
        origin: "native",
        agentName: undefined,
        triggerType: undefined,
      });
    });
  });

  describe("empty jobs directory", () => {
    it("uses YAML attribution when listJobs returns empty", async () => {
      mockListJobs.mockResolvedValue({ jobs: [], errors: 0 });

      await createPlatformSession(tempDir, "discord", "bot", {
        "ch-1": { sessionId: "sess-yaml-only", lastMessageAt: "2024-01-15T10:00:00Z" },
      });

      const index = await buildAttributionIndex(tempDir);
      const attribution = index.getAttribute("sess-yaml-only");

      expect(attribution.origin).toBe("discord");
    });

    it("defaults to native when listJobs is empty and no YAML", async () => {
      mockListJobs.mockResolvedValue({ jobs: [], errors: 0 });

      const index = await buildAttributionIndex(tempDir);
      const attribution = index.getAttribute("any-session");

      expect(attribution.origin).toBe("native");
    });
  });

  describe("malformed YAML handling", () => {
    it("skips malformed YAML files and continues parsing others", async () => {
      mockListJobs.mockResolvedValue({ jobs: [], errors: 0 });

      // Create discord-sessions directory
      const discordDir = join(tempDir, "discord-sessions");
      await mkdir(discordDir, { recursive: true });

      // Create a malformed YAML file
      await writeFile(join(discordDir, "malformed-bot.yaml"), "not valid yaml: [[[", "utf-8");

      // Create a valid YAML file
      await createPlatformSession(tempDir, "discord", "valid-bot", {
        "ch-1": { sessionId: "sess-valid", lastMessageAt: "2024-01-15T10:00:00Z" },
      });

      // Should not throw
      const index = await buildAttributionIndex(tempDir);

      // Valid file should still be indexed
      expect(index.getAttribute("sess-valid").origin).toBe("discord");
    });

    it("skips YAML files with invalid schema and continues", async () => {
      mockListJobs.mockResolvedValue({ jobs: [], errors: 0 });

      // Create discord-sessions directory
      const discordDir = join(tempDir, "discord-sessions");
      await mkdir(discordDir, { recursive: true });

      // Create YAML with invalid schema (missing required fields)
      await writeFile(
        join(discordDir, "invalid-schema.yaml"),
        yaml.stringify({ foo: "bar" }),
        "utf-8",
      );

      // Create a valid YAML file
      await createPlatformSession(tempDir, "discord", "valid-bot", {
        "ch-1": { sessionId: "sess-valid-schema", lastMessageAt: "2024-01-15T10:00:00Z" },
      });

      const index = await buildAttributionIndex(tempDir);

      // Valid file should still be indexed
      expect(index.getAttribute("sess-valid-schema").origin).toBe("discord");
    });
  });

  describe("missing platform directories", () => {
    it("handles missing platform directories gracefully", async () => {
      mockListJobs.mockResolvedValue({
        jobs: [
          createMockJob({
            session_id: "sess-from-job",
            trigger_type: "web",
            agent: "fleet/agent",
          }),
        ],
        errors: 0,
      });

      // No platform directories exist at all

      // Should not throw
      const index = await buildAttributionIndex(tempDir);

      // Job sessions should still be found
      expect(index.getAttribute("sess-from-job").origin).toBe("web");

      // Unknown sessions default to native
      expect(index.getAttribute("unknown").origin).toBe("native");
    });

    it("handles partial platform directories", async () => {
      mockListJobs.mockResolvedValue({ jobs: [], errors: 0 });

      // Only discord-sessions exists, not slack-sessions or web-sessions
      await createPlatformSession(tempDir, "discord", "discord-bot", {
        "ch-1": { sessionId: "sess-discord-only", lastMessageAt: "2024-01-15T10:00:00Z" },
      });

      const index = await buildAttributionIndex(tempDir);

      expect(index.getAttribute("sess-discord-only").origin).toBe("discord");
    });
  });

  describe("job with null session_id", () => {
    it("does not index jobs with null session_id", async () => {
      mockListJobs.mockResolvedValue({
        jobs: [
          createMockJob({
            id: "job-2024-01-15-null01",
            session_id: null,
            trigger_type: "web",
            agent: "fleet/null-agent",
          }),
          createMockJob({
            id: "job-2024-01-15-real01",
            session_id: "sess-real",
            trigger_type: "web",
            agent: "fleet/real-agent",
          }),
        ],
        errors: 0,
      });

      const index = await buildAttributionIndex(tempDir);

      // Real session should be found
      expect(index.getAttribute("sess-real").origin).toBe("web");

      // Null session shouldn't cause issues
      expect(index.size).toBe(1);
    });
  });

  describe("index size", () => {
    it("reports correct unique session count", async () => {
      mockListJobs.mockResolvedValue({
        jobs: [
          createMockJob({
            id: "job-2024-01-15-job001",
            session_id: "sess-job-1",
            trigger_type: "web",
            agent: "fleet/agent-1",
          }),
          createMockJob({
            id: "job-2024-01-15-job002",
            session_id: "sess-job-2",
            trigger_type: "schedule",
            agent: "fleet/agent-2",
          }),
        ],
        errors: 0,
      });

      // Add one new session via platform YAML
      await createPlatformSession(tempDir, "discord", "discord-bot", {
        "ch-1": { sessionId: "sess-platform-new", lastMessageAt: "2024-01-15T10:00:00Z" },
      });

      // Add one overlapping session (same as job-1) via platform YAML
      await createPlatformSession(tempDir, "slack", "slack-bot", {
        "ch-2": { sessionId: "sess-job-1", lastMessageAt: "2024-01-15T11:00:00Z" },
      });

      const index = await buildAttributionIndex(tempDir);

      // 2 from jobs + 1 new from platform = 3 unique (overlapping one doesn't add)
      expect(index.size).toBe(3);
    });

    it("returns 0 when no sessions indexed", async () => {
      mockListJobs.mockResolvedValue({ jobs: [], errors: 0 });

      const index = await buildAttributionIndex(tempDir);

      expect(index.size).toBe(0);
    });
  });

  describe("complete trigger type mapping", () => {
    it.each([
      ["web", "web"],
      ["discord", "discord"],
      ["slack", "slack"],
      ["schedule", "schedule"],
      ["manual", "native"],
      ["webhook", "native"],
      ["chat", "native"],
      ["fork", "native"],
    ] as const)("maps trigger_type '%s' to origin '%s'", async (triggerType, expectedOrigin) => {
      mockListJobs.mockResolvedValue({
        jobs: [
          createMockJob({
            session_id: `sess-trigger-${triggerType}`,
            trigger_type: triggerType,
            agent: `fleet/${triggerType}-agent`,
          }),
        ],
        errors: 0,
      });

      const index = await buildAttributionIndex(tempDir);
      const attribution = index.getAttribute(`sess-trigger-${triggerType}`);

      expect(attribution.origin).toBe(expectedOrigin);
      expect(attribution.agentName).toBe(`fleet/${triggerType}-agent`);
      expect(attribution.triggerType).toBe(triggerType);
    });
  });

  describe("multiple YAML files per platform", () => {
    it("indexes sessions from multiple YAML files in same platform directory", async () => {
      mockListJobs.mockResolvedValue({ jobs: [], errors: 0 });

      await createPlatformSession(tempDir, "discord", "bot-alpha", {
        "ch-alpha": { sessionId: "sess-alpha", lastMessageAt: "2024-01-15T10:00:00Z" },
      });
      await createPlatformSession(tempDir, "discord", "bot-beta", {
        "ch-beta": { sessionId: "sess-beta", lastMessageAt: "2024-01-15T11:00:00Z" },
      });
      await createPlatformSession(tempDir, "discord", "bot-gamma", {
        "ch-gamma": { sessionId: "sess-gamma", lastMessageAt: "2024-01-15T12:00:00Z" },
      });

      const index = await buildAttributionIndex(tempDir);

      expect(index.getAttribute("sess-alpha")).toEqual({
        origin: "discord",
        agentName: "bot-alpha",
        triggerType: undefined,
      });
      expect(index.getAttribute("sess-beta")).toEqual({
        origin: "discord",
        agentName: "bot-beta",
        triggerType: undefined,
      });
      expect(index.getAttribute("sess-gamma")).toEqual({
        origin: "discord",
        agentName: "bot-gamma",
        triggerType: undefined,
      });

      expect(index.size).toBe(3);
    });
  });
});
