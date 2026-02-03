/**
 * herdctl sessions - List and resume Claude Code sessions for agents
 *
 * Commands:
 * - herdctl sessions                     List all sessions
 * - herdctl sessions --agent <name>      Sessions for specific agent
 * - herdctl sessions --verbose           Show full resume commands
 * - herdctl sessions --json              JSON output
 * - herdctl sessions resume [session-id] Resume a session in Claude Code
 */

import { listSessions, loadConfig, type SessionInfo } from "@herdctl/core";
import { join } from "node:path";
import { spawn } from "node:child_process";

export interface SessionsOptions {
  agent?: string;
  verbose?: boolean;
  json?: boolean;
  state?: string;
  config?: string;
}

export interface SessionsResumeOptions {
  state?: string;
  config?: string;
}

/**
 * Default state directory
 */
const DEFAULT_STATE_DIR = ".herdctl";

/**
 * Check if colors should be disabled
 */
function shouldUseColor(): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") {
    return false;
  }
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") {
    return true;
  }
  return process.stdout.isTTY === true;
}

/**
 * ANSI color codes
 */
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  blue: "\x1b[34m",
};

/**
 * Get a colored string, respecting NO_COLOR
 */
function colorize(text: string, color: keyof typeof colors): string {
  if (!shouldUseColor()) {
    return text;
  }
  return `${colors[color]}${text}${colors.reset}`;
}

/**
 * Format relative time (e.g., "5m ago")
 */
