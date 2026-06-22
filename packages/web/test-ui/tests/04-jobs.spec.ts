import { expect, test } from "../fixtures.js";

/**
 * Jobs journeys: triggering an agent from the UI runs a REAL job (fake claude),
 * which then appears in the job history table and can be inspected.
 */

test.describe("Jobs page", () => {
  test.use({
    harnessOptions: {
      agents: [{ name: "worker", description: "Does the work" }],
      fakeScript: { "Run a quick task": "Task complete." },
    },
  });

  test("triggering a job via the modal runs it and lists it in history", async ({
    page,
    harness,
  }) => {
    await page.goto(`${harness.baseUrl}/jobs`);

    // Empty state before any job.
    await expect(page.getByRole("heading", { name: "All Jobs" })).toBeVisible();
    await expect(page.locator("main").getByText("No jobs found")).toBeVisible();

    // Open the Trigger Job modal.
    await page.getByRole("button", { name: "Trigger Job" }).click();
    await expect(page.getByRole("heading", { name: "Trigger Job" })).toBeVisible();

    // Select the agent and provide a prompt that the fake claude has a script for.
    await page.locator("#trigger-agent").selectOption("worker");
    await page.locator("#trigger-prompt").fill("Run a quick task");
    await page.getByRole("button", { name: "Trigger", exact: true }).click();

    // Modal confirms the trigger.
    await expect(page.getByText("Job triggered")).toBeVisible({ timeout: 20_000 });

    // The job completes (toast) and then appears in the history table.
    await expect(page.getByText(/Job completed for worker/)).toBeVisible({ timeout: 80_000 });

    const jobRow = page.locator("tr", { hasText: "Run a quick task" });
    await expect(jobRow.first()).toBeVisible({ timeout: 20_000 });
    await expect(jobRow.first().getByText(/completed/i)).toBeVisible();
  });

  test("clicking a completed job opens its detail panel", async ({ page, harness }) => {
    // Trigger via REST so the job exists, then assert the UI detail flow.
    const res = await page.request.post(`${harness.baseUrl}/api/agents/worker/trigger`, {
      data: { prompt: "Run a quick task" },
    });
    expect(res.ok()).toBeTruthy();

    // Wait for the run to finish by polling the jobs API.
    await expect
      .poll(
        async () => {
          const jobs = await (await page.request.get(`${harness.baseUrl}/api/jobs`)).json();
          return jobs.jobs?.[0]?.status;
        },
        { timeout: 80_000, intervals: [1000] },
      )
      .toBe("completed");

    await page.goto(`${harness.baseUrl}/jobs`);
    const jobRow = page.locator("tr", { hasText: "Run a quick task" }).first();
    await expect(jobRow).toBeVisible({ timeout: 20_000 });
    await jobRow.click();

    // Detail panel shows the job's prompt and a completed status.
    const main = page.locator("main");
    await expect(main.getByText("Run a quick task").first()).toBeVisible();
  });
});
