import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countPendingAsyncQueueEntries, hasPendingAsyncQueue } from "../pending-async-queue.js";

/**
 * The detection keys off the CLI's `queue-operation` audit entries — the same
 * shape the real `dcd8e17e-…` transcript carries: `killed`/`stopped`
 * `<task-notification>` enqueues that were never dequeued before the process
 * died. A running enqueue−dequeue tally that ends above zero is the "stale
 * backlog pending replay" signal the resume seam uses.
 */
describe("pending-async-queue detection", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "herdctl-paq-"));
    file = join(dir, "session.jsonl");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const enq = (content: string) =>
    JSON.stringify({ type: "queue-operation", operation: "enqueue", content });
  const deq = () => JSON.stringify({ type: "queue-operation", operation: "dequeue" });
  const user = (text: string) =>
    JSON.stringify({ type: "user", message: { role: "user", content: text } });

  it("returns 0 for a missing transcript (fresh session)", async () => {
    expect(await countPendingAsyncQueueEntries(join(dir, "nope.jsonl"))).toBe(0);
    expect(await hasPendingAsyncQueue(join(dir, "nope.jsonl"))).toBe(false);
  });

  it("returns 0 for a balanced queue (clean turn boundary)", async () => {
    await writeFile(file, [enq("hi"), deq(), user("hi")].join("\n") + "\n");
    expect(await countPendingAsyncQueueEntries(file)).toBe(0);
    expect(await hasPendingAsyncQueue(file)).toBe(false);
  });

  it("counts trailing un-dequeued enqueues (the dcd8e17e signature)", async () => {
    // One clean turn, then five killed task-notifications enqueued at a turn
    // boundary and never dequeued before the process died.
    const lines = [enq("first prompt"), deq(), user("first prompt")];
    for (let i = 0; i < 5; i++) {
      lines.push(enq(`<task-notification><status>killed</status> ${i}</task-notification>`));
    }
    await writeFile(file, lines.join("\n") + "\n");
    expect(await countPendingAsyncQueueEntries(file)).toBe(5);
    expect(await hasPendingAsyncQueue(file)).toBe(true);
  });

  it("never goes negative when dequeues exceed enqueues", async () => {
    await writeFile(file, [deq(), deq(), enq("a"), deq()].join("\n") + "\n");
    expect(await countPendingAsyncQueueEntries(file)).toBe(0);
  });

  it("tolerates a torn final JSON line", async () => {
    await writeFile(file, `${enq("a")}\n${enq("b")}\n{"type":"queue-operation","opera`);
    expect(await countPendingAsyncQueueEntries(file)).toBe(2);
  });

  it("ignores non-queue-operation lines", async () => {
    await writeFile(file, [user("hello"), enq("x"), user("world")].join("\n") + "\n");
    expect(await countPendingAsyncQueueEntries(file)).toBe(1);
  });
});
