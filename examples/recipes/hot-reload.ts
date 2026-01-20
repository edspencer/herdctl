/**
 * Hot-Reload Configuration Example
 *
 * Watch for configuration changes and reload without restarting.
 *
 * Usage:
 *   npx tsx examples/recipes/hot-reload.ts
 *
 * Then edit herdctl.yaml or any agent YAML file to see hot reload in action.
 */

import { watch, FSWatcher } from "fs";
import { FleetManager } from "@herdctl/core";

// Simple debounce helper
function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | undefined;
  return (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

async function startWithHotReload() {
  const configPath = "./herdctl.yaml";
  const agentsDir = "./agents";

  const manager = new FleetManager({
    configPath,
    stateDir: "./.herdctl",
    checkInterval: 5000,
    logger: {
      debug: () => {},
      info: (msg) => console.log(`[INFO] ${msg}`),
      warn: (msg) => console.warn(`[WARN] ${msg}`),
      error: (msg) => console.error(`[ERROR] ${msg}`),
    },
  });

  // Track reload state
  let reloadCount = 0;
  let lastReloadTime: Date | null = null;

  // Handle reload events
  manager.on("config:reloaded", (payload) => {
    reloadCount++;
    lastReloadTime = new Date();

    console.log(`\n=== Config Reloaded (#${reloadCount}) ===`);
    console.log(`Time: ${lastReloadTime.toLocaleTimeString()}`);
    console.log(`Agents: ${payload.agentCount}`);

    if (payload.changes.length > 0) {
      console.log("Changes:");
      for (const change of payload.changes) {
        const icon =
          change.type === "added" ? "+" :
          change.type === "removed" ? "-" : "~";
        console.log(`  ${icon} ${change.category}: ${change.name}`);
      }
    } else {
      console.log("No changes detected.");
    }
    console.log("===================================\n");
  });

  manager.on("error", (error) => {
    console.error(`Fleet error: ${error.message}`);
  });

  // Initialize and start
  await manager.initialize();
  await manager.start();

  // Debounced reload function to handle rapid changes
  const reload = debounce(async () => {
    console.log("\nConfiguration change detected, reloading...");
    try {
      await manager.reload();
    } catch (error) {
      console.error("Reload failed:", error);
      console.error("Fleet continues running with previous configuration.");
    }
  }, 500); // Wait 500ms for changes to settle

  // File watchers
  const watchers: FSWatcher[] = [];

  // Watch main config file
  try {
    const configWatcher = watch(configPath, (eventType, filename) => {
      if (eventType === "change") {
        console.log(`Change detected: ${configPath}`);
        reload();
      }
    });
    watchers.push(configWatcher);
    console.log(`Watching: ${configPath}`);
  } catch (error) {
    console.warn(`Could not watch ${configPath}: ${error}`);
  }

  // Watch agents directory
  try {
    const agentsWatcher = watch(agentsDir, { recursive: true }, (eventType, filename) => {
      if (filename && (filename.endsWith(".yaml") || filename.endsWith(".yml"))) {
        console.log(`Change detected: ${agentsDir}/${filename}`);
        reload();
      }
    });
    watchers.push(agentsWatcher);
    console.log(`Watching: ${agentsDir}/**/*.yaml`);
  } catch (error) {
    console.warn(`Could not watch ${agentsDir}: ${error}`);
  }

  // Log initial status
  const status = await manager.getFleetStatus();
  console.log("\n=== Fleet Status ===");
  console.log(`State: ${status.state}`);
  console.log(`Agents: ${status.counts.totalAgents}`);
  console.log(`Schedules: ${status.counts.totalSchedules}`);

  const agents = await manager.getAgentInfo();
  for (const agent of agents) {
    console.log(`  - ${agent.name} (${agent.schedules.length} schedules)`);
  }
  console.log("====================\n");

  console.log("Hot reload enabled. Edit configuration files to see changes.");
  console.log("Press Ctrl+C to stop.\n");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");

    // Close file watchers
    for (const watcher of watchers) {
      watcher.close();
    }

    await manager.stop();

    console.log(`\nSession Statistics:`);
    console.log(`  Config reloads: ${reloadCount}`);
    if (lastReloadTime) {
      console.log(`  Last reload: ${lastReloadTime.toLocaleTimeString()}`);
    }

    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

console.log("=== Hot-Reload Configuration Example ===\n");

startWithHotReload().catch((error) => {
  console.error("Failed to start:", error);
  process.exit(1);
});
