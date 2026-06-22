import { expect, test } from "../fixtures.js";

/**
 * Session-list (All Chats) journeys and error/empty states across the app.
 */

test.describe("All Chats session list", () => {
  test.use({
    harnessOptions: {
      agents: [{ name: "talker", description: "Has conversations" }],
      fakeScript: { "First message": "First reply from the agent." },
    },
  });

  test("a completed chat appears in the All Chats directory listing", async ({ page, harness }) => {
    // Run one chat turn via REST so a transcript exists on disk.
    const res = await page.request.post(`${harness.baseUrl}/api/agents/talker/trigger`, {
      data: { prompt: "First message", triggerType: "web" },
    });
    expect(res.ok()).toBeTruthy();

    // Wait for the job to complete.
    await expect
      .poll(
        async () => {
          const jobs = await (await page.request.get(`${harness.baseUrl}/api/jobs`)).json();
          return jobs.jobs?.[0]?.status;
        },
        { timeout: 80_000, intervals: [1000] },
      )
      .toBe("completed");

    await page.goto(`${harness.baseUrl}/chats`);
    await expect(page.getByRole("heading", { name: "All Chats" })).toBeVisible();
    // The agent's working directory group should be listed (it contains the
    // session we just created). The agent name surfaces in the group header.
    await expect(page.getByText("talker").first()).toBeVisible({ timeout: 20_000 });
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
    const trigger = await page.request.post(`${harness.baseUrl}/api/agents/talker/trigger`, {
      data: { prompt: "First message", triggerType: "web" },
    });
    expect(trigger.ok()).toBeTruthy();
    await expect
      .poll(
        async () => {
          const jobs = await (await page.request.get(`${harness.baseUrl}/api/jobs`)).json();
          return jobs.jobs?.[0]?.status;
        },
        { timeout: 80_000, intervals: [1000] },
      )
      .toBe("completed");

    await page.goto(`${harness.baseUrl}/chats`);

    await expect(page.getByRole("heading", { name: "All Chats" })).toBeVisible();
    await expect(page.getByText("Every Claude Code session on this machine")).toBeVisible();
    // Wait for the seeded session's group to LOAD before searching — otherwise the
    // filter applies to a still-empty list (groups.length === 0 → base EmptyState,
    // not the search "No matching sessions" state). The agent name heads its group.
    await expect(page.getByText("talker").first()).toBeVisible({ timeout: 20_000 });

    await page
      .getByPlaceholder(/Search sessions/)
      .fill("zzz-no-such-session-qqq-impossible-match-xyz");
    // Accept either no-results form: the top-level "No matching sessions" (when
    // all groups filter out) or a group's "No sessions match your search" (when a
    // single group remains with no matching sessions). See herdctl#275.
    await expect(
      page.getByText(/No matching sessions|No sessions match your search/).first(),
    ).toBeVisible({ timeout: 20_000 });
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
