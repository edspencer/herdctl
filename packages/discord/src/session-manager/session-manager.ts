/**
 * Session manager for Discord channel conversations
 *
 * Provides per-channel session management for Claude conversations,
 * enabling conversation context preservation across Discord channels.
 *
 * Sessions are stored at .herdctl/discord-sessions/<agent-name>.yaml
 */

import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createLogger } from "@herdctl/core";
import {
  type SessionManagerOptions,
  type SessionManagerLogger,
  type ISessionManager,
  type SessionResult,
  type ChannelSession,
  type DiscordSessionState,
  DiscordSessionStateSchema,
  createInitialSessionState,
  createChannelSession,
} from "./types.js";
import {
  SessionStateReadError,
  SessionStateWriteError,
  SessionDirectoryCreateError,
} from "./errors.js";

// =============================================================================
// Default Logger
// =============================================================================

function createDefaultLogger(agentName: string): SessionManagerLogger {
  return createLogger(`session:${agentName}`);
}

// =============================================================================
// Session Manager Implementation
// =============================================================================

/**
 * SessionManager manages per-channel Claude sessions for a Discord agent.
 *
 * Each agent has its own SessionManager instance, storing session mappings
 * in a YAML file at .herdctl/discord-sessions/<agent-name>.yaml
 *
 * Features:
 * - Create new sessions for channels/DMs
 * - Resume existing sessions when user sends messages
 * - Automatic session expiry based on configurable timeout
 * - Cleanup expired sessions on startup
 *
 * @example
 * ```typescript
 * const sessionManager = new SessionManager({
 *   agentName: 'my-agent',
 *   stateDir: '.herdctl',
 *   sessionExpiryHours: 24,
 * });
 *
 * // Get or create a session for a channel
 * const { sessionId, isNew } = await sessionManager.getOrCreateSession('channel-123');
 *
 * // After sending/receiving a message
 * await sessionManager.touchSession('channel-123');
 *
 * // Cleanup expired sessions on startup
 * const cleanedUp = await sessionManager.cleanupExpiredSessions();
 * ```
 */
export class SessionManager implements ISessionManager {
  public readonly agentName: string;

  private readonly stateDir: string;
  private readonly sessionExpiryHours: number;
  private readonly logger: SessionManagerLogger;
  private readonly stateFilePath: string;

  // In-memory cache of session state
  private state: DiscordSessionState | null = null;

