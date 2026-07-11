import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../concurrency.js";

describe("mapWithConcurrency", () => {
  it("returns an empty array for empty input without calling fn", async () => {
    let calls = 0;
    const result = await mapWithConcurrency([], 4, async () => {
      calls += 1;
      return 1;
    });
    expect(result).toEqual([]);
    expect(calls).toBe(0);
  });

  it("preserves input order regardless of completion order", async () => {
    // Earlier items resolve later, so completion order is reversed.
    const items = [30, 20, 10, 0];
    const result = await mapWithConcurrency(items, 4, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return { i, ms };
    });
    expect(result.map((r) => r.i)).toEqual([0, 1, 2, 3]);
    expect(result.map((r) => r.ms)).toEqual([30, 20, 10, 0]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await mapWithConcurrency(items, 3, async (n) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return n;
    });

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1); // actually ran concurrently
  });

  it("processes every item exactly once", async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const seen = new Set<number>();
    const result = await mapWithConcurrency(items, 8, async (n) => {
      seen.add(n);
      return n * 2;
    });
    expect(seen.size).toBe(50);
    expect(result).toEqual(items.map((n) => n * 2));
  });

  it("rejects if a mapper rejects", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });

  it("treats a limit below 1 as 1 (still processes all items)", async () => {
    const result = await mapWithConcurrency([1, 2, 3], 0, async (n) => n + 1);
    expect(result).toEqual([2, 3, 4]);
  });
});
