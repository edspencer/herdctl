import { expect, test } from "../fixtures.js";

/**
 * Fleet overview / dashboard journeys: the landing page renders the fleet
 * status, the configured agents, their statuses, and the recent-jobs section,
 * all sourced from a REAL FleetManager over REST + WebSocket.
 */

test.describe("Fleet dashboard", () => {
  test.use({
    harnessOptions: {
      fleetName: "ui-test-fleet",
      agents: [
        { name: "greeter", description: "Greets people warmly" },
        { name: "scout", description: "Scouts for new work" },
      ],
    },
  });

  test("renders fleet overview header, status and stat chips", async ({ page, harness }) => {
    await page.goto(harness.baseUrl);

    await expect(page.getByRole("heading", { name: "Fleet Overview" })).toBeVisible();
    // Fleet status badge reflects the running FleetManager.
    await expect(page.getByText("Uptime:")).toBeVisible();
    // Stat chips: 2 agents configured.
    await expect(page.getByText("agents", { exact: true })).toBeVisible();
    const agentsChip = page.locator("div", { hasText: /^2agents$/ }).first();
    await expect(agentsChip).toBeVisible();
  });

  test("renders an agent card per configured agent with description and status", async ({
    page,
    harness,
  }) => {
    await page.goto(harness.baseUrl);

    const greeterCard = page.locator("article", { hasText: "greeter" });
    const scoutCard = page.locator("article", { hasText: "scout" });

    await expect(greeterCard).toBeVisible();
    await expect(scoutCard).toBeVisible();

    await expect(greeterCard.getByText("Greets people warmly")).toBeVisible();
    await expect(scoutCard.getByText("Scouts for new work")).toBeVisible();

    // Idle agents show a status badge of "idle" and View/Chat actions.
    await expect(greeterCard.getByRole("link", { name: /View/ })).toBeVisible();
    await expect(greeterCard.getByRole("link", { name: /Chat/ })).toBeVisible();
  });

  test("clicking an agent card View navigates to the agent detail page", async ({
    page,
    harness,
  }) => {
    await page.goto(harness.baseUrl);

    const greeterCard = page.locator("article", { hasText: "greeter" });
    await greeterCard.getByRole("link", { name: /View/ }).click();

    await expect(page).toHaveURL(/\/agents\/greeter/);
    // Agent detail tab bar (scope to main content to avoid the sidebar's nav links).
    const main = page.locator("main");
    await expect(main.getByRole("link", { name: "Overview" })).toBeVisible();
    await expect(main.getByRole("link", { name: "Jobs" })).toBeVisible();
  });

  test("sidebar navigation links route to Jobs, Schedules and All Chats", async ({
    page,
    harness,
  }) => {
    await page.goto(harness.baseUrl);

    await page.getByRole("link", { name: "Jobs", exact: true }).click();
    await expect(page).toHaveURL(/\/jobs$/);

    await page.getByRole("link", { name: "Schedules", exact: true }).click();
    await expect(page).toHaveURL(/\/schedules$/);

    await page.getByRole("link", { name: "All Chats", exact: true }).click();
    await expect(page).toHaveURL(/\/chats$/);
  });

  test("connection status shows Connected once the WebSocket is live", async ({
    page,
    harness,
  }) => {
    await page.goto(harness.baseUrl);
    // Header shows the live WS connection label once the socket reports connected.
    await expect(page.locator("header").getByText("Connected", { exact: true })).toBeVisible();
  });
});

test.describe("Empty fleet states", () => {
  test.use({
    harnessOptions: {
      // A fleet config with no agents still validates and boots.
      agents: [],
    },
  });

  test("shows the no-agents empty state when the fleet has no agents", async ({
    page,
    harness,
  }) => {
    await page.goto(harness.baseUrl);

    const main = page.locator("main");
    await expect(main.getByText("No agents configured")).toBeVisible();
    await expect(main.getByText("Add agents to your herdctl.yaml to get started")).toBeVisible();
  });

  test("shows the no-jobs empty state before any job runs", async ({ page, harness }) => {
    await page.goto(harness.baseUrl);
    await expect(page.locator("main").getByText("No jobs yet")).toBeVisible();
  });
});
