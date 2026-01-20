/**
 * Express Web Dashboard Example
 *
 * A simple REST API and web dashboard for monitoring your fleet.
 *
 * Usage:
 *   npx tsx examples/recipes/express-dashboard.ts
 *
 * Then open http://localhost:3000 in your browser.
 *
 * API Endpoints:
 *   GET  /api/status        - Fleet status
 *   GET  /api/agents        - List all agents
 *   GET  /api/agents/:name  - Get specific agent
 *   POST /api/trigger/:agent - Trigger an agent
 *   GET  /api/events        - Recent events
 */

import express, { Request, Response, NextFunction } from "express";
import { FleetManager, isAgentNotFoundError } from "@herdctl/core";

const app = express();
app.use(express.json());

// Create and initialize FleetManager
const manager = new FleetManager({
  configPath: "./herdctl.yaml",
  stateDir: "./.herdctl",
});

// In-memory event store for recent activity
interface EventRecord {
  time: string;
  type: string;
  data: Record<string, unknown>;
}

const recentEvents: EventRecord[] = [];
const MAX_EVENTS = 100;

function recordEvent(type: string, data: Record<string, unknown>) {
  recentEvents.unshift({ time: new Date().toISOString(), type, data });
  if (recentEvents.length > MAX_EVENTS) {
    recentEvents.pop();
  }
}

// Subscribe to events
manager.on("job:created", (p) => {
  recordEvent("job:created", { jobId: p.job.id, agent: p.agentName, schedule: p.scheduleName });
});

manager.on("job:completed", (p) => {
  recordEvent("job:completed", {
    jobId: p.job.id,
    duration: p.durationSeconds,
    exitReason: p.exitReason,
  });
});

manager.on("job:failed", (p) => {
  recordEvent("job:failed", { jobId: p.job.id, error: p.error.message });
});

manager.on("job:cancelled", (p) => {
  recordEvent("job:cancelled", { jobId: p.job.id, terminationType: p.terminationType });
});

manager.on("schedule:triggered", (p) => {
  recordEvent("schedule:triggered", { agent: p.agentName, schedule: p.scheduleName });
});

manager.on("schedule:skipped", (p) => {
  recordEvent("schedule:skipped", {
    agent: p.agentName,
    schedule: p.scheduleName,
    reason: p.reason,
  });
});

manager.on("config:reloaded", (p) => {
  recordEvent("config:reloaded", { agentCount: p.agentCount, changes: p.changes });
});

// Error handler middleware
function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// API Routes
app.get(
  "/api/status",
  asyncHandler(async (req, res) => {
    const status = await manager.getFleetStatus();
    res.json(status);
  })
);

app.get(
  "/api/agents",
  asyncHandler(async (req, res) => {
    const agents = await manager.getAgentInfo();
    res.json(agents);
  })
);

app.get(
  "/api/agents/:name",
  asyncHandler(async (req, res) => {
    try {
      const agent = await manager.getAgentInfoByName(req.params.name);
      res.json(agent);
    } catch (error) {
      if (isAgentNotFoundError(error)) {
        res.status(404).json({
          error: `Agent not found: ${error.agentName}`,
          availableAgents: error.availableAgents,
        });
      } else {
        throw error;
      }
    }
  })
);

app.post(
  "/api/trigger/:agent",
  asyncHandler(async (req, res) => {
    try {
      const { schedule, prompt, force } = req.body as {
        schedule?: string;
        prompt?: string;
        force?: boolean;
      };
      const result = await manager.trigger(req.params.agent, schedule, {
        prompt,
        bypassConcurrencyLimit: force,
      });
      res.json(result);
    } catch (error) {
      if (isAgentNotFoundError(error)) {
        res.status(404).json({
          error: `Agent not found: ${error.agentName}`,
          availableAgents: error.availableAgents,
        });
      } else {
        throw error;
      }
    }
  })
);

app.get("/api/events", (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit) || "50", 10), MAX_EVENTS);
  res.json(recentEvents.slice(0, limit));
});

// Reload configuration endpoint
app.post(
  "/api/reload",
  asyncHandler(async (req, res) => {
    await manager.reload();
    res.json({ success: true, agentCount: manager.state.agentCount });
  })
);

