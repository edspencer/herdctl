---
title: Displaying Images in Chat
description: How agents can display images inline in the web dashboard and chat interfaces
---

Agents can display images inline in chat by writing image files to their workspace and referencing them with markdown, or by using tools that return images (like Playwright's screenshot functionality). This enables visual workflows including charts, diagrams, screenshots, and other graphical outputs.

## How It Works

The herdctl system preserves `image` content blocks from both assistant messages and tool results, making them available for rendering in the web dashboard and chat interfaces. Two mechanisms enable inline images:

1. **Agent-emitted images**: Agents write image files to their workspace and emit markdown image references
2. **Tool-returned images**: Tools like `browser_take_screenshot` return image data that's automatically preserved and displayed

## Agent-Emitted Images

### Writing and Referencing Images

Agents can write images to their working directory and display them using standard markdown syntax:

```markdown
![Chart description](/files/<agent-name>/<path-to-image>)
```

The path is relative to the agent's working directory, and the markdown is rendered inline in the web dashboard's chat view.

### Example: Generating a Chart

Here's an example of an agent that generates a chart and displays it:

```yaml
name: analytics-agent
description: "Generates visual analytics reports"

runtime: cli
working_directory: ./workspace

allowed_tools:
  - Read
  - Write
  - Bash
```

The agent's workflow might look like:

1. **Generate data**: Process data and create a dataset
2. **Create visualization**: Use a charting tool to generate an image
3. **Write image file**: Save the image to the workspace
4. **Emit markdown**: Reference the image in the response

Example agent response:

```markdown
I've analyzed the sales data and generated a trend chart:

![Sales trend over the last 30 days](/files/analytics-agent/charts/sales-trend.png)

Key insights:
- Sales increased 23% week-over-week
- Peak activity occurs on Tuesdays
- Weekend sales are down 15% from weekday average
```

### Security Model

The web dashboard serves workspace files via a guarded `GET /files/:agentName/*` endpoint with comprehensive security controls:

#### Path Containment

The route enforces strict containment to prevent path traversal attacks:

- Requested paths are resolved against the agent's working directory
- Both sides are `realpath`-resolved to defeat symlink escapes
- Only files within the working directory are served
- Attempts to access `..` or absolute paths are blocked with 403 Forbidden

#### Content Security

Files are served with restrictive headers to prevent script execution:

```
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'none'; sandbox
Cache-Control: private, max-age=60
```

These headers ensure that:
- Browsers won't execute scripts from served files (even malicious SVGs)
- MIME type sniffing is disabled
- Files are cached conservatively (60 seconds)

#### File Type Support

The endpoint supports common image formats with appropriate MIME types:

| Extension | MIME Type |
|-----------|-----------|
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.webp` | `image/webp` |
| `.svg` | `image/svg+xml` |
| `.avif` | `image/avif` |
| `.bmp` | `image/bmp` |

Unknown extensions fall back to `application/octet-stream`, which triggers browser download rather than inline rendering.

## Tool-Returned Images

Some MCP tools return image data as part of their results. The most common example is Playwright's screenshot functionality.

### Playwright Screenshots

When using the Playwright MCP server, the `browser_take_screenshot` tool returns image data that's automatically preserved and displayed:

**Agent workflow:**

1. Agent uses the `browser_take_screenshot` tool
2. Tool returns image data in its result
3. herdctl preserves the image block
4. Web dashboard renders it inline

**Example usage:**

```yaml
name: web-tester
description: "Visual web testing agent"

runtime: cli
working_directory: ./workspace

mcp_servers:
  playwright:
    command: npx
    args:
      - -y
      - "@executeautomation/playwright-mcp-server"
```

The agent might say:

```
I'll take a screenshot of the homepage to check the layout.
```

Then use the tool:

```typescript
{
  tool: "browser_take_screenshot",
  parameters: {
    url: "https://example.com"
  }
}
```

The returned screenshot is automatically displayed inline in the chat, so the agent (and users viewing the chat) can see the visual result immediately.

### Supported Tool Image Formats

Tool-returned images are extracted from:

- `image` content blocks in tool result messages
- Both base64-encoded data URIs and binary image data
- Standard image MIME types (PNG, JPEG, GIF, WebP, etc.)

## Implementation Details

### Message Preservation

The system preserves image content through the message extraction pipeline:

1. **SDK messages** with `image` content blocks are preserved
2. **ChatMessage** objects include an `images` array for agent-emitted images
3. **ToolResult** objects include an `images` array for tool-returned images
4. **Web dashboard** renders both types inline in the chat view

### Storage Pattern

Agent-emitted images follow the workspace storage pattern:

```
agents/
  my-agent/
    workspace/
      charts/
        sales-trend.png          # Agent-created image
        user-distribution.png
      screenshots/
        homepage-2025-01-15.png
      diagrams/
        architecture.svg
```

Tool-returned images (like Playwright screenshots) are typically stored using the `herdctl_send_file` pattern:

```
agents/
  my-agent/
    workspace/
      .mcp-downloads/
        <uuid>/
          screenshot.png
```

## Best Practices

### For Agent Developers

1. **Use descriptive filenames**: Name files clearly so they're identifiable in the workspace
2. **Organize by type**: Create subdirectories for different image types (`charts/`, `screenshots/`, etc.)
3. **Include alt text**: Provide meaningful descriptions in markdown `![alt text](...)`
4. **Clean up old files**: Periodically remove outdated images to avoid workspace clutter
5. **Use appropriate formats**: PNG for screenshots/charts, SVG for diagrams, JPEG for photos

### For Security

1. **Trust boundary**: Remember that agent-created files are untrusted content (an agent may be induced to create malicious files)
2. **Dashboard protection**: The web dashboard's CSP headers prevent script execution from served files
3. **Direct navigation**: Navigating directly to a `/files/` URL still can't execute scripts due to the sandbox CSP
4. **Symlink safety**: The endpoint's `realpath` checks defeat symlink-based escapes

### For Performance

1. **Optimize image sizes**: Use compression and appropriate resolutions
2. **Lazy loading**: The web dashboard lazy-loads images in chat
3. **Cache headers**: Files are cached for 60 seconds to balance freshness and performance

## Example: Complete Workflow

Here's a complete example of an agent that generates and displays a chart:

**agent.yaml:**

```yaml
name: trend-analyzer
description: "Analyzes trends and generates visual reports"

runtime: cli
working_directory: ./workspace

allowed_tools:
  - Read
  - Write
  - Bash
```

**Agent workflow:**

```bash
# 1. Agent processes data (reading from a CSV file)
# 2. Agent generates a chart using a Python script
cat > chart.py << 'EOF'
import matplotlib.pyplot as plt
import pandas as pd

data = pd.read_csv('sales.csv')
plt.figure(figsize=(10, 6))
plt.plot(data['date'], data['sales'])
plt.title('Sales Trend')
plt.xlabel('Date')
plt.ylabel('Sales ($)')
plt.savefig('charts/sales-trend.png', dpi=150, bbox_inches='tight')
EOF

python chart.py
```

**Agent response:**

```markdown
I've analyzed the sales data from the past 30 days. Here's the trend:

![Sales trend over the last 30 days](/files/trend-analyzer/charts/sales-trend.png)

The chart shows a consistent upward trend with a 23% increase in sales over the period.
Key observations:
- Sales peak on Tuesdays and Wednesdays
- Weekend sales are lower but stable
- The highest single-day sales occurred on Jan 12 ($12,450)
```

The image is immediately visible in the web dashboard's chat view, providing a visual complement to the agent's text analysis.

## Related Concepts

- [Agent Configuration](/configuration/agent-config/) - Configure agent tools and permissions
- [MCP Servers](/configuration/mcp-servers/) - Add tool servers like Playwright
- [Working Directories](/concepts/agents/#working-directory) - Where agents store files
