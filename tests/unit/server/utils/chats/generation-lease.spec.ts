import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GENERATION_GUARD_HEARTBEAT_INTERVAL_MS,
  GENERATION_GUARD_LEASE_TTL_SECONDS,
} from '~~/server/utils/ai/generation-guard'
import {
  GENERATION_LEASE_READ_CACHE_TTL_SECONDS,
  GENERATION_LEASE_STALE_MS,
  GENERATION_STOP_CHECK_INTERVAL_MS,
  confirmLeaseHolder,
  endDisconnectedRun,
  forgetEndedRunsForTests,
  generationStopKvKey,
  parseGenerationLease,
  putGenerationLease,
  readGenerationLeaseState,
  serializeGenerationLease,
  startGenerationRun,
  stopGenerationLease,
} from '~~/server/utils/chats/generation-lease'

const KEY = 'chat-generating:chat-1:message-1'

beforeEach(() => {
  forgetEndedRunsForTests()
})

function createKv() {
  const values = new Map<string, string>()

  return {
    values,
    get: vi.fn(async (key: string, _options?: unknown) => {
      return values.get(key) ?? null
    }),
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      values.delete(key)
    }),
  }
}

describe('generation lease', () => {
  it('parses a lease, an older value without a run and an empty key', () => {
    const lease = { runId: 'run-1', renewedAt: 5 }

    expect(parseGenerationLease(serializeGenerationLease(lease))).toEqual(lease)
    expect(parseGenerationLease('1')).toBeNull()
    expect(parseGenerationLease('{"runId":1}')).toBeNull()
    expect(parseGenerationLease(null)).toBeUndefined()
  })

  it('tells a free, live, stopped and stale lease apart', async () => {
    const kv = createKv()
    const now = 1_000_000

    expect(await readGenerationLeaseState(kv, KEY, { now }))
      .toEqual({ state: 'free' })

    await kv.put(KEY, '1')

    expect(await readGenerationLeaseState(kv, KEY, { now }))
      .toEqual({ state: 'live', lease: null })

    await putGenerationLease(kv, KEY, 'run-1', { set: vi.fn() }, now)

    expect((await readGenerationLeaseState(kv, KEY, { now })).state)
      .toBe('live')
    expect((await readGenerationLeaseState(kv, KEY, {
      now: now + GENERATION_LEASE_STALE_MS + 1,
    })).state).toBe('stale')

    await kv.put(generationStopKvKey('run-1'), '1')

    expect((await readGenerationLeaseState(kv, KEY, { now })).state)
      .toBe('stopped')
  })

  it('reads every key with the shortest KV cache', async () => {
    const kv = createKv()

    await putGenerationLease(kv, KEY, 'run-1', { set: vi.fn() })
    await readGenerationLeaseState(kv, KEY)
    await stopGenerationLease(kv, KEY)

    expect(kv.get.mock.calls.length).toBeGreaterThan(0)

    for (const [, options] of kv.get.mock.calls) {
      expect(options).toEqual({
        cacheTtl: GENERATION_LEASE_READ_CACHE_TTL_SECONDS,
      })
    }
  })

  it('counts the run the stop route named as stopped without its marker',
    async () => {
      const kv = createKv()

      await putGenerationLease(kv, KEY, 'run-1', { set: vi.fn() })

      expect((await readGenerationLeaseState(kv, KEY, {
        stoppedRunId: 'run-1',
      })).state).toBe('stopped')
      expect((await readGenerationLeaseState(kv, KEY, {
        stoppedRunId: 'run-other',
      })).state).toBe('live')
    })

  it('keeps a run live past one renewal plus a cached read', async () => {
    const kv = createKv()
    const now = 1_000_000

    await putGenerationLease(kv, KEY, 'run-1', { set: vi.fn() }, now)

    const longestHonestAge = GENERATION_GUARD_HEARTBEAT_INTERVAL_MS
      + GENERATION_STOP_CHECK_INTERVAL_MS
      + GENERATION_LEASE_READ_CACHE_TTL_SECONDS * 1000

    expect((await readGenerationLeaseState(kv, KEY, {
      now: now + longestHonestAge,
    })).state).toBe('live')
  })

  it('stops the holder and frees the key', async () => {
    const kv = createKv()

    await putGenerationLease(kv, KEY, 'run-1', { set: vi.fn() })

    expect(await stopGenerationLease(kv, KEY))
      .toEqual({ hadLease: true, runId: 'run-1' })
    expect(kv.values.has(KEY)).toBe(false)
    expect(kv.values.get(generationStopKvKey('run-1'))).toBe('1')
    expect(await stopGenerationLease(kv, KEY))
      .toEqual({ hadLease: false, runId: null })
  })

  it('deletes the key even when the read saw no lease', async () => {
    const kv = createKv()

    await kv.put(KEY, serializeGenerationLease({ runId: 'run-1', renewedAt: 1 }))
    kv.get.mockResolvedValueOnce(null)

    expect(await stopGenerationLease(kv, KEY))
      .toEqual({ hadLease: false, runId: null })
    expect(kv.values.has(KEY)).toBe(false)
  })

  it('only deletes an older lease without a run id', async () => {
    const kv = createKv()

    await kv.put(KEY, '1')

    expect(await stopGenerationLease(kv, KEY))
      .toEqual({ hadLease: true, runId: null })
    expect(kv.values.size).toBe(0)
  })
})