  constructor(options: SessionManagerOptions) {
    this.agentName = options.agentName;
    this.stateDir = options.stateDir;
    this.sessionExpiryHours = options.sessionExpiryHours ?? 24;
    this.logger =
      options.logger ?? createDefaultLogger(options.agentName);

    // Compute state file path
    this.stateFilePath = join(
      this.stateDir,
      "discord-sessions",
      `${this.agentName}.yaml`
    );
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Get or create a session for a channel/DM
   *
   * If an active (non-expired) session exists, returns it.
   * Otherwise, creates a new session with a generated session ID.
   */
  async getOrCreateSession(channelId: string): Promise<SessionResult> {
    const existingSession = await this.getSession(channelId);

    if (existingSession) {
      this.logger.info("Resuming existing session", {
        channelId,
        sessionId: existingSession.sessionId,
      });
      return {
        sessionId: existingSession.sessionId,
        isNew: false,
      };
    }

    // Create new session
    const sessionId = this.generateSessionId();
    const state = await this.loadState();
    const now = new Date().toISOString();

    state.channels[channelId] = {
      sessionId,
      lastMessageAt: now,
    };

    await this.saveState(state);

    this.logger.info("Created new session", { channelId, sessionId });

    return {
      sessionId,
      isNew: true,
    };
  }

  /**
   * Update the last message timestamp for a session
   */
  async touchSession(channelId: string): Promise<void> {
    const state = await this.loadState();
    const session = state.channels[channelId];

    if (!session) {
      this.logger.warn("Attempted to touch non-existent session", {
        channelId,
      });
      return;
    }

    session.lastMessageAt = new Date().toISOString();
    await this.saveState(state);

    this.logger.debug("Touched session", {
      channelId,
      sessionId: session.sessionId,
    });
  }

  /**
   * Get an existing session without creating one
   *
   * Returns null if no session exists or if the session is expired.
   */
  async getSession(channelId: string): Promise<ChannelSession | null> {
    const state = await this.loadState();
    const session = state.channels[channelId];

    if (!session) {
      return null;
    }

    // Check if session is expired
    if (this.isSessionExpired(session)) {
      this.logger.info("Session expired", {
        channelId,
        sessionId: session.sessionId,
        lastMessageAt: session.lastMessageAt,
        expiryHours: this.sessionExpiryHours,
      });
      return null;
    }

    return session;
  }

  /**
   * Store or update the session ID for a channel
   *
   * Called after a job completes to store the SDK-provided session ID.
   */
  async setSession(channelId: string, sessionId: string): Promise<void> {
    const state = await this.loadState();
    const now = new Date().toISOString();
    const existingSession = state.channels[channelId];

    state.channels[channelId] = {
      sessionId,
      lastMessageAt: now,
    };

    await this.saveState(state);

    if (existingSession) {
      this.logger.debug("Updated session", {
        channelId,
        oldSessionId: existingSession.sessionId,
        newSessionId: sessionId,
      });
    } else {
      this.logger.info("Stored new session", { channelId, sessionId });
    }
  }

  /**
   * Clear a specific session
   */
  async clearSession(channelId: string): Promise<boolean> {
    const state = await this.loadState();

    if (!state.channels[channelId]) {
      return false;
    }

    const sessionId = state.channels[channelId].sessionId;
    delete state.channels[channelId];
    await this.saveState(state);

    this.logger.info("Cleared session", { channelId, sessionId });
    return true;
  }

  /**
   * Clean up all expired sessions
   *
   * Should be called on connector startup and periodically.
   */
  async cleanupExpiredSessions(): Promise<number> {
    const state = await this.loadState();
    const channelIds = Object.keys(state.channels);
    let cleanedUp = 0;

    for (const channelId of channelIds) {
      const session = state.channels[channelId];
      if (this.isSessionExpired(session)) {
        this.logger.debug("Cleaning up expired session", {
          channelId,
          sessionId: session.sessionId,
          lastMessageAt: session.lastMessageAt,
        });
        delete state.channels[channelId];
        cleanedUp++;
      }
    }

    if (cleanedUp > 0) {
      await this.saveState(state);
      this.logger.info("Cleaned up expired sessions", { count: cleanedUp });
    }

    return cleanedUp;
  }

  /**
   * Get the count of active (non-expired) sessions
   *
   * Useful for logging during shutdown to confirm sessions are preserved.
   */
  async getActiveSessionCount(): Promise<number> {
    const state = await this.loadState();
    let activeCount = 0;

    for (const channelId of Object.keys(state.channels)) {
      const session = state.channels[channelId];
      if (!this.isSessionExpired(session)) {
        activeCount++;
      }
    }

    return activeCount;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `discord-${this.agentName}-${randomUUID()}`;
  }

  /**
   * Check if a session is expired
   */
  private isSessionExpired(session: ChannelSession): boolean {
    const lastMessageAt = new Date(session.lastMessageAt);
    const now = new Date();
    const expiryMs = this.sessionExpiryHours * 60 * 60 * 1000;
    return now.getTime() - lastMessageAt.getTime() > expiryMs;
  }

  /**
   * Load session state from disk
   *
   * Returns cached state if available, otherwise loads from file.
   * Creates initial state if file doesn't exist.
   */
  private async loadState(): Promise<DiscordSessionState> {
    if (this.state) {
      return this.state;
    }

    let content: string;
    try {
      content = await readFile(this.stateFilePath, "utf-8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      // File doesn't exist - create initial state
      if (code === "ENOENT") {
        this.state = createInitialSessionState(this.agentName);
        return this.state;
      }

      // Other read errors are fatal
      throw new SessionStateReadError(
        this.agentName,
        this.stateFilePath,
        { cause: error as Error }
      );
    }

    // Handle empty file
    if (content.trim() === "") {
      this.state = createInitialSessionState(this.agentName);
      return this.state;
    }

    // Parse YAML - treat parse errors as corrupted state
    let parsed: unknown;
    try {
      parsed = parseYaml(content);
    } catch (error) {
      this.logger.warn("Corrupted session state file, creating fresh state", {
        error: (error as Error).message,
      });
      this.state = createInitialSessionState(this.agentName);
      return this.state;
    }

    // Validate against schema - treat validation errors as corrupted state
    const validated = DiscordSessionStateSchema.safeParse(parsed);
    if (!validated.success) {
      this.logger.warn("Corrupted session state file, creating fresh state", {
        error: validated.error.message,
      });
      this.state = createInitialSessionState(this.agentName);
      return this.state;
    }

    this.state = validated.data;
    return this.state;
  }

  /**
   * Save session state to disk atomically
   */
  private async saveState(state: DiscordSessionState): Promise<void> {
    // Ensure directory exists
    await this.ensureDirectoryExists();

    // Update in-memory cache
    this.state = state;

    // Write atomically
    const yamlContent = stringifyYaml(state, { indent: 2, lineWidth: 120 });
    const tempPath = this.generateTempPath(this.stateFilePath);

    try {
      await writeFile(tempPath, yamlContent, "utf-8");
      await this.renameWithRetry(tempPath, this.stateFilePath);
    } catch (error) {
      // Clean up temp file on failure
      try {
        await unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      throw new SessionStateWriteError(
        this.agentName,
        this.stateFilePath,
        { cause: error as Error }
      );
    }
  }

  /**
   * Ensure the discord-sessions directory exists
   */
  private async ensureDirectoryExists(): Promise<void> {
    const dir = dirname(this.stateFilePath);
    try {
      await mkdir(dir, { recursive: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // EEXIST is fine - directory already exists
      if (code !== "EEXIST") {
        throw new SessionDirectoryCreateError(
          this.agentName,
          dir,
          { cause: error as Error }
        );
      }
    }
  }

  /**
   * Generate a temp file path for atomic writes
   */
  private generateTempPath(targetPath: string): string {
    const dir = dirname(targetPath);
    const random = randomBytes(8).toString("hex");
    const filename = `${this.agentName}.yaml`;
    return join(dir, `.${filename}.tmp.${random}`);
  }

  /**
   * Rename with retry logic for Windows compatibility
   */
  private async renameWithRetry(
    oldPath: string,
    newPath: string,
    maxRetries = 3,
    baseDelayMs = 50
  ): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await rename(oldPath, newPath);
        return;
      } catch (error) {
        lastError = error as Error;
        const code = (error as NodeJS.ErrnoException).code;

        // Only retry on Windows-specific errors
        if (code !== "EACCES" && code !== "EPERM") {
          throw error;
        }

        // Don't delay on the last attempt
        if (attempt < maxRetries) {
          const delay = baseDelayMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }
}
