import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures.js";
import type { Harness } from "../harness.js";

/**
 * Session-list (All Chats) journeys and error/empty states across the app.
 */

/**
 * Run one agent turn via REST, wait for it to finish, and wait for the server's
 * session discovery to surface the resulting transcript in /api/chat/all.
 *
 * Both waits matter. The All Chats page fetches once on mount, so a test that
 * navigates before discovery has caught up renders the base empty state and
 * never recovers. The old spec instead waited on the text "talker", which also
 * appears in the layout sidebar — a match that proves nothing about the session
 * list and let the test proceed too early (herdctl#275).
 */
async function seedCompletedSession(page: Page, harness: Harness): Promise<void> {
  const res = await page.request.post(`${harness.baseUrl}/api/agents/talker/trigger`, {
    data: { prompt: "First message", triggerType: "web" },
  });
  expect(res.ok()).toBeTruthy();

  await expect
    .poll(
      async () => {
        const jobs = await (await page.request.get(`${harness.baseUrl}/api/jobs`)).json();
        return jobs.jobs?.[0]?.status;
      },
      { timeout: 80_000, intervals: [1000] },
    )
    .toBe("completed");

  await expect
    .poll(
      async () => {
        const res = await page.request.get(`${harness.baseUrl}/api/chat/all?limit=200`);
        const all = await res.json();
        // Compare on encodedPath: it is the exact key core groups by, whereas
        // workingDirectory is a lossy decode of it.
        return (all.groups ?? []).some(
          (g: { encodedPath: string }) => g.encodedPath === harness.agentEncodedPath("talker"),
        );
      },
      { timeout: 30_000, intervals: [500] },
    )
    .toBe(true);
}

test.describe("All Chats session list", () => {
  test.use({
    harnessOptions: {
      agents: [{ name: "talker", description: "Has conversations" }],
      fakeScript: { "First message": "First reply from the agent." },
    },
  });

  test("a completed chat appears in the All Chats directory listing", async ({ page, harness }) => {
    await seedCompletedSession(page, harness);

    await page.goto(`${harness.baseUrl}/chats`);
    await expect(page.getByRole("heading", { name: "All Chats" })).toBeVisible();
    // Assert on the group's working directory, not the agent name: "talker"
    // also renders in the layout sidebar, so matching it proves nothing about
    // the All Chats list. The temp workdir is unique to this harness.
    await expect(page.getByText(harness.agentDisplayWorkdir("talker"))).toBeVisible({
      timeout: 20_000,
    });
  });

  // /chats is machine-wide (it discovers every Claude Code session under
  // ~/.claude, not just this fleet's), so we can't assert a global empty state.
  // Create one session first so the directory is non-empty in ANY environment (a
  // fresh CI runner has no prior ~/.claude sessions, so without this the page
  // shows its base empty state rather than the search "no results" state), then
  // assert the deterministic "no search results" state for an impossible query.
  test("renders the All Chats page and a no-results state for an impossible query", async ({
    page,
    harness,
  }) => {
    // One seeded group is enough for a deterministic result: a group matching
    // neither its path/agent nor any of its sessions is now dropped entirely,
    // so the single top-level state renders regardless of how many other
    // session groups the host machine happens to have (herdctl#275).
    await seedCompletedSession(page, harness);

    await page.goto(`${harness.baseUrl}/chats`);

    await expect(page.getByRole("heading", { name: "All Chats" })).toBeVisible();
    await expect(page.getByText("Every Claude Code session on this machine")).toBeVisible();
    await expect(page.getByText(harness.agentDisplayWorkdir("talker"))).toBeVisible({
      timeout: 20_000,
    });

    await page
      .getByPlaceholder(/Search sessions/)
      .fill("zzz-no-such-session-qqq-impossible-match-xyz");
    await expect(page.getByText("No matching sessions")).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("API error surfacing", () => {
  test.use({ harnessOptions: { agents: [{ name: "any", description: "an agent" }] } });

  test("the schedules page surfaces a server error in an inline banner", async ({
    page,
    harness,
  }) => {
    // Force the schedules API to 500 for this page load.
    await page.route("**/api/schedules", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Scheduler exploded", statusCode: 500 }),
      }),
    );

    await page.goto(`${harness.baseUrl}/schedules`);
    await expect(page.getByText("Scheduler exploded")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("the dashboard still renders its shell when the agents API fails", async ({
    page,
    harness,
  }) => {
    await page.route("**/api/agents", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "agents down", statusCode: 500 }),
      }),
    );

    await page.goto(harness.baseUrl);
    // The layout shell (sidebar nav) renders even when the agents fetch fails.
    await expect(page.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
  });
});
