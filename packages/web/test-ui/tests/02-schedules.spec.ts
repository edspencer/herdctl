import { expect, test } from "../fixtures.js";

/**
 * Schedules page journeys: the schedule table renders real schedules from the
 * FleetManager, and the enable/disable/trigger actions hit the real REST API
 * and reflect back in the UI.
 */

const cronSchedule = [
  "schedules:",
  "  nightly:",
  "    type: cron",
  '    cron: "0 9 * * *"',
  '    prompt: "Do the nightly run"',
].join("\n");

const intervalSchedule = [
  "schedules:",
  "  poller:",
  "    type: interval",
  "    interval: 6h",
  '    prompt: "Poll for work"',
].join("\n");

test.describe("Schedules page", () => {
  test.use({
    harnessOptions: {
      agents: [
        { name: "nightowl", description: "Runs on a cron", extraYaml: cronSchedule },
        { name: "poller", description: "Runs on an interval", extraYaml: intervalSchedule },
      ],
    },
  });

  test("lists schedules across all agents with type and expression", async ({ page, harness }) => {
    await page.goto(`${harness.baseUrl}/schedules`);

    await expect(page.getByRole("heading", { name: "All Schedules" })).toBeVisible();

    const nightlyRow = page.locator("tr", { hasText: "nightly" });
    await expect(nightlyRow).toBeVisible();
    await expect(nightlyRow.getByText("Cron")).toBeVisible();
    await expect(nightlyRow.getByText("0 9 * * *")).toBeVisible();

    const pollerRow = page.locator("tr", { hasText: "poller" });
    await expect(pollerRow).toBeVisible();
    await expect(pollerRow.getByText("Interval")).toBeVisible();
    await expect(pollerRow.getByText("6h")).toBeVisible();
  });

  test("disabling a schedule flips its status to disabled and offers enable", async ({
    page,
    harness,
  }) => {
    await page.goto(`${harness.baseUrl}/schedules`);

    const nightlyRow = page.locator("tr", { hasText: "nightly" });
    await expect(nightlyRow).toBeVisible();

    // Disable it.
    await nightlyRow.getByRole("button", { name: "Disable schedule" }).click();

    // Status badge in the row should now read "disabled", and the enable
    // affordance should appear (the action toggles from Disable to Enable).
    await expect(nightlyRow.getByText(/disabled/i)).toBeVisible();
    await expect(nightlyRow.getByRole("button", { name: "Enable schedule" })).toBeVisible();

    // Re-enable it.
    await nightlyRow.getByRole("button", { name: "Enable schedule" }).click();
    await expect(nightlyRow.getByRole("button", { name: "Disable schedule" })).toBeVisible();
  });

  test("triggering a schedule from the table starts a real job", async ({ page, harness }) => {
    await page.goto(`${harness.baseUrl}/schedules`);

    const nightlyRow = page.locator("tr", { hasText: "nightly" });
    await nightlyRow.getByRole("button", { name: "Trigger" }).click();

    // The trigger fires a real job (fake claude). It surfaces as a toast
    // ("Job completed for ...") once the run finishes.
    await expect(page.getByText(/Job completed for/)).toBeVisible({ timeout: 80_000 });
  });
});

test.describe("Schedules empty state", () => {
  test.use({
    harnessOptions: {
      agents: [{ name: "scheduleless", description: "Has no schedules" }],
    },
  });

  test("shows the no-schedules empty state", async ({ page, harness }) => {
    await page.goto(`${harness.baseUrl}/schedules`);
    await expect(page.getByText("No schedules configured")).toBeVisible();
  });
});
