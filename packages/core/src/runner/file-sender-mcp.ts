/**
 * File Sender MCP Server
 *
 * Creates tool definitions for the `herdctl_send_file` tool that allows
 * agents to upload files to the originating chat channel/thread.
 *
 * Exports transport-agnostic tool definitions via `createFileSenderDef()`.
 * Each runtime handles transport conversion:
 * - SDKRuntime: in-process MCP via createSdkMcpServer() + tool()
 * - ContainerRunner: HTTP MCP bridge over Docker network
 *
 * The tool handler captures chat context (channel, thread) via closure, so the
 * agent doesn't need to know about channels or threads.
 *
 * @module file-sender-mcp
 */

import { readFile, realpath } from "node:fs/promises";
import { basename, resolve, relative } from "node:path";
import type { InjectedMcpServerDef, McpToolCallResult } from "./types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Upload result from a connector's file upload implementation
 */
export interface FileUploadResult {
  /** Platform-specific file ID (e.g., Slack file ID) */
  fileId: string;
}

/**
 * Parameters for uploading a file
 */
export interface FileUploadParams {
  /** File contents as a Buffer */
  fileBuffer: Buffer;
  /** Filename for the upload */
  filename: string;
  /** Optional message to accompany the file */
  message?: string;
  /** Optional MIME content type */
  contentType?: string;
}

/**
 * Context for routing file uploads to the originating chat channel/thread.
 *
 * Each connector (Slack, Discord, etc.) provides its own implementation of
 * `uploadFile` that uses the platform's native file upload API. The context
 * is created per-message so that channel/thread info is captured via closure.
 */
export interface FileSenderContext {
  /**
   * Upload a file to the originating channel/thread.
   * Implemented by each connector (Slack, Discord, etc.).
   */
  uploadFile: (params: FileUploadParams) => Promise<FileUploadResult>;

  /**
   * The agent's working directory on the host filesystem.
   * Used for path resolution and security validation.
   */
  workingDirectory: string;
}

// =============================================================================
// Tool Handler
// =============================================================================

/**
 * The tool handler for herdctl_send_file.
 * Shared by both in-process and HTTP bridge transports.
 */
function createToolHandler(
  context: FileSenderContext,
): (args: Record<string, unknown>) => Promise<McpToolCallResult> {
  return async (args) => {
    try {
      const filePath = args.file_path as string;

      // Resolve the file path relative to working directory
      const resolvedPath = resolve(context.workingDirectory, filePath);

      // Security: resolve symlinks before checking containment.
      // Without realpath(), a symlink inside the working directory could
      // point to an arbitrary file outside it and bypass the relative() check.
      let realPath: string;
      try {
        realPath = await realpath(resolvedPath);
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: file not found: ${filePath}`,
            },
          ],
          isError: true,
        };
      }

      const realWorkingDir = await realpath(context.workingDirectory);
      const rel = relative(realWorkingDir, realPath);
      if (rel.startsWith("..") || rel.startsWith("/")) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: file path escapes working directory: ${filePath}`,
            },
          ],
          isError: true,
        };
      }

      // Read the file
      const fileBuffer = await readFile(realPath);
      const filename = (args.filename as string) ?? basename(resolvedPath);

      // Upload via the connector
      const result = await context.uploadFile({
        fileBuffer,
        filename,
        message: args.message as string | undefined,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `File "${filename}" uploaded successfully (ID: ${result.fileId}).`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Error uploading file: ${message}` }],
        isError: true,
      };
    }
  };
}

// =============================================================================
// JSON Schema for MCP protocol
// =============================================================================

const TOOL_NAME = "herdctl_send_file";
const TOOL_DESCRIPTION =
  "Send a file from the working directory to the originating chat channel/thread. " +
  "Use this when the user asks you to share, send, or upload a file you've created. " +
  "The file must exist in your working directory.";

const TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    file_path: {
      type: "string",
      description:
        "Path to the file to send. Can be absolute or relative to the working directory.",
    },
    message: {
      type: "string",
      description: "Optional message to accompany the file upload.",
    },
    filename: {
      type: "string",
      description: "Override the filename for the upload. Defaults to the basename of file_path.",
    },
  },
  required: ["file_path"],
};

// =============================================================================
// Public API
// =============================================================================

/**
 * Create a transport-agnostic file sender definition.
 *
 * Returns an InjectedMcpServerDef with the tool handler and JSON schema.
 * Each runtime converts this to the appropriate transport:
 * - SDKRuntime: in-process MCP server
 * - ContainerRunner: HTTP MCP bridge
 *
 * @param context - File sender context with upload function and working directory
 * @returns InjectedMcpServerDef ready for the runtime pipeline
 */
export function createFileSenderDef(context: FileSenderContext): InjectedMcpServerDef {
  return {
    name: "herdctl-file-sender",
    version: "0.1.0",
    tools: [
      {
        name: TOOL_NAME,
        description: TOOL_DESCRIPTION,
        inputSchema: TOOL_INPUT_SCHEMA,
        handler: createToolHandler(context),
      },
    ],
  };
}
