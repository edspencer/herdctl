/**
 * Workspace file-serving route
 *
 * Serves files from an agent's resolved working directory over HTTP so that
 * agent-produced images (or any file written into the working directory) can be
 * displayed inline in the dashboard — an agent writes an image into its working
 * directory and emits markdown `![](/files/<agent>/<path>)`, which the
 * `MarkdownRenderer` renders via react-markdown's default `<img>`.
 *
 * Security posture: the route is GUARDED. The requested path is resolved
 * against the agent's working directory and both sides are `realpath`-resolved
 * before a containment check, so `..` traversal and symlink escapes cannot read
 * files outside the working directory. Only regular files are served. This
 * mirrors the storage posture of the `herdctl_send_file` / Discord attachment
 * layout (`<workingDir>/<download_dir>/<uuid>/…`).
 */

import { type FileHandle, open, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { createLogger, type FleetManager, isAgentNotFoundError } from "@herdctl/core";
import type { FastifyInstance } from "fastify";

const logger = createLogger("web:files");

/**
 * Minimal extension → MIME type map. Focused on the image types this route
 * exists to serve, plus a few common companions. Unknown extensions fall back
 * to `application/octet-stream` (the browser will download rather than render).
 */
const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Resolve a Content-Type for a file path from its extension.
 */
export function contentTypeForPath(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Whether a decoded relative path is structurally safe to resolve — no absolute
 * paths and no `..` segments. This is a cheap pre-check before touching disk;
 * the authoritative guard is the post-`realpath` containment check.
 */
function isStructurallySafe(relPath: string): boolean {
  if (isAbsolute(relPath)) return false;
  // Split on both separators so a `..` segment is caught on any platform.
  return !relPath.split(/[\\/]/).some((segment) => segment === "..");
}

/**
 * Register the workspace file-serving route.
 *
 * @param server - Fastify instance
 * @param fleetManager - FleetManager used to resolve an agent's working directory
 */
export function registerFileRoutes(server: FastifyInstance, fleetManager: FleetManager): void {
  /**
   * GET /files/:agentName/*
   *
   * Serves the file at the wildcard path, resolved relative to the named
   * agent's working directory. Returns:
   * - 200 with the file stream (and an inferred Content-Type),
   * - 400 for an undecodable path,
   * - 403 when the path escapes the working directory,
   * - 404 when the agent, working directory, or file does not exist,
   * - 500 for unexpected resolution errors.
   */
  server.get<{ Params: { agentName: string; "*": string } }>(
    "/files/:agentName/*",
    async (request, reply) => {
      const { agentName } = request.params;
      const wildcard = request.params["*"] ?? "";

      // Resolve the agent's working directory. Unknown agents → 404.
      let workingDir: string | undefined;
      try {
        workingDir = fleetManager.getAgentWorkingDirectory(agentName);
      } catch (error) {
        // Use the exported type guard rather than string-matching the message,
        // so only a genuine unknown-agent error maps to 404.
        if (isAgentNotFoundError(error)) {
          return reply.status(404).send({ error: error.message, statusCode: 404 });
        }
        const message = error instanceof Error ? error.message : String(error);
        return reply
          .status(500)
          .send({ error: `Failed to resolve agent: ${message}`, statusCode: 500 });
      }

      if (!workingDir) {
        return reply.status(404).send({
          error: `Agent has no working directory: ${agentName}`,
          statusCode: 404,
        });
      }

      // Decode the wildcard path (Fastify leaves it percent-encoded).
      let relPath: string;
      try {
        relPath = decodeURIComponent(wildcard);
      } catch {
        return reply.status(400).send({ error: "Invalid file path encoding", statusCode: 400 });
      }

      if (!relPath) {
        return reply.status(404).send({ error: "No file specified", statusCode: 404 });
      }

      // Cheap structural reject before hitting the filesystem.
      if (!isStructurallySafe(relPath)) {
        return reply.status(403).send({
          error: "Forbidden: path escapes working directory",
          statusCode: 403,
        });
      }

      const resolved = resolve(workingDir, relPath);

      // Authoritative guard: realpath both sides (defeating symlink escapes),
      // then require the target to live inside the working directory.
      let realWorkingDir: string;
      try {
        realWorkingDir = await realpath(workingDir);
      } catch {
        return reply.status(404).send({ error: "Working directory not found", statusCode: 404 });
      }

      let realPath: string;
      try {
        realPath = await realpath(resolved);
      } catch {
        return reply.status(404).send({ error: "File not found", statusCode: 404 });
      }

      const rel = relative(realWorkingDir, realPath);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        logger.warn("Blocked path traversal attempt", { agentName, relPath });
        return reply.status(403).send({
          error: "Forbidden: path escapes working directory",
          statusCode: 403,
        });
      }

      // Open the verified canonical path ONCE, then fstat and stream from that
      // same fd. Re-touching the path string with a separate stat + read would
      // leave a TOCTOU window where a symlink under the working directory could
      // be swapped between the containment check and the read; binding to one
      // fd closes it and honors this route's containment guarantee.
      let handle: FileHandle;
      try {
        handle = await open(realPath, "r");
      } catch {
        return reply.status(404).send({ error: "File not found", statusCode: 404 });
      }

      let stats: Awaited<ReturnType<FileHandle["stat"]>>;
      try {
        stats = await handle.stat();
      } catch {
        await handle.close();
        return reply.status(404).send({ error: "File not found", statusCode: 404 });
      }
      if (!stats.isFile()) {
        await handle.close();
        return reply.status(404).send({ error: "Not a file", statusCode: 404 });
      }

      reply.header("Content-Length", stats.size);
      // Files can change between runs; keep caching conservative.
      reply.header("Cache-Control", "private, max-age=60");
      // These files live on the dashboard's origin and can be agent-produced
      // (untrusted — an agent may be induced to write e.g. an SVG containing
      // <script>). Neutralize script execution from a served file and MIME
      // sniffing so navigating directly to a served URL can't run code in the
      // dashboard origin (react-markdown's <img> already won't, but a direct
      // link/navigation would).
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
      reply.type(contentTypeForPath(realPath));
      // The stream owns the fd and closes it when the response finishes/aborts.
      return reply.send(handle.createReadStream());
    },
  );
}
