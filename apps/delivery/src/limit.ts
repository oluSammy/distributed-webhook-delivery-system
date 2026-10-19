// Runs fn over items with at most `limit` running at once. Each lane takes the next item from
// one shared iterator, so a lane that finishes early picks up more work instead of waiting.
export async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = items.values();
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (const item of queue) {
      await fn(item);
    }
  });

  await Promise.all(lanes);
}
