import { expect, test } from "../fixtures.js";

/**
 * Agent detail page journeys: header, tab navigation (Overview / Chats / Jobs /
 * Output), and the not-found state for unknown agents.
 */

test.describe("Agent detail", () => {
  test.use({
    harnessOptions: {
      agents: [
        {
          name: "inspector",
          description: "Inspects things",
          extraYaml: [
            "schedules:",
            "  hourly:",
            "    type: interval",
            "    interval: 1h",
            '    prompt: "Inspect"',
          ].join("\n"),
        },
      ],
    },
  });

  test("renders the agent header and default Overview tab", async ({ page, harness }) => {
    await page.goto(`${harness.baseUrl}/agents/inspector`);

    // Back link to dashboard.
    await expect(page.getByRole("link", { name: "Back to Dashboard" })).toBeVisible();

    const main = page.locator("main");
    await expect(main.getByRole("link", { name: "Overview" })).toBeVisible();
    await expect(main.getByRole("link", { name: "Chats" })).toBeVisible();
    await expect(main.getByRole("link", { name: "Jobs" })).toBeVisible();
    await expect(main.getByRole("link", { name: "Output" })).toBeVisible();
  });

  test("switching to the Jobs tab updates the URL and shows the jobs view", async ({
    page,
    harness,
  }) => {
    await page.goto(`${harness.baseUrl}/agents/inspector`);

    await page.locator("main").getByRole("link", { name: "Jobs" }).click();
    await expect(page).toHaveURL(/\/agents\/inspector\/jobs/);
  });

  // Regression test for the fix to edspencer/herdctl#268: a 404 for an unknown
  // agent must render the dedicated "Agent Not Found" card, not the generic
  // error panel with a misleading "Retry" button.
  test("shows a not-found card for an unknown agent", async ({ page, harness }) => {
    await page.goto(`${harness.baseUrl}/agents/does-not-exist`);

    await expect(page.getByRole("heading", { name: "Agent Not Found" })).toBeVisible();
    await expect(page.getByText(/No agent named "does-not-exist" exists/)).toBeVisible();
    // The misleading retryable error state must NOT be shown for a 404.
    await expect(page.locator("main").getByRole("button", { name: "Retry" })).toHaveCount(0);
  });
});
