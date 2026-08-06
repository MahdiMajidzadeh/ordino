/**
 * Minimal promise pool: run `tasks` with at most `concurrency` in flight.
 * Results keep input order; individual failures reject the whole pool unless
 * the task itself catches.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  async function worker(): Promise<void> {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
      const index = next++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () =>
    worker()
  )
  await Promise.all(workers)
  return results
}
