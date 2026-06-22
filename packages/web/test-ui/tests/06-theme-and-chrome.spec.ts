import { expect, test } from "../fixtures.js";

/**
 * App chrome journeys: dark/light/system theme toggle (persisted to
 * localStorage + applied as the `dark` class on <html>), the version footer,
 * and the SPA serving / deep-link refresh behaviour.
 */

test.describe("Theme toggle", () => {
  test.use({ harnessOptions: { agents: [{ name: "any", description: "an agent" }] } });

  test("switching to dark mode adds the dark class and persists it", async ({ page, harness }) => {
    await page.goto(harness.baseUrl);

    const html = page.locator("html");

    // Force a known starting point.
    await page.getByRole("button", { name: "Light mode" }).click();
    await expect(html).not.toHaveClass(/dark/);

    // Switch to dark.
    await page.getByRole("button", { name: "Dark mode" }).click();
    await expect(html).toHaveClass(/dark/);

    // Persisted preference.
    const stored = await page.evaluate(() => localStorage.getItem("herd-theme"));
    expect(stored).toBe("dark");

    // Survives a reload.
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("switching back to light mode removes the dark class", async ({ page, harness }) => {
    await page.goto(harness.baseUrl);
    await page.getByRole("button", { name: "Dark mode" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.getByRole("button", { name: "Light mode" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });
});

test.describe("SPA + version chrome", () => {
  test.use({ harnessOptions: { agents: [{ name: "any", description: "an agent" }] } });

  test("deep-linking to a route and refreshing serves the SPA (no 404)", async ({
    page,
    harness,
  }) => {
    // Hit a client route directly — the server SPA fallback must serve index.html.
    const response = await page.goto(`${harness.baseUrl}/schedules`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "All Schedules" })).toBeVisible();
  });

  test("the version endpoint reports a real web version in the sidebar footer", async ({
    page,
    harness,
  }) => {
    await page.goto(harness.baseUrl);
    // Sidebar footer renders "herdctl vX ... core vY ... web vZ".
    await expect(page.getByText(/web v\d+\.\d+\.\d+/)).toBeVisible();
  });
});
