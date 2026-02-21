/**
 * Web server factory and WebManager for @herdctl/web
 *
 * Creates a Fastify server that serves the React SPA and provides
 * REST API endpoints and WebSocket connections for fleet management.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import {
  type ChatManagerConnectorState,
  createLogger,
  type FleetManager,
  type FleetManagerContext,
  type IChatManager,
  listJobs,
} from "@herdctl/core";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { WebChatManager } from "./chat/index.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerFleetRoutes } from "./routes/fleet.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerScheduleRoutes } from "./routes/schedules.js";
import { FleetBridge, WebSocketHandler } from "./ws/index.js";

const logger = createLogger("web");

// Get the directory of this file to find the client build
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Configuration for the web server
 */
export interface WebServerConfig {
  /** Port to listen on */
  port: number;
  /** Host to bind to */
  host: string;
}

/**
 * Result of createWebServer containing server and related components
 */
export interface WebServerResult {
  /** The Fastify server instance */
  server: FastifyInstance;
  /** WebSocket handler for managing client connections */
  wsHandler: WebSocketHandler;
  /** Fleet bridge for event broadcasting */
  fleetBridge: FleetBridge;
  /** Web chat manager for handling chat sessions */
  chatManager: WebChatManager;
}

/**
 * Configuration for the web server (extended with state directory)
 */
export interface WebServerConfigExtended extends WebServerConfig {
  /** State directory for persistence (e.g., ".herdctl") */
  stateDir?: string;
  /** Session expiry in hours for chat sessions */
  sessionExpiryHours?: number;
  /** Show tool call results in chat conversations (default: true) */
  toolResults?: boolean;
}

/**
 * Creates a Fastify web server instance with WebSocket support
 *
 * The server is returned but NOT started - the caller controls the lifecycle.
 * The returned FleetBridge should be started after the server starts listening,
 * and stopped before the server closes.
 *
 * @param fleetManager - FleetManager instance for API calls and event subscription
 * @param config - Server configuration
 * @returns WebServerResult containing server, wsHandler, fleetBridge, and chatManager
 */
