/**
 * Fastify Plugin Example
 *
 * Demonstrates integrating herdctl into an existing Fastify application
 * as a plugin with typed routes.
 *
 * Usage:
 *   npx tsx examples/recipes/fastify-plugin.ts
 *
 * Then test with:
 *   curl http://localhost:3000/fleet/status
 *   curl http://localhost:3000/fleet/agents
 *   curl -X POST http://localhost:3000/fleet/trigger/my-agent -H "Content-Type: application/json" -d '{}'
 */

import Fastify, { FastifyInstance, FastifyPluginOptions } from "fastify";
import {
  FleetManager,
  isAgentNotFoundError,
  isJobNotFoundError,
  isConcurrencyLimitError,
  type FleetStatus,
  type AgentInfo,
  type TriggerResult,
  type CancelJobResult,
} from "@herdctl/core";

// Extend Fastify types to include fleet manager
declare module "fastify" {
  interface FastifyInstance {
    fleet: FleetManager;
  }
}

// Plugin options
interface HerdctlPluginOptions extends FastifyPluginOptions {
  configPath?: string;
  stateDir?: string;
  prefix?: string;
}

// Request/Response types
interface TriggerBody {
  schedule?: string;
  prompt?: string;
  force?: boolean;
}

interface AgentParams {
  name: string;
}

interface JobParams {
  jobId: string;
}

