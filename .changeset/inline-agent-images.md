---
"@herdctl/core": minor
"@herdctl/chat": minor
"@herdctl/web": minor
---

Preserve non-text image content blocks and serve workspace files for inline image display

Two complementary changes that together enable inline display of agent-produced and MCP-tool-returned images in a consuming web UI:

- **`@herdctl/core` / `@herdctl/chat` (#385):** message extraction and the SDK message translator no longer silently drop non-text content blocks when flattening a result to a plain string. Image blocks an agent emits inline, or that an MCP tool returns (e.g. a Playwright `browser_take_screenshot`), are now preserved. New `ExtractedImage` type and `normalizeImageBlock` / `isImageContentBlock` / `imageToDataUrl` helpers; `ToolResult.images` and `TranslatedToolCall.images` carry tool-returned images; `extractImageBlocks` / `hasImageContent` surface agent-emitted images and a new `onImages` translator handler exposes them. The text-only fallback is unchanged for consumers that don't handle images.

- **`@herdctl/web` (#386):** new guarded `GET /files/:agentName/*` route serves files from an agent's resolved working directory, with `realpath` containment protection against `..` traversal and symlink escapes. An agent can write an image into its working directory and emit markdown `![](/files/<agent>/<path>)`, which the dashboard's `MarkdownRenderer` now renders inline. Adds `FleetManager.getAgentWorkingDirectory(name)`.