describe('endDisconnectedRun', () => {
  it('marks the run stopped and frees its lease', async () => {
    const kv = createKv()

    await putGenerationLease(kv, KEY, 'run-1', { set: vi.fn() })

    expect(await endDisconnectedRun({ kv, key: KEY, runId: 'run-1' }))
      .toEqual({ leaseReleased: true })
    expect(kv.values.has(KEY)).toBe(false)
    expect(kv.values.get(generationStopKvKey('run-1'))).toBe('1')
    expect(await readGenerationLeaseState(kv, KEY))
      .toEqual({ state: 'free' })
  })

  it('lets a retry in the same isolate take over at once, whatever KV says',
    async () => {
      const kv = createKv()

      await putGenerationLease(kv, KEY, 'run-1', { set: vi.fn() })

      expect((await readGenerationLeaseState(kv, KEY)).state).toBe('live')

      const ending = endDisconnectedRun({ kv, key: KEY, runId: 'run-1' })

      kv.get.mockImplementation(async (key: string) => {
        return key === KEY
          ? serializeGenerationLease({ runId: 'run-1', renewedAt: Date.now() })
          : null
      })

      expect((await readGenerationLeaseState(kv, KEY)).state).toBe('stopped')

      await ending
    })

  it('never deletes the lease of a run that took over', async () => {
    const kv = createKv()

    await putGenerationLease(kv, KEY, 'run-2', { set: vi.fn() })

    expect(await endDisconnectedRun({ kv, key: KEY, runId: 'run-1' }))
      .toEqual({ leaseReleased: false })
    expect(parseGenerationLease(kv.values.get(KEY) ?? null))
      .toEqual(expect.objectContaining({ runId: 'run-2' }))
  })

  it('reports a KV failure instead of throwing', async () => {
    const kv = createKv()

    kv.put.mockRejectedValueOnce(new Error('KV down'))

    expect(await endDisconnectedRun({ kv, key: KEY, runId: 'run-1' }))
      .toEqual({ leaseReleased: false, error: 'KV down' })
  })
})

describe('confirmLeaseHolder', () => {
  it('keeps the lease only for the run whose write landed last', async () => {
    const kv = createKv()
    const logger = { set: vi.fn() }

    await putGenerationLease(kv, KEY, 'run-a', logger)
    await putGenerationLease(kv, KEY, 'run-b', logger)

    expect(await confirmLeaseHolder({
      kv,
      key: KEY,
      runId: 'run-a',
      logger,
      settleMs: 0,
    })).toBe(false)
    expect(await confirmLeaseHolder({
      kv,
      key: KEY,
      runId: 'run-b',
      logger,
      settleMs: 0,
    })).toBe(true)
  })

  it('lets the run go on when the read fails', async () => {
    const kv = createKv()
    const logger = { set: vi.fn() }

    kv.get.mockRejectedValueOnce(new Error('KV down'))

    expect(await confirmLeaseHolder({
      kv,
      key: KEY,
      runId: 'run-a',
      logger,
      settleMs: 0,
    })).toBe(true)
    expect(logger.set).toHaveBeenCalled()
  })
})

