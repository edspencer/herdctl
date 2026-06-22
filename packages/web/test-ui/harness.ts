/**
 * UI/integration test harness for @herdctl/web.
 *
 * Boots the REAL Fastify web server (createWebServer) against a REAL
 * @herdctl/core FleetManager, driven by a TEMP fleet config and a FAKE `claude`
 * binary on PATH — so the dashboard, REST API, WebSocket and the chat/trigger
 * flows all run end-to-end with ZERO Anthropic calls.
 *
 * Why createWebServer (and not FleetManager.start with web enabled)?
 * FleetManager loads the web dashboard via `import("@herdctl/web")`, which only
 * resolves where @herdctl/web is an installed dependency (the CLI). Inside this
 * package we instead drive the same public factory the WebManager uses
 * (createWebServer + fleetBridge.start + server.listen), giving us the identical
 * server while keeping the harness self-contained.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FleetManager } from "@herdctl/core";
// Import from built server output — this is the exact code that ships.
import { createWebServer, type WebServerResult } from "../dist/server/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the fake `claude` binary's directory (prepended to PATH). */
export const FAKE_BIN_DIR = join(__dirname, "fixtures", "bin");

export interface AgentSpec {
  name: string;
  description?: string;
  /** Extra raw YAML lines spliced into the agent doc (schedules, chat, etc.). */
  extraYaml?: string;
}

export interface HarnessOptions {
  /** Agents to define in the temp fleet. Defaults to a single "hello" agent. */
  agents?: AgentSpec[];
  /** Fleet name. */
  fleetName?: string;
  /** Scripted replies for the fake claude (prompt → reply). */
  fakeScript?: Record<string, string>;
  /** Whether to start the scheduler (FleetManager.start). Default true. */
  startScheduler?: boolean;
}

export interface Harness {
  /** Base URL the dashboard is served from, e.g. http://127.0.0.1:54321 */
  baseUrl: string;
  /** The live FleetManager. */
  fleet: FleetManager;
  /** The web server bundle (server, wsHandler, fleetBridge, chatManager). */
  web: WebServerResult;
  /** Temp directory holding the fleet config + workspaces + state. */
  tmpRoot: string;
  /** The encoded ~/.claude/projects dir each agent writes its transcripts to. */
  agentSessionDir: (agentName: string) => string;
  /** Working directory for an agent. */
  agentWorkdir: (agentName: string) => string;
  /** Tear everything down and remove temp files / transcripts. */
  stop: () => Promise<void>;
}

/** Mirror @herdctl/core encodePathForCli: every non-alphanumeric → "-". */
function encodePathForCli(absolutePath: string): string {
  return absolutePath.replace(/[^A-Za-z0-9]/g, "-");
}

function buildAgentYaml(agent: AgentSpec, workdir: string): string {
  return [
    `name: ${agent.name}`,
    `description: ${JSON.stringify(agent.description ?? `Test agent ${agent.name}`)}`,
    "runtime: cli",
    "model: claude-sonnet-4-20250514",
    "max_turns: 5",
    "permission_mode: default",
    `system_prompt: ${JSON.stringify("You are a helpful test agent.")}`,
    `working_directory: ${JSON.stringify(workdir)}`,
    "allowed_tools: [Read, Write]",
    agent.extraYaml ?? "",
    "",
  ].join("\n");
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const {
    agents = [{ name: "hello", description: "A friendly greeter" }],
    fleetName = "ui-test-fleet",
    fakeScript = {},
    startScheduler = true,
  } = options;

  // realpathSync resolves macOS's /var -> /private/var symlink so the agent's
  // configured working_directory matches the cwd the spawned `claude` reports
  // (otherwise core watches ~/.claude/projects/-var-... while the binary writes
  // to -private-var-..., and the session watcher times out).
  const tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "herd-web-ui-")));
  const stateDir = join(tmpRoot, ".herdctl");

  // 1) Write a fake-claude script file the binary reads via HERD_FAKE_SCRIPT.
  const scriptPath = join(tmpRoot, "fake-script.json");
  writeFileSync(scriptPath, JSON.stringify(fakeScript), "utf8");
  process.env.HERD_FAKE_SCRIPT = scriptPath;

  // 2) Prepend the fake `claude` to PATH (idempotent across harness instances).
  if (!process.env.PATH?.split(":").includes(FAKE_BIN_DIR)) {
    process.env.PATH = `${FAKE_BIN_DIR}:${process.env.PATH ?? ""}`;
  }

  // 3) Materialise the fleet config + per-agent workspaces.
  const agentDir = join(tmpRoot, "agents");
  spawnSync("mkdir", ["-p", agentDir]);
  const agentRefs: string[] = [];
  for (const agent of agents) {
    const workdir = join(tmpRoot, "work", agent.name);
    spawnSync("mkdir", ["-p", workdir]);
    const agentPath = join(agentDir, `${agent.name}.yaml`);
    writeFileSync(agentPath, buildAgentYaml(agent, workdir), "utf8");
    agentRefs.push(`  - path: ${JSON.stringify(agentPath)}`);
  }

  const fleetYaml = [
    "version: 1",
    "fleet:",
    `  name: ${fleetName}`,
    `  description: ${JSON.stringify("Temp fleet for web UI integration tests")}`,
    agentRefs.length > 0 ? "agents:" : "agents: []",
    ...agentRefs,
    "",
  ].join("\n");
  const configPath = join(tmpRoot, "herdctl.yaml");
  writeFileSync(configPath, fleetYaml, "utf8");

  // 4) Boot the real FleetManager.
  const fleet = new FleetManager({ configPath, stateDir });
  await fleet.initialize();
  if (startScheduler) {
    await fleet.start();
  }

  // 5) Boot the real web server (the exact code the WebManager uses).
  const web = await createWebServer(fleet, {
    host: "127.0.0.1",
    port: 0, // ephemeral port — avoids collisions across parallel workers
    stateDir,
    sessionExpiryHours: 24,
    toolResults: true,
    messageGrouping: "separate",
  });

  await web.server.listen({ host: "127.0.0.1", port: 0 });
  web.fleetBridge.start();

  const address = web.server.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Web server did not bind to a TCP port");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const agentWorkdir = (agentName: string) => join(tmpRoot, "work", agentName);
  const agentSessionDir = (agentName: string) =>
    join(process.env.HOME ?? "", ".claude", "projects", encodePathForCli(agentWorkdir(agentName)));

  const stop = async (): Promise<void> => {
    try {
      web.fleetBridge.stop();
      web.wsHandler.closeAll();
      // The dashboard's WebSocket client auto-reconnects, so it races
      // server.close() and can keep the HTTP server alive indefinitely (the
      // browser page is still open during fixture teardown). Force every open
      // socket shut first, then bound the graceful close so teardown can never
      // hang the test.
      web.server.server.closeAllConnections?.();
      await Promise.race([web.server.close(), new Promise((resolve) => setTimeout(resolve, 2000))]);
      web.server.server.closeAllConnections?.();
    } catch {
      /* ignore */
    }
    try {
      await fleet.stop({ waitForJobs: false, timeout: 5000, cancelOnTimeout: true });
    } catch {
      /* ignore */
    }
    // Remove transcripts the fake claude wrote for these agents, then temp root.
    for (const agent of agents) {
      try {
        rmSync(agentSessionDir(agent.name), { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  return { baseUrl, fleet, web, tmpRoot, agentSessionDir, agentWorkdir, stop };
}
