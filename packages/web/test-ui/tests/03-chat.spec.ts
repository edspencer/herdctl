import { expect, test } from "../fixtures.js";

/**
 * Chat journeys — the highest-value end-to-end flow. A message typed in the
 * browser is sent over the real WebSocket, runs a REAL agent (fake claude
 * writing a real transcript), streams the assistant reply back, and the session
 * becomes resumable for continuity. ZERO Anthropic calls.
 */

test.describe("Agent chat", () => {
  test.use({
    harnessOptions: {
      agents: [{ name: "buddy", description: "A chatty assistant" }],
      fakeScript: {
        "Tell me a joke": "Why did the agent cross the road? To reach the other endpoint.",
      },
    },
  });

  test("new chat: send a message, stream the reply, and adopt the session URL", async ({
    page,
    harness,
  }) => {
    await page.goto(`${harness.baseUrl}/agents/buddy/chat`);

    // Welcome state for a brand-new chat.
    await expect(page.getByRole("heading", { name: "Chat with buddy" })).toBeVisible();

    const composer = page.getByPlaceholder(/Send a message to buddy/);
    await composer.fill("Tell me a joke");
    await composer.press("Enter");

    // User bubble appears immediately.
    await expect(page.getByText("Tell me a joke")).toBeVisible();

    // Assistant reply streams back from the real agent run.
    await expect(
      page.getByText("Why did the agent cross the road? To reach the other endpoint."),
    ).toBeVisible({ timeout: 80_000 });

    // After chat:complete, the URL adopts the server-assigned session id.
    await expect(page).toHaveURL(/\/agents\/buddy\/chat\/[0-9a-f-]{36}/, { timeout: 20_000 });
  });

  test("resume continuity: a fact set in one turn is recalled after resume", async ({
    page,
    harness,
  }) => {
    await page.goto(`${harness.baseUrl}/agents/buddy/chat`);

    const composer = page.getByPlaceholder(/Send a message to buddy/);

    // Turn 1: set a codeword (the fake claude records it in the transcript).
    await composer.fill("the codeword is ORANGE");
    await composer.press("Enter");
    await expect(page.getByText(/remember the codeword ORANGE/)).toBeVisible({ timeout: 80_000 });

    // The session id is now in the URL — the chat is resumable.
    await expect(page).toHaveURL(/\/agents\/buddy\/chat\/[0-9a-f-]{36}/, { timeout: 20_000 });

    // Turn 2: same session, recall the codeword. This exercises --resume in the
    // CLI runtime and the fake reading its own prior transcript.
    await composer.fill("what was the codeword?");
    await composer.press("Enter");
    await expect(page.getByText("The codeword was ORANGE.")).toBeVisible({ timeout: 80_000 });
  });

  test("reloading a completed session replays its history from the transcript", async ({
    page,
    harness,
  }) => {
    await page.goto(`${harness.baseUrl}/agents/buddy/chat`);

    const composer = page.getByPlaceholder(/Send a message to buddy/);
    await composer.fill("Tell me a joke");
    await composer.press("Enter");
    await expect(
      page.getByText("Why did the agent cross the road? To reach the other endpoint."),
    ).toBeVisible({ timeout: 80_000 });

    // Capture the session URL, then hard-reload it.
    await expect(page).toHaveURL(/\/agents\/buddy\/chat\/[0-9a-f-]{36}/, { timeout: 20_000 });
    const sessionUrl = page.url();
    await page.goto(sessionUrl);

    // History (user prompt + assistant reply) is rehydrated from the REST API,
    // which reads the real JSONL transcript.
    await expect(page.getByText("Tell me a joke")).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText("Why did the agent cross the road? To reach the other endpoint."),
    ).toBeVisible();
  });
});