function formatRelativeTime(isoTimestamp: string): string {
  const now = Date.now();
  const timestamp = new Date(isoTimestamp).getTime();
  const diffMs = now - timestamp;
  const absDiffMs = Math.abs(diffMs);

  const seconds = Math.floor(absDiffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let timeStr: string;
  if (days > 0) {
    timeStr = `${days}d`;
  } else if (hours > 0) {
    timeStr = `${hours}h`;
  } else if (minutes > 0) {
    timeStr = `${minutes}m`;
  } else {
    timeStr = `${seconds}s`;
  }

  return `${timeStr} ago`;
}

/**
 * Format sessions table for console output
 */
function formatSessionsTable(
  sessions: SessionInfo[],
  agentWorkspaces: Map<string, string | undefined>
): string {
  const lines: string[] = [];

  if (sessions.length === 0) {
    lines.push("");
    lines.push(colorize("No sessions found.", "dim"));
    lines.push("");
    lines.push(colorize("Sessions are created when agents run with session persistence enabled.", "dim"));
    lines.push("");
    return lines.join("\n");
  }

  // Header
  lines.push("");
  lines.push(colorize(`Sessions (${sessions.length})`, "bold"));
  lines.push("═".repeat(90));

  // Calculate column widths
  const agentWidth = Math.max(8, ...sessions.map((s) => s.agent_name.length)) + 2;
  const sessionIdWidth = 38; // UUIDs are 36 chars + padding
  const lastActiveWidth = 14;
  const jobsWidth = 6;

  // Table header
  lines.push(
    `${"AGENT".padEnd(agentWidth)}${"SESSION ID".padEnd(sessionIdWidth)}${"LAST ACTIVE".padEnd(lastActiveWidth)}${"JOBS".padEnd(jobsWidth)}`
  );
  lines.push(colorize("─".repeat(agentWidth + sessionIdWidth + lastActiveWidth + jobsWidth), "dim"));

  // Table rows
  for (const session of sessions) {
    const agentPad = shouldUseColor()
      ? agentWidth + colors.cyan.length + colors.reset.length
      : agentWidth;

    lines.push(
      `${colorize(session.agent_name, "cyan").padEnd(agentPad)}${session.session_id.padEnd(sessionIdWidth)}${formatRelativeTime(session.last_used_at).padEnd(lastActiveWidth)}${String(session.job_count).padEnd(jobsWidth)}`
    );
  }

  // Footer with resume instructions
  lines.push("");
  lines.push(colorize("Resume a session in Claude Code:", "dim"));

  // If all agents have the same workspace (or no workspace), show generic command
  const workspaces = new Set(agentWorkspaces.values());
  if (workspaces.size === 1 && workspaces.has(undefined)) {
    lines.push(colorize("  claude --resume <session-id>", "dim"));
  } else {
    lines.push(colorize("  cd <workspace> && claude --resume <session-id>", "dim"));
    lines.push("");
    lines.push(colorize("Use --verbose to see full resume commands for each agent.", "dim"));
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Format sessions in verbose mode with full resume commands
 */
function formatSessionsVerbose(
  sessions: SessionInfo[],
  agentWorkspaces: Map<string, string | undefined>
): string {
  const lines: string[] = [];

  if (sessions.length === 0) {
    lines.push("");
    lines.push(colorize("No sessions found.", "dim"));
    lines.push("");
    return lines.join("\n");
  }

  lines.push("");
  lines.push(colorize(`Sessions (${sessions.length})`, "bold"));
  lines.push("═".repeat(90));

  for (const session of sessions) {
    lines.push("");
    lines.push(
      `${colorize(session.agent_name, "cyan")} ${colorize(`(${session.job_count} jobs, ${formatRelativeTime(session.last_used_at)})`, "dim")}`
    );
    lines.push(`  Session: ${session.session_id}`);

    const workspace = agentWorkspaces.get(session.agent_name);
    if (workspace) {
      lines.push(`  Resume:  ${colorize(`cd ${workspace} && claude --resume ${session.session_id}`, "green")}`);
    } else {
      lines.push(`  Resume:  ${colorize(`claude --resume ${session.session_id}`, "green")}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * JSON output structure for sessions list
 */
interface SessionsListJson {
  sessions: Array<{
    agentName: string;
    sessionId: string;
    createdAt: string;
    lastUsedAt: string;
    jobCount: number;
    mode: string;
    workspace?: string;
    resumeCommand: string;
  }>;
  total: number;
}

/**
 * List sessions (herdctl sessions)
 */
export async function sessionsCommand(options: SessionsOptions): Promise<void> {
  const stateDir = options.state || DEFAULT_STATE_DIR;
  const isJsonOutput = options.json === true;
  const isVerbose = options.verbose === true;

  try {
    const sessionsDir = join(stateDir, "sessions");

    // Get all sessions
    let sessions = await listSessions(sessionsDir);

    // Filter by agent if specified
    if (options.agent) {
      sessions = sessions.filter((s) => s.agent_name === options.agent);
    }

    // Try to load config to get workspace paths for each agent
    const agentWorkspaces = new Map<string, string | undefined>();
    try {
      const config = await loadConfig(options.config || ".");
      for (const agent of config.agents) {
        // workspace can be a string or an object with a root property
        const workspace = agent.working_directory;
        if (typeof workspace === "string") {
          agentWorkspaces.set(agent.name, workspace);
        } else if (workspace && typeof workspace === "object" && "root" in workspace) {
          agentWorkspaces.set(agent.name, workspace.root);
        } else {
          agentWorkspaces.set(agent.name, undefined);
        }
      }
    } catch {
      // Config might not be available - that's okay
    }

    if (isJsonOutput) {
      const output: SessionsListJson = {
        sessions: sessions.map((session) => {
          const workspace = agentWorkspaces.get(session.agent_name);
          const resumeCommand = workspace
            ? `cd ${workspace} && claude --resume ${session.session_id}`
            : `claude --resume ${session.session_id}`;

          return {
            agentName: session.agent_name,
            sessionId: session.session_id,
            createdAt: session.created_at,
            lastUsedAt: session.last_used_at,
            jobCount: session.job_count,
            mode: session.mode,
            workspace,
            resumeCommand,
          };
        }),
        total: sessions.length,
      };
      console.log(JSON.stringify(output, null, 2));
    } else if (isVerbose) {
      console.log(formatSessionsVerbose(sessions, agentWorkspaces));
    } else {
      console.log(formatSessionsTable(sessions, agentWorkspaces));
    }
  } catch (error) {
    // Generic error
    if (isJsonOutput) {
      console.log(
        JSON.stringify({
          error: {
            code: "UNKNOWN_ERROR",
            message: error instanceof Error ? error.message : String(error),
          },
        })
      );
      process.exit(1);
    }
    console.error("");
    console.error("Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Get workspace path for an agent from config
 */
async function getAgentWorkspace(
  agentName: string,
  configPath: string
): Promise<string | undefined> {
  try {
    const config = await loadConfig(configPath);
    const agent = config.agents.find((a) => a.name === agentName);
    if (!agent) return undefined;

    const workspace = agent.working_directory;
    if (typeof workspace === "string") {
      return workspace;
    } else if (workspace && typeof workspace === "object" && "root" in workspace) {
      return workspace.root;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resume a session in Claude Code (herdctl sessions resume)
 *
 * If no session ID is provided, resumes the most recently active session.
 */
export async function sessionsResumeCommand(
  sessionId: string | undefined,
  options: SessionsResumeOptions
): Promise<void> {
  const stateDir = options.state || DEFAULT_STATE_DIR;

  try {
    const sessionsDir = join(stateDir, "sessions");

    // Get all sessions (sorted by last_used_at descending)
    const sessions = await listSessions(sessionsDir);

    if (sessions.length === 0) {
      console.error("");
      console.error(colorize("No sessions found.", "red"));
      console.error("");
      console.error("Sessions are created when agents run with session persistence enabled.");
      process.exit(1);
    }

    // Find the session to resume
    let session: SessionInfo | undefined;

    if (sessionId) {
      // Find by session ID (support partial matches)
      session = sessions.find(
        (s) => s.session_id === sessionId || s.session_id.startsWith(sessionId)
      );

      if (!session) {
        // Maybe they passed an agent name instead?
        session = sessions.find((s) => s.agent_name === sessionId);
      }

      if (!session) {
        console.error("");
        console.error(colorize(`Session not found: ${sessionId}`, "red"));
        console.error("");
        console.error("Available sessions:");
        for (const s of sessions.slice(0, 5)) {
          console.error(`  ${s.agent_name}: ${s.session_id}`);
        }
        if (sessions.length > 5) {
          console.error(`  ... and ${sessions.length - 5} more`);
        }
        process.exit(1);
      }
    } else {
      // Use the most recent session
      session = sessions[0];
    }

    // Get the workspace for this agent
    const workspace = await getAgentWorkspace(session.agent_name, options.config || ".");

    // Display what we're resuming
    console.log("");
    console.log(
      `Resuming session for ${colorize(session.agent_name, "cyan")} (${session.job_count} jobs, last active ${formatRelativeTime(session.last_used_at)})`
    );
    console.log(`Session: ${colorize(session.session_id, "dim")}`);
    if (workspace) {
      console.log(`Workspace: ${colorize(workspace, "dim")}`);
    }
    console.log("");

    // Build the claude command
    const claudeArgs = ["--resume", session.session_id];

    // Spawn claude in the workspace directory
    const cwd = workspace || process.cwd();

    console.log(colorize(`Running: claude ${claudeArgs.join(" ")}`, "dim"));
    if (workspace) {
      console.log(colorize(`     in: ${cwd}`, "dim"));
    }
    console.log("");

    // Spawn claude as an interactive process
    const child = spawn("claude", claudeArgs, {
      cwd,
      stdio: "inherit", // Inherit stdin/stdout/stderr for interactive use
      shell: true,
    });

    child.on("error", (error) => {
      console.error("");
      console.error(colorize(`Failed to start Claude: ${error.message}`, "red"));
      console.error("");
      console.error("Make sure Claude Code CLI is installed and in your PATH.");
      process.exit(1);
    });

    child.on("close", (code) => {
      process.exit(code ?? 0);
    });
  } catch (error) {
    console.error("");
    console.error("Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