// Fastify plugin for herdctl
async function herdctlPlugin(
  fastify: FastifyInstance,
  options: HerdctlPluginOptions
): Promise<void> {
  const manager = new FleetManager({
    configPath: options.configPath || "./herdctl.yaml",
    stateDir: options.stateDir || "./.herdctl",
  });

  await manager.initialize();
  await manager.start();

  // Decorate fastify with the manager
  fastify.decorate("fleet", manager);

  // Add prefix to all routes
  const prefix = options.prefix || "/fleet";

  // Get fleet status
  fastify.get<{ Reply: FleetStatus }>(
    `${prefix}/status`,
    {
      schema: {
        description: "Get fleet status",
        tags: ["fleet"],
        response: {
          200: {
            type: "object",
            properties: {
              state: { type: "string" },
              uptimeSeconds: { type: ["number", "null"] },
              initializedAt: { type: ["string", "null"] },
              startedAt: { type: ["string", "null"] },
              stoppedAt: { type: ["string", "null"] },
              lastError: { type: ["string", "null"] },
              counts: {
                type: "object",
                properties: {
                  totalAgents: { type: "number" },
                  idleAgents: { type: "number" },
                  runningAgents: { type: "number" },
                  errorAgents: { type: "number" },
                  totalSchedules: { type: "number" },
                  runningSchedules: { type: "number" },
                  runningJobs: { type: "number" },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      return manager.getFleetStatus();
    }
  );

  // List all agents
  fastify.get<{ Reply: AgentInfo[] }>(
    `${prefix}/agents`,
    {
      schema: {
        description: "List all agents",
        tags: ["fleet"],
      },
    },
    async () => {
      return manager.getAgentInfo();
    }
  );

  // Get specific agent
  fastify.get<{ Params: AgentParams; Reply: AgentInfo | { error: string } }>(
    `${prefix}/agents/:name`,
    {
      schema: {
        description: "Get agent by name",
        tags: ["fleet"],
        params: {
          type: "object",
          properties: {
            name: { type: "string" },
          },
          required: ["name"],
        },
      },
    },
    async (request, reply) => {
      try {
        return await manager.getAgentInfoByName(request.params.name);
      } catch (error) {
        if (isAgentNotFoundError(error)) {
          return reply.status(404).send({
            error: `Agent not found: ${error.agentName}`,
          });
        }
        throw error;
      }
    }
  );

  // Trigger an agent
  fastify.post<{
    Params: AgentParams;
    Body: TriggerBody;
    Reply: TriggerResult | { error: string };
  }>(
    `${prefix}/trigger/:name`,
    {
      schema: {
        description: "Trigger an agent",
        tags: ["fleet"],
        params: {
          type: "object",
          properties: {
            name: { type: "string" },
          },
          required: ["name"],
        },
        body: {
          type: "object",
          properties: {
            schedule: { type: "string" },
            prompt: { type: "string" },
            force: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { schedule, prompt, force } = request.body || {};
        return await manager.trigger(request.params.name, schedule, {
          prompt,
          bypassConcurrencyLimit: force,
        });
      } catch (error) {
        if (isAgentNotFoundError(error)) {
          return reply.status(404).send({
            error: `Agent not found: ${error.agentName}`,
          });
        }
        if (isConcurrencyLimitError(error)) {
          return reply.status(429).send({
            error: `Agent at capacity: ${error.currentJobs}/${error.limit}`,
          });
        }
        throw error;
      }
    }
  );

  // Cancel a job
  fastify.delete<{
    Params: JobParams;
    Reply: CancelJobResult | { error: string };
  }>(
    `${prefix}/jobs/:jobId`,
    {
      schema: {
        description: "Cancel a running job",
        tags: ["fleet"],
        params: {
          type: "object",
          properties: {
            jobId: { type: "string" },
          },
          required: ["jobId"],
        },
      },
    },
    async (request, reply) => {
      try {
        return await manager.cancelJob(request.params.jobId);
      } catch (error) {
        if (isJobNotFoundError(error)) {
          return reply.status(404).send({
            error: `Job not found: ${error.jobId}`,
          });
        }
        throw error;
      }
    }
  );

  // Reload configuration
  fastify.post<{ Reply: { success: boolean; agentCount: number } }>(
    `${prefix}/reload`,
    {
      schema: {
        description: "Reload fleet configuration",
        tags: ["fleet"],
      },
    },
    async () => {
      await manager.reload();
      return {
        success: true,
        agentCount: manager.state.agentCount,
      };
    }
  );

  // Health check endpoint
  fastify.get<{ Reply: { status: string; fleet: string } }>(
    `${prefix}/health`,
    {
      schema: {
        description: "Health check",
        tags: ["fleet"],
      },
    },
    async () => {
      return {
        status: "ok",
        fleet: manager.state.status,
      };
    }
  );

  // Cleanup on server close
  fastify.addHook("onClose", async () => {
    fastify.log.info("Stopping fleet manager...");
    await manager.stop();
    fastify.log.info("Fleet manager stopped");
  });
}

// Create and configure Fastify server
const fastify = Fastify({
  logger: {
    level: "info",
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
      },
    },
  },
});

// Register your existing plugins...
// fastify.register(require('@fastify/cors'));
// fastify.register(require('@fastify/swagger'));

// Add a simple root route
fastify.get("/", async () => {
  return {
    name: "Fleet API",
    version: "1.0.0",
    endpoints: {
      status: "GET /fleet/status",
      agents: "GET /fleet/agents",
      agent: "GET /fleet/agents/:name",
      trigger: "POST /fleet/trigger/:name",
      cancel: "DELETE /fleet/jobs/:jobId",
      reload: "POST /fleet/reload",
      health: "GET /fleet/health",
    },
  };
});

// Register herdctl plugin
fastify.register(herdctlPlugin, {
  configPath: "./herdctl.yaml",
  stateDir: "./.herdctl",
  prefix: "/fleet",
});

// Start server
async function start() {
  try {
    const port = parseInt(process.env.PORT || "3000", 10);
    await fastify.listen({ port, host: "0.0.0.0" });

    console.log(`\n=== Fleet API (Fastify) ===`);
    console.log(`Server running at http://localhost:${port}`);
    console.log(`\nEndpoints:`);
    console.log(`  GET  /fleet/status        - Fleet status`);
    console.log(`  GET  /fleet/agents        - List agents`);
    console.log(`  GET  /fleet/agents/:name  - Get agent`);
    console.log(`  POST /fleet/trigger/:name - Trigger agent`);
    console.log(`  DELETE /fleet/jobs/:id    - Cancel job`);
    console.log(`  POST /fleet/reload        - Reload config`);
    console.log(`  GET  /fleet/health        - Health check`);
    console.log(`\nPress Ctrl+C to stop.\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
