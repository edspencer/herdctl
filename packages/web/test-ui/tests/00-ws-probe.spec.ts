import { expect, test } from "../fixtures.js";

/**
 * Low-level WebSocket probe — runs INSIDE the real browser to confirm the
 * server's inbound message handling (ping -> pong) works end-to-end over the
 * actual wire, independent of any React code.
 */
test("server replies to a ping with a pong over a real browser WebSocket", async ({
  page,
  harness,
}) => {
  // The probe only needs a document context + page origin to open its own
  // WebSocket; don't block on the full SPA bundle "load" (avoids cold-start
  // flake when several fleets boot in parallel).
  await page.goto(harness.baseUrl, { waitUntil: "domcontentloaded" });

  // This probe used to time out consistently in CI (herdctl#275). The cause was
  // a server bug, not the test: WebSocketHandler.handleConnection attached its
  // "message" listener only AFTER awaiting getFleetStatus(), so a ping sent the
  // instant the socket opened was dropped on a cold/loaded server. The listener
  // is now attached synchronously. As a consequence `pong` may now arrive
  // BEFORE the initial `fleet:status` snapshot, so wait for both rather than
  // assuming an ordering. The connection itself is retried so a genuinely
  // slow-to-accept server doesn't fail the probe.
  const result = await page.evaluate(async (baseUrl) => {
    const wsUrl = `${baseUrl.replace("http", "ws")}/ws`;

    async function probeOnce(timeoutMs: number) {
      const ws = new WebSocket(wsUrl);
      try {
        return await new Promise<{ pong: boolean; gotStatus: boolean }>((resolve, reject) => {
          let gotStatus = false;
          let gotPong = false;
          const settle = () => {
            if (gotStatus && gotPong) {
              clearTimeout(timer);
              resolve({ pong: true, gotStatus: true });
            }
          };
          const timer = setTimeout(
            () => reject(new Error(`ws probe timeout (pong=${gotPong} status=${gotStatus})`)),
            timeoutMs,
          );
          ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "ping" })));
          ws.addEventListener("message", (ev) => {
            const msg = JSON.parse(ev.data as string);
            if (msg.type === "fleet:status") gotStatus = true;
            if (msg.type === "pong") gotPong = true;
            settle();
          });
          ws.addEventListener("error", () => {
            clearTimeout(timer);
            reject(new Error("ws probe error"));
          });
        });
      } finally {
        ws.close();
      }
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await probeOnce(10_000);
      } catch (error) {
        lastError = error;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw lastError;
  }, harness.baseUrl);

  expect(result.gotStatus).toBe(true);
  expect(result.pong).toBe(true);
});
