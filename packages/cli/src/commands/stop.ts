/**
 * herdctl stop - Stop the fleet
 *
 * Commands:
 * - herdctl stop               Graceful stop (wait for jobs)
 * - herdctl stop --force       Immediate stop (cancel jobs)
 * - herdctl stop --timeout 30  Wait max 30 seconds before force kill
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface StopOptions {
  force?: boolean;
  timeout?: number;
  state?: string;
}

/**
 * Default state directory
 */
const DEFAULT_STATE_DIR = ".herdctl";

/**
 * Default timeout in seconds
 */
const DEFAULT_TIMEOUT = 30;

/**
 * Read PID from PID file
 */
async function readPidFile(stateDir: string): Promise<number | null> {
  const pidFile = path.join(stateDir, "herdctl.pid");

  try {
    const content = await fs.promises.readFile(pidFile, "utf-8");
    const pid = parseInt(content.trim(), 10);
    if (Number.isNaN(pid)) {
      return null;
    }
    return pid;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Remove PID file from state directory
 */
async function removePidFile(stateDir: string): Promise<void> {
  const pidFile = path.join(stateDir, "herdctl.pid");

  try {
    await fs.promises.unlink(pidFile);
  } catch (error) {
    // Ignore if file doesn't exist
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

/**
 * Check if a process is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without actually signaling it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Send signal to process
 */
function sendSignal(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a process to exit with timeout
 */
async function waitForProcessExit(pid: number, timeoutSeconds: number): Promise<boolean> {
  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;

  while (Date.now() - startTime < timeoutMs) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    // Check every 100ms
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return !isProcessRunning(pid);
}

/**
 * Stop the fleet
 */
export async function stopCommand(options: StopOptions): Promise<void> {
  const stateDir = options.state || DEFAULT_STATE_DIR;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const force = options.force ?? false;

  // Read PID file
  const pid = await readPidFile(stateDir);

  if (pid === null) {
    console.error("Error: No PID file found. Is the fleet running?");
    console.error(`Checked: ${path.join(stateDir, "herdctl.pid")}`);
    process.exit(1);
  }

  // Check if process is running
  if (!isProcessRunning(pid)) {
    console.error(`Error: Fleet process (PID ${pid}) is not running.`);
    console.log("Cleaning up stale PID file...");
    await removePidFile(stateDir);
    console.log("PID file removed.");
    process.exit(1);
  }

  if (force) {
    // Force stop: send SIGKILL immediately
    console.log(`Force stopping fleet (PID ${pid})...`);
    const sent = sendSignal(pid, "SIGKILL");
    if (!sent) {
      console.error(`Error: Failed to send SIGKILL to process ${pid}.`);
      process.exit(1);
    }

    // Wait briefly for the process to terminate
    const exited = await waitForProcessExit(pid, 5);
    if (!exited) {
      console.error(`Error: Process ${pid} did not terminate after SIGKILL.`);
      process.exit(1);
    }

    await removePidFile(stateDir);
    console.log("Fleet stopped.");
  } else {
    // Graceful stop: send SIGTERM first
    console.log(`Stopping fleet (PID ${pid})...`);
    const sent = sendSignal(pid, "SIGTERM");
    if (!sent) {
      console.error(`Error: Failed to send SIGTERM to process ${pid}.`);
      process.exit(1);
    }

    console.log(`Waiting up to ${timeout} seconds for graceful shutdown...`);

    const exited = await waitForProcessExit(pid, timeout);
    if (exited) {
      await removePidFile(stateDir);
      console.log("Fleet stopped.");
    } else {
      // Timeout reached, force kill
      console.log(`Timeout reached. Force killing process ${pid}...`);
      sendSignal(pid, "SIGKILL");

      const killedExited = await waitForProcessExit(pid, 5);
      if (!killedExited) {
        console.error(`Error: Process ${pid} did not terminate after SIGKILL.`);
        process.exit(1);
      }

      await removePidFile(stateDir);
      console.log("Fleet stopped.");
    }
  }
}
