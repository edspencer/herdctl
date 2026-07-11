/**
 * Map over items with a bounded number of concurrent workers, preserving input
 * order in the result array.
 *
 * Unlike `Promise.all(items.map(fn))`, this caps how many `fn` calls are in
 * flight at once — important when `fn` opens files or sockets, so a few hundred
 * items don't exhaust file descriptors. Results are returned in the same order as
 * `items` regardless of completion order.
 *
 * If any `fn` rejects, the returned promise rejects (like `Promise.all`).
 *
 * @param items - The items to map over
 * @param limit - Maximum number of concurrent `fn` calls (clamped to `[1, items.length]`)
 * @param fn - Async mapper receiving each item and its index
 * @returns Results in input order
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const effectiveLimit = Math.max(1, Math.min(Math.floor(limit), items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await fn(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: effectiveLimit }, () => worker()));
  return results;
}
