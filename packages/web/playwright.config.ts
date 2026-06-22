import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for @herdctl/web UI/integration tests.
 *
 * These tests boot the REAL Fastify web server against a REAL @herdctl/core
 * FleetManager (per-test temp fleet) with a FAKE `claude` on PATH, then drive
 * the React dashboard in a real Chromium browser. See test-ui/harness.ts.
 *
 * Each test owns its own server (via the `harness` fixture), so the baseURL is
 * set per-test through page navigation, not here.
 */
export default defineConfig({
  testDir: "./test-ui/tests",
  // Agent runs spawn the fake claude and wait on a real session-file watcher
  // (up to 60s in core), so give chat/trigger journeys generous headroom.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Booting a FleetManager + Fastify + browser page per test is heavy; cap
  // parallelism so workers don't starve each other (which manifests as
  // page.goto timeouts under contention).
  fullyParallel: false,
  workers: 2,
  // The large SPA bundle + a long-lived WebSocket can make the `load` event
  // lag under load; give navigation a generous bound.
  use: {
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
