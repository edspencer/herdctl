/**
 * One-Shot Agent Execution
 *
 * Run a single agent job and exit when complete.
 * Perfect for scripts and one-time tasks.
 *
 * Usage:
 *   npx tsx examples/recipes/one-shot.ts [agent-name] [prompt]
 *
 * Examples:
 *   npx tsx examples/recipes/one-shot.ts
 *   npx tsx examples/recipes/one-shot.ts my-agent
 *   npx tsx examples/recipes/one-shot.ts my-agent "Process the latest data"
 */

import { FleetManager, isAgentNotFoundError } from "@herdctl/core";

async function runOnce(agentName: string, prompt?: string) {
  const manager = new FleetManager({
    configPath: "./herdctl.yaml",
    stateDir: "./.herdctl",
  });

  try {
    await manager.initialize();

    // Validate agent exists before starting
    const agents = await manager.getAgentInfo();
    const agentExists = agents.some((a) => a.name === agentName);
    if (!agentExists) {
      console.error(`Agent not found: ${agentName}`);
      console.error(`Available agents: ${agents.map((a) => a.name).join(", ") || "none"}`);
      process.exit(1);
    }

    await manager.start();

    // Trigger the agent and wait for completion
    const result = await manager.trigger(agentName, undefined, { prompt });
    console.log(`Started job: ${result.jobId}`);
    console.log(`Agent: ${result.agentName}`);
    if (result.prompt) {
      console.log(`Prompt: ${result.prompt}`);
    }

    // Stream output
    manager.on("job:output", (payload) => {
      if (payload.job.id === result.jobId) {
        process.stdout.write(payload.output);
      }
    });

    // Wait for job to complete
    const success = await new Promise<boolean>((resolve) => {
      manager.on("job:completed", (payload) => {
        if (payload.job.id === result.jobId) {
          console.log(`\nJob completed in ${payload.durationSeconds}s`);
          console.log(`Exit reason: ${payload.exitReason}`);
          resolve(true);
        }
      });
      manager.on("job:failed", (payload) => {
        if (payload.job.id === result.jobId) {
          console.error(`\nJob failed: ${payload.error.message}`);
          resolve(false);
        }
      });
    });

    return success ? 0 : 1;
  } catch (error) {
    if (isAgentNotFoundError(error)) {
      console.error(`Agent not found: ${error.agentName}`);
      console.error(`Available: ${error.availableAgents?.join(", ")}`);
    } else {
      console.error("Error:", error);
    }
    return 1;
  } finally {
    await manager.stop();
  }
}

// Parse command line arguments
const agentName = process.argv[2] || "my-agent";
const prompt = process.argv[3];

console.log("=== One-Shot Agent Execution ===\n");

runOnce(agentName, prompt)
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