// Simple HTML dashboard
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Fleet Dashboard</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 1000px;
      margin: 0 auto;
      padding: 1rem;
      background: #f5f5f5;
      color: #333;
    }
    h1 { color: #111; margin-bottom: 1.5rem; }
    h2 { color: #333; margin: 1.5rem 0 1rem; font-size: 1.25rem; }
    .card {
      background: white;
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 1rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .status-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 1rem;
    }
    .stat {
      text-align: center;
      padding: 0.5rem;
    }
    .stat-value {
      font-size: 2rem;
      font-weight: bold;
      color: #0066cc;
    }
    .stat-label {
      font-size: 0.875rem;
      color: #666;
    }
    .agent-card {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem;
      border-bottom: 1px solid #eee;
    }
    .agent-card:last-child { border-bottom: none; }
    .agent-name { font-weight: 600; }
    .agent-status {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      text-transform: uppercase;
    }
    .status-idle { background: #e0e0e0; color: #666; }
    .status-running { background: #c8e6c9; color: #2e7d32; }
    .status-error { background: #ffcdd2; color: #c62828; }
    button {
      padding: 0.5rem 1rem;
      background: #0066cc;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.875rem;
    }
    button:hover { background: #0052a3; }
    button:disabled { background: #ccc; cursor: not-allowed; }
    .event-list {
      max-height: 300px;
      overflow-y: auto;
    }
    .event {
      padding: 0.5rem;
      border-bottom: 1px solid #eee;
      font-size: 0.875rem;
    }
    .event:last-child { border-bottom: none; }
    .event-time { color: #666; font-size: 0.75rem; }
    .event-type { font-weight: 600; margin-left: 0.5rem; }
    .event-type.job\\:completed { color: #2e7d32; }
    .event-type.job\\:failed { color: #c62828; }
    .event-type.job\\:created { color: #0066cc; }
    .refresh-btn { margin-left: 1rem; font-size: 0.75rem; padding: 0.25rem 0.5rem; }
    .error { color: #c62828; padding: 1rem; background: #ffebee; border-radius: 4px; }
    .loading { color: #666; font-style: italic; }
  </style>
</head>
<body>
  <h1>Fleet Dashboard</h1>

  <div id="status-container" class="card">
    <div class="loading">Loading status...</div>
  </div>

  <h2>Agents <button class="refresh-btn" onclick="refresh()">Refresh</button></h2>
  <div id="agents-container" class="card">
    <div class="loading">Loading agents...</div>
  </div>

  <h2>Recent Events</h2>
  <div id="events-container" class="card event-list">
    <div class="loading">Loading events...</div>
  </div>

  <script>
    async function fetchJSON(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    function formatTime(iso) {
      return new Date(iso).toLocaleTimeString();
    }

    async function loadStatus() {
      try {
        const status = await fetchJSON('/api/status');
        document.getElementById('status-container').innerHTML = \`
          <div class="status-grid">
            <div class="stat">
              <div class="stat-value">\${status.state}</div>
              <div class="stat-label">State</div>
            </div>
            <div class="stat">
              <div class="stat-value">\${status.counts.totalAgents}</div>
              <div class="stat-label">Agents</div>
            </div>
            <div class="stat">
              <div class="stat-value">\${status.counts.runningJobs}</div>
              <div class="stat-label">Running Jobs</div>
            </div>
            <div class="stat">
              <div class="stat-value">\${status.counts.totalSchedules}</div>
              <div class="stat-label">Schedules</div>
            </div>
            <div class="stat">
              <div class="stat-value">\${status.scheduler.triggerCount}</div>
              <div class="stat-label">Triggers</div>
            </div>
          </div>
        \`;
      } catch (err) {
        document.getElementById('status-container').innerHTML =
          '<div class="error">Error loading status: ' + err.message + '</div>';
      }
    }

    async function loadAgents() {
      try {
        const agents = await fetchJSON('/api/agents');
        if (agents.length === 0) {
          document.getElementById('agents-container').innerHTML =
            '<p>No agents configured.</p>';
          return;
        }
        document.getElementById('agents-container').innerHTML = agents.map(a => \`
          <div class="agent-card">
            <div>
              <span class="agent-name">\${a.name}</span>
              <span class="agent-status status-\${a.status}">\${a.status}</span>
              <small style="color:#666"> (\${a.runningCount}/\${a.maxConcurrent})</small>
            </div>
            <button onclick="triggerAgent('\${a.name}')" \${a.status === 'running' && a.runningCount >= a.maxConcurrent ? 'disabled' : ''}>
              Trigger
            </button>
          </div>
        \`).join('');
      } catch (err) {
        document.getElementById('agents-container').innerHTML =
          '<div class="error">Error loading agents: ' + err.message + '</div>';
      }
    }

    async function loadEvents() {
      try {
        const events = await fetchJSON('/api/events?limit=20');
        if (events.length === 0) {
          document.getElementById('events-container').innerHTML =
            '<p style="color:#666">No recent events.</p>';
          return;
        }
        document.getElementById('events-container').innerHTML = events.map(e => \`
          <div class="event">
            <span class="event-time">\${formatTime(e.time)}</span>
            <span class="event-type \${e.type}">\${e.type}</span>
            <span style="color:#666">\${JSON.stringify(e.data)}</span>
          </div>
        \`).join('');
      } catch (err) {
        document.getElementById('events-container').innerHTML =
          '<div class="error">Error loading events: ' + err.message + '</div>';
      }
    }

    async function triggerAgent(name) {
      try {
        const res = await fetch('/api/trigger/' + name, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        });
        const result = await res.json();
        if (res.ok) {
          alert('Job started: ' + result.jobId);
        } else {
          alert('Error: ' + result.error);
        }
        refresh();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }

    function refresh() {
      loadStatus();
      loadAgents();
      loadEvents();
    }

    // Initial load
    refresh();

    // Auto-refresh every 5 seconds
    setInterval(refresh, 5000);
  </script>
</body>
</html>
  `);
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("Server error:", err);
  res.status(500).json({ error: err.message });
});

// Start server
async function start() {
  await manager.initialize();
  await manager.start();

  const port = parseInt(process.env.PORT || "3000", 10);

  app.listen(port, () => {
    console.log(`\n=== Fleet Dashboard ===`);
    console.log(`Server running at http://localhost:${port}`);
    console.log(`\nAPI Endpoints:`);
    console.log(`  GET  /api/status        - Fleet status`);
    console.log(`  GET  /api/agents        - List all agents`);
    console.log(`  GET  /api/agents/:name  - Get specific agent`);
    console.log(`  POST /api/trigger/:agent - Trigger an agent`);
    console.log(`  POST /api/reload        - Reload configuration`);
    console.log(`  GET  /api/events        - Recent events`);
    console.log(`\nPress Ctrl+C to stop.\n`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    await manager.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