describe('startGenerationRun', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function start(
    kv: Pick<ReturnType<typeof createKv>, 'get' | 'put' | 'delete'>,
    runId = 'run-1',
    supersededRunId?: string,
  ) {
    const onStopped = vi.fn()
    const run = startGenerationRun({
      kv,
      key: KEY,
      runId,
      logger: { set: vi.fn() },
      onStopped,
      supersededRunId,
    })

    return { run, onStopped }
  }

  it('stops once when the user pressed Stop and never renews again',
    async () => {
      const kv = createKv()

      await putGenerationLease(kv, KEY, 'run-1', { set: vi.fn() })

      const { run, onStopped } = start(kv)

      await stopGenerationLease(kv, KEY)
      await vi.advanceTimersByTimeAsync(GENERATION_STOP_CHECK_INTERVAL_MS * 4)

      expect(onStopped).toHaveBeenCalledTimes(1)
      expect(onStopped).toHaveBeenCalledWith('stopped')
      expect(run.isStopped()).toBe(true)
      expect(kv.values.has(KEY)).toBe(false)
    })

  it('stops when a retry took the lease over, and leaves its lease alone',
    async () => {
      const kv = createKv()

      await putGenerationLease(kv, KEY, 'run-1', { set: vi.fn() })

      const { run, onStopped } = start(kv)

      await putGenerationLease(kv, KEY, 'run-2', { set: vi.fn() })
      await vi.advanceTimersByTimeAsync(GENERATION_STOP_CHECK_INTERVAL_MS)

      expect(onStopped).toHaveBeenCalledWith('taken-over')
      expect(await run.confirmState()).toBe('taken-over')

      await run.release()

      expect(parseGenerationLease(kv.values.get(KEY) ?? null))
        .toMatchObject({ runId: 'run-2' })
    })

  it('renews a live lease and deletes it on release', async () => {
    const kv = createKv()

    await putGenerationLease(kv, KEY, 'run-1', { set: vi.fn() })

    const { run, onStopped } = start(kv)

    await vi.advanceTimersByTimeAsync(GENERATION_STOP_CHECK_INTERVAL_MS * 3)

    expect(onStopped).not.toHaveBeenCalled()
    expect(run.getRenewalCount()).toBe(1)
    expect(await run.confirmState()).toBe('current')

    await run.release()

    expect(kv.values.has(KEY)).toBe(false)
  })

  it('counts its own lease disappearing as a stop', async () => {
    const kv = createKv()

    await putGenerationLease(kv, KEY, 'run-1', { set: vi.fn() })

    const { run, onStopped } = start(kv)

    await vi.advanceTimersByTimeAsync(GENERATION_STOP_CHECK_INTERVAL_MS)
    kv.values.delete(KEY)
    await vi.advanceTimersByTimeAsync(GENERATION_STOP_CHECK_INTERVAL_MS)

    expect(onStopped).toHaveBeenCalledWith('stopped')
    expect(await run.confirmState()).toBe('stopped')
  })

  it('does not count a lease that expired after failed renewals as a stop',
    async () => {
      const kv = createKv()

      await putGenerationLease(kv, KEY, 'run-1', { set: vi.fn() })

      const { run, onStopped } = start(kv)

      await vi.advanceTimersByTimeAsync(GENERATION_STOP_CHECK_INTERVAL_MS)
      kv.put.mockRejectedValue(new Error('KV down'))
      await vi.advanceTimersByTimeAsync(
        GENERATION_GUARD_LEASE_TTL_SECONDS * 1000,
      )
      kv.values.delete(KEY)
      await vi.advanceTimersByTimeAsync(GENERATION_STOP_CHECK_INTERVAL_MS)

      expect(onStopped).not.toHaveBeenCalled()
      expect(await run.confirmState()).toBe('current')
    })

  it('keeps running when its first lease write failed', async () => {
    const kv = createKv()
    const { run, onStopped } = start(kv)

    await vi.advanceTimersByTimeAsync(GENERATION_STOP_CHECK_INTERVAL_MS * 2)

    expect(onStopped).not.toHaveBeenCalled()
    expect(await run.confirmState()).toBe('current')
  })

  it('a stopped run that a retry then took over stores nothing',
    async () => {
      const kv = createKv()

      await putGenerationLease(kv, KEY, 'run-1', { set: vi.fn() })

      const { run } = start(kv)

      await stopGenerationLease(kv, KEY)
      await vi.advanceTimersByTimeAsync(GENERATION_STOP_CHECK_INTERVAL_MS)

      expect(await run.confirmState()).toBe('stopped')

      await putGenerationLease(kv, KEY, 'run-2', { set: vi.fn() })

      expect(await run.confirmState()).toBe('taken-over')
    })

  it('writes its lease back when the run it took over renews once more',
    async () => {
      const kv = createKv()

      await putGenerationLease(kv, KEY, 'run-2', { set: vi.fn() })

      const { run, onStopped } = start(kv, 'run-2', 'run-1')

      await putGenerationLease(kv, KEY, 'run-1', { set: vi.fn() })
      await vi.advanceTimersByTimeAsync(GENERATION_STOP_CHECK_INTERVAL_MS)

      expect(onStopped).not.toHaveBeenCalled()
      expect(parseGenerationLease(kv.values.get(KEY) ?? null))
        .toMatchObject({ runId: 'run-2' })
      expect(await run.confirmState()).toBe('current')
    })

  describe('with a KV that serves cached reads', () => {
    function createCachingKv() {
      const kv = createKv()
      const cache = new Map<string, { value: string | null, until: number }>()
      const read = kv.get.getMockImplementation()!

      kv.get.mockImplementation(async (key: string, options?: unknown) => {
        const cached = cache.get(key)

        if (cached && cached.until > Date.now()) {
          return cached.value
        }

        const value = await read(key)
        const ttl = (options as { cacheTtl?: number } | undefined)?.cacheTtl
          ?? 60

        cache.set(key, { value, until: Date.now() + ttl * 1000 })

        return value
      })

      return kv
    }

    it('a retry sees the stopped run only through the id the stop route '
      + 'returned; the old run stops within one cache lifetime and its last '
      + 'renewal does not end the retry', async () => {
      const kv = createCachingKv()

      await putGenerationLease(kv, KEY, 'run-1', { set: vi.fn() })

      const old = start(kv, 'run-1')

      await vi.advanceTimersByTimeAsync(GENERATION_STOP_CHECK_INTERVAL_MS)

      const { runId } = await stopGenerationLease(kv, KEY)

      expect((await readGenerationLeaseState(kv, KEY)).state).toBe('live')
      expect((await readGenerationLeaseState(kv, KEY, {
        stoppedRunId: runId ?? undefined,
      })).state).toBe('stopped')

      await putGenerationLease(kv, KEY, 'run-2', { set: vi.fn() })

      const retry = start(kv, 'run-2', 'run-1')

      await vi.advanceTimersByTimeAsync(
        GENERATION_LEASE_READ_CACHE_TTL_SECONDS * 1000
        + GENERATION_STOP_CHECK_INTERVAL_MS * 2,
      )

      expect(old.onStopped).toHaveBeenCalledTimes(1)
      expect(retry.onStopped).not.toHaveBeenCalled()
      expect(await retry.run.confirmState()).toBe('current')
      expect(parseGenerationLease(kv.values.get(KEY) ?? null))
        .toMatchObject({ runId: 'run-2' })
    })
  })
})
