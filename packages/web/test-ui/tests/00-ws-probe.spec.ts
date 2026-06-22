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

  const result = await page.evaluate(async (baseUrl) => {
    const wsUrl = `${baseUrl.replace("http", "ws")}/ws`;
    const ws = new WebSocket(wsUrl);
    return await new Promise<{ pong: boolean; gotStatus: boolean }>((resolve, reject) => {
      let gotStatus = false;
      const timer = setTimeout(() => reject(new Error("ws probe timeout")), 30_000);
      ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "ping" })));
      ws.addEventListener("message", (ev) => {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === "fleet:status") gotStatus = true;
        if (msg.type === "pong") {
          clearTimeout(timer);
          ws.close();
          resolve({ pong: true, gotStatus });
        }
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("ws probe error"));
      });
    });
  }, harness.baseUrl);

  expect(result.gotStatus).toBe(true);
  expect(result.pong).toBe(true);
});
