export const SAME_TARGET_SAVE_GAP_MS = 1100

/**
 * Runs saves one after another per key and keeps at least `gapMs` between
 * the end of one save of a key and the start of the next. KV takes about one
 * write a second per key, and the server counts a rate-limit bucket on one
 * key per target, so two quick saves of the same target would be refused in
 * production. A save is queued, never dropped; different keys run
 * independently.
 */
export function createSpacedKeyedQueue(
  gapMs: number = SAME_TARGET_SAVE_GAP_MS,
) {
  const tails = new Map<string, Promise<unknown>>()
  const lastFinishedAt = new Map<string, number>()

  function enqueue<Result>(
    key: string,
    task: () => Promise<Result>,
  ): Promise<Result> {
    const previous = tails.get(key) ?? Promise.resolve()

    const run = previous.then(async () => {
      const finishedAt = lastFinishedAt.get(key)

      if (finishedAt !== undefined) {
        const remaining = gapMs - (Date.now() - finishedAt)

        if (remaining > 0) {
          await new Promise((resolve) => {
            setTimeout(resolve, remaining)
          })
        }
      }

      try {
        return await task()
      } finally {
        lastFinishedAt.set(key, Date.now())
      }
    })

    tails.set(key, run.catch(() => undefined))

    return run
  }

  function reset() {
    tails.clear()
    lastFinishedAt.clear()
  }

  return { enqueue, reset }
}