export async function createWebServer(
  fleetManager: FleetManager,
  config: WebServerConfigExtended,
): Promise<WebServerResult> {
  const server = Fastify({
    logger: false, // We use our own logger
  });

  // Register CORS for development (allow localhost origins)
  await server.register(fastifyCors, {
    origin: [
      "http://localhost:3232",
      "http://localhost:5173", // Vite dev server
      "http://127.0.0.1:3232",
      "http://127.0.0.1:5173",
      `http://${config.host}:${config.port}`,
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });

  // Register WebSocket plugin
  await server.register(fastifyWebsocket);

  // Create WebSocket handler, fleet bridge, and chat manager
  const wsHandler = new WebSocketHandler(fleetManager);
  const fleetBridge = new FleetBridge(fleetManager, wsHandler);
  const chatManager = new WebChatManager();

  // Initialize chat manager if state directory is provided
  if (config.stateDir) {
    await chatManager.initialize(fleetManager, config.stateDir, {
      enabled: true,
      port: config.port,
      host: config.host,
      session_expiry_hours: config.sessionExpiryHours ?? 24,
      open_browser: false,
      tool_results: config.toolResults ?? true,
    });

    // Wire up chat manager to WebSocket handler
    wsHandler.setChatManager(chatManager);
  }

  // Register WebSocket route at /ws
  server.get("/ws", { websocket: true }, (socket, _request) => {
    // Handle new WebSocket connection
    wsHandler.handleConnection(socket).catch((error) => {
      logger.warn(`Error handling WebSocket connection: ${(error as Error).message}`);
    });
  });

  // Register static file serving for the built React SPA
  // The client build outputs to dist/client/ relative to package root
  // When compiled, this file is at dist/server/index.js
  // So we need to go up two levels to get to dist/client
  const clientDistPath = join(__dirname, "..", "client");

  try {
    await server.register(fastifyStatic, {
      root: clientDistPath,
      prefix: "/",
      // Don't serve index.html for API routes
      wildcard: false,
    });
  } catch {
    // Client dist may not exist in development - that's OK
    logger.debug("Client dist not found, static serving disabled");
  }

  // Register REST API routes
  registerFleetRoutes(server, fleetManager);
  registerAgentRoutes(server, fleetManager);
  registerJobRoutes(server, fleetManager, listJobs);
  registerScheduleRoutes(server, fleetManager);
  registerChatRoutes(server, fleetManager, chatManager);

  // Health check endpoint
  server.get("/api/health", async (_request, reply) => {
    return reply.send({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Version endpoint - read package versions at runtime
  server.get("/api/version", async (_request, reply) => {
    try {
      // Read package.json files from the dist directory structure
      // When compiled, this file is at dist/server/index.js
      // Package roots are at ../../ (for @herdctl/web), ../../../cli, ../../../core
      const webPkgPath = join(__dirname, "..", "..", "package.json");
      const cliPkgPath = join(__dirname, "..", "..", "..", "cli", "package.json");
      const corePkgPath = join(__dirname, "..", "..", "..", "core", "package.json");

      const readVersion = (path: string): string => {
        try {
          if (existsSync(path)) {
            const pkg = JSON.parse(readFileSync(path, "utf-8"));
            return pkg.version || "unknown";
          }
        } catch {
          // Ignore read errors
        }
        return "unknown";
      };

      return reply.send({
        web: readVersion(webPkgPath),
        cli: readVersion(cliPkgPath),
        core: readVersion(corePkgPath),
      });
    } catch (error) {
      logger.warn(`Failed to read package versions: ${(error as Error).message}`);
      return reply.send({
        web: "unknown",
        cli: "unknown",
        core: "unknown",
      });
    }
  });

  // SPA fallback - serve index.html for non-API, non-WS routes
  // This must be registered after static file serving and API routes
  const indexPath = join(clientDistPath, "index.html");
  server.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url;

    // Don't serve SPA for API routes, WebSocket, or static assets
    if (url.startsWith("/api/") || url === "/ws" || url.startsWith("/assets/")) {
      return reply.status(404).send({ error: "Not found" });
    }

    // Serve index.html for SPA routing
    if (existsSync(indexPath)) {
      const html = readFileSync(indexPath, "utf-8");
      return reply.type("text/html").send(html);
    }

    // Client build not available
    return reply.status(503).send({
      error: "Client not built",
      message: "Run 'pnpm build:client' to build the web dashboard",
    });
  });

  // Log registered routes in debug mode
  logger.debug("Web server routes registered (REST + WebSocket + SPA fallback)");

  return { server, wsHandler, fleetBridge, chatManager };
}

/**
 * State object for WebManager
 */
export interface WebManagerState {
  /** Whether the manager has been initialized */
  initialized: boolean;
  /** Whether the server is currently running */
  running: boolean;
  /** Host the server is bound to */
  host: string | null;
  /** Port the server is listening on */
  port: number | null;
  /** Number of connected WebSocket clients */
  connectedClients: number;
  /** ISO timestamp when the server started */
  startedAt: string | null;
}

/**
 * WebManager manages the web dashboard server lifecycle
 *
 * Implements IChatManager interface for integration with FleetManager.
 * Unlike Discord/Slack managers which have per-agent connectors,
 * WebManager provides a single dashboard that serves all agents.
 */
export class WebManager implements IChatManager {
  private ctx: FleetManagerContext;
  private server: FastifyInstance | null = null;
  private wsHandler: WebSocketHandler | null = null;
  private fleetBridge: FleetBridge | null = null;
  private initialized = false;

  private connectorState: ChatManagerConnectorState = {
    status: "disconnected",
    connectedAt: null,
    disconnectedAt: null,
    reconnectAttempts: 0,
    lastError: null,
    botUser: null,
    messageStats: {
      received: 0,
      sent: 0,
      ignored: 0,
    },
  };

  constructor(ctx: FleetManagerContext) {
    this.ctx = ctx;
  }

  /**
   * Initialize the web manager
   *
   * Creates the Fastify server with WebSocket support and REST API routes.
   * Does not start listening - that happens in start().
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const log = this.ctx.getLogger();
    const config = this.ctx.getConfig();

    // Web config is at fleet level (config.fleet.web), not on ResolvedConfig directly
    if (!config?.fleet?.web?.enabled) {
      log.debug("Web UI not enabled in configuration");
      this.initialized = true;
      return;
    }

    const webConfig = config.fleet.web;

    try {
      // Get the FleetManager instance (the context IS the FleetManager)
      const fleetManager = this.ctx.getEmitter() as unknown as FleetManager;

      // Create the web server with all components
      const stateDir = this.ctx.getStateDir();
      const result = await createWebServer(fleetManager, {
        host: webConfig.host,
        port: webConfig.port,
        stateDir,
        sessionExpiryHours: webConfig.session_expiry_hours,
        toolResults: webConfig.tool_results,
      });

      this.server = result.server;
      this.wsHandler = result.wsHandler;
      this.fleetBridge = result.fleetBridge;

      this.initialized = true;
      log.debug("Web manager initialized");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.connectorState.lastError = errorMessage;
      log.error(`Failed to initialize web manager: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Start the web server
   *
   * Starts listening on the configured host:port and begins
   * broadcasting FleetManager events to WebSocket clients.
   */
  async start(): Promise<void> {
    const log = this.ctx.getLogger();
    const config = this.ctx.getConfig();

    // Web config is at fleet level (config.fleet.web)
    if (!config?.fleet?.web?.enabled) {
      log.debug("Web UI not enabled, skipping start");
      return;
    }

    if (!this.initialized) {
      throw new Error("WebManager must be initialized before starting");
    }

    if (!this.server || !this.fleetBridge) {
      log.debug("Web server not created (initialization may have failed)");
      return;
    }

    const webConfig = config.fleet.web;

    try {
      // Start the Fastify server
      await this.server.listen({
        host: webConfig.host,
        port: webConfig.port,
      });

      // Start the fleet bridge to broadcast events
      this.fleetBridge.start();

      // Update connector state
      this.connectorState.status = "connected";
      this.connectorState.connectedAt = new Date().toISOString();
      this.connectorState.lastError = null;

      const url = `http://${webConfig.host}:${webConfig.port}`;
      logger.info(`Web dashboard available at ${url}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.connectorState.status = "error";
      this.connectorState.lastError = errorMessage;
      log.error(`Failed to start web server: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Stop the web server
   *
   * Gracefully shuts down the Fastify server and stops event broadcasting.
   */
  async stop(): Promise<void> {
    const log = this.ctx.getLogger();

    if (this.fleetBridge) {
      this.fleetBridge.stop();
    }

    if (this.wsHandler) {
      this.wsHandler.closeAll();
    }

    if (this.server) {
      try {
        await this.server.close();
        log.debug("Web server stopped");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.warn(`Error stopping web server: ${errorMessage}`);
      }
    }

    this.connectorState.status = "disconnected";
    this.connectorState.disconnectedAt = new Date().toISOString();
  }

  /**
   * Check if the manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the connector names managed by this manager
   *
   * Unlike Discord/Slack which have per-agent connectors,
   * the web dashboard returns ["web"] to indicate it manages
   * the single web interface.
   */
  getConnectorNames(): string[] {
    return ["web"];
  }

  /**
   * Get the count of connected WebSocket clients
   */
  getConnectedCount(): number {
    return this.wsHandler?.getConnectedCount() ?? 0;
  }

  /**
   * Check if a specific agent is accessible via the web dashboard
   *
   * All agents are accessible via the web dashboard, so this always returns true.
   */
  hasAgent(_agentName: string): boolean {
    return true;
  }

  /**
   * Get the connector state for a specific agent
   *
   * Since the web dashboard doesn't have per-agent connectors,
   * this returns the overall web server state for any agent.
   */
  getState(_agentName: string): ChatManagerConnectorState | undefined {
    return {
      ...this.connectorState,
      // Update message stats with current connected count
      messageStats: {
        ...this.connectorState.messageStats,
        // We can use received to track total connections over time if needed
      },
    };
  }

  /**
   * Get the internal web manager state
   *
   * This provides additional state information beyond the IChatManager interface.
   */
  getWebState(): WebManagerState {
    const config = this.ctx.getConfig();
    const webConfig = config?.fleet?.web;

    return {
      initialized: this.initialized,
      running: this.connectorState.status === "connected",
      host: webConfig?.host ?? null,
      port: webConfig?.port ?? null,
      connectedClients: this.getConnectedCount(),
      startedAt: this.connectorState.connectedAt,
    };
  }
}

// Re-export chat types for consumers
export {
  type ChatMessage,
  type OnChunkCallback,
  type SendMessageResult,
  WebChatManager,
  type WebChatSession,
  type WebChatSessionDetails,
} from "./chat/index.js";
// Re-export WebSocket types for consumers
export {
  type AgentUpdatedMessage,
  type ChatCompleteMessage,
  type ChatErrorMessage,
  type ChatResponseMessage,
  type ChatSendMessage,
  type ClientMessage,
  FleetBridge,
  type FleetStatusMessage,
  isAgentStartedPayload,
  isAgentStoppedPayload,
  isChatSendMessage,
  isClientMessage,
  type JobCancelledMessage,
  type JobCompletedMessage,
  type JobCreatedMessage,
  type JobFailedMessage,
  type JobOutputMessage,
  type PingMessage,
  type PongMessage,
  type ScheduleTriggeredMessage,
  type ServerMessage,
  type SubscribeMessage,
  type UnsubscribeMessage,
  type WebSocketClient,
  WebSocketHandler,
} from "./ws/index.js";
