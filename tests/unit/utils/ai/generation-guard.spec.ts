import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GENERATION_GUARD_HEARTBEAT_INTERVAL_MS,
  GENERATION_GUARD_LEASE_TTL_SECONDS,
  GENERATION_GUARD_STOP_WAIT_MS,
  putGenerationGuard,
  startGenerationGuardHeartbeat,
} from '../../../../server/utils/ai/generation-guard'

const GUARD_KEY = 'chat-generating:chat-1:message-1'
const LEASE_OPTIONS = { expirationTtl: GENERATION_GUARD_LEASE_TTL_SECONDS }

function createDependencies() {
  const put = vi.fn(async () => undefined)
  const set = vi.fn()

  return {
    kv: { put },
    logger: { set },
    put,
    set,
  }
}

describe('generation guard lease', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the lease above the KV minimum and the heartbeat comfortably '
    + 'inside it', () => {
    expect(GENERATION_GUARD_LEASE_TTL_SECONDS).toBeGreaterThanOrEqual(60)
    expect(GENERATION_GUARD_HEARTBEAT_INTERVAL_MS).toBeGreaterThanOrEqual(1000)
    expect(GENERATION_GUARD_LEASE_TTL_SECONDS * 1000).toBeGreaterThanOrEqual(
      GENERATION_GUARD_HEARTBEAT_INTERVAL_MS * 4,
    )
  })

  it('puts the guard with the lease ttl', async () => {
    const { kv, logger, put, set } = createDependencies()

    await putGenerationGuard(kv, GUARD_KEY, 'put', logger)

    expect(put).toHaveBeenCalledExactlyOnceWith(GUARD_KEY, '1', LEASE_OPTIONS)
    expect(set).not.toHaveBeenCalled()
  })

  it('does not put before the first interval elapses', async () => {
    const { kv, logger, put } = createDependencies()

    startGenerationGuardHeartbeat(kv, GUARD_KEY, logger)

    await vi.advanceTimersByTimeAsync(
      GENERATION_GUARD_HEARTBEAT_INTERVAL_MS - 1,
    )

    expect(put).not.toHaveBeenCalled()
  })

  it('re-puts the guard with the lease ttl on every interval', async () => {
    const { kv, logger, put } = createDependencies()

    startGenerationGuardHeartbeat(kv, GUARD_KEY, logger)

    await vi.advanceTimersByTimeAsync(
      GENERATION_GUARD_HEARTBEAT_INTERVAL_MS * 3,
    )

    expect(put).toHaveBeenCalledTimes(3)
    expect(put).toHaveBeenNthCalledWith(1, GUARD_KEY, '1', LEASE_OPTIONS)
    expect(put).toHaveBeenNthCalledWith(3, GUARD_KEY, '1', LEASE_OPTIONS)
  })

  it('stops putting after the heartbeat is stopped', async () => {
    const { kv, logger, put } = createDependencies()
    const { stop: stopHeartbeat } = startGenerationGuardHeartbeat(
      kv,
      GUARD_KEY,
      logger,
    )

    await vi.advanceTimersByTimeAsync(GENERATION_GUARD_HEARTBEAT_INTERVAL_MS)
    await stopHeartbeat()
    await vi.advanceTimersByTimeAsync(
      GENERATION_GUARD_HEARTBEAT_INTERVAL_MS * 5,
    )

    expect(put).toHaveBeenCalledTimes(1)
  })

  it('swallows a failed heartbeat put, records it and keeps beating', async () => {
    const { kv, logger, put, set } = createDependencies()

    put.mockRejectedValueOnce(new Error('kv unavailable'))

    startGenerationGuardHeartbeat(kv, GUARD_KEY, logger)

    await vi.advanceTimersByTimeAsync(
      GENERATION_GUARD_HEARTBEAT_INTERVAL_MS * 2,
    )

    expect(set).toHaveBeenCalledExactlyOnceWith({
      attributes: {
        generationGuard: {
          operation: 'heartbeat',
          error: 'kv unavailable',
        },
      },
    })
    expect(put).toHaveBeenCalledTimes(2)
  })

  it('skips a tick while the previous heartbeat put is still in flight',
    async () => {
      const { kv, logger, put } = createDependencies()
      let releaseSlowPut: () => void = () => undefined

      put.mockImplementationOnce(() => {
        return new Promise<undefined>((resolve) => {
          releaseSlowPut = () => resolve(undefined)
        })
      })

      startGenerationGuardHeartbeat(kv, GUARD_KEY, logger)

      await vi.advanceTimersByTimeAsync(
        GENERATION_GUARD_HEARTBEAT_INTERVAL_MS * 3,
      )

      expect(put).toHaveBeenCalledTimes(1)

      releaseSlowPut()
      await vi.advanceTimersByTimeAsync(GENERATION_GUARD_HEARTBEAT_INTERVAL_MS)

      expect(put).toHaveBeenCalledTimes(2)
    })

  it('waits for an in-flight heartbeat put before the stop resolves',
    async () => {
      const { kv, logger, put } = createDependencies()
      let releaseSlowPut: () => void = () => undefined
      let hasStopResolved = false

      put.mockImplementationOnce(() => {
        return new Promise<undefined>((resolve) => {
          releaseSlowPut = () => resolve(undefined)
        })
      })

      const { stop: stopHeartbeat } = startGenerationGuardHeartbeat(
        kv,
        GUARD_KEY,
        logger,
      )

      await vi.advanceTimersByTimeAsync(GENERATION_GUARD_HEARTBEAT_INTERVAL_MS)

      const stopped = stopHeartbeat().then(() => {
        hasStopResolved = true
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(hasStopResolved).toBe(false)

      releaseSlowPut()
      await stopped

      expect(hasStopResolved).toBe(true)
    })

  it('stops waiting for a hung heartbeat put after the stop wait bound',
    async () => {
      const { kv, logger, put } = createDependencies()
      let hasStopResolved = false

      put.mockImplementationOnce(() => {
        return new Promise<undefined>(() => undefined)
      })

      const { stop: stopHeartbeat } = startGenerationGuardHeartbeat(
        kv,
        GUARD_KEY,
        logger,
      )

      await vi.advanceTimersByTimeAsync(GENERATION_GUARD_HEARTBEAT_INTERVAL_MS)

      const stopped = stopHeartbeat().then(() => {
        hasStopResolved = true
      })

      await vi.advanceTimersByTimeAsync(GENERATION_GUARD_STOP_WAIT_MS - 1)

      expect(hasStopResolved).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await stopped

      expect(hasStopResolved).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    })

  it('does not wait when no heartbeat put is in flight', async () => {
    const { kv, logger } = createDependencies()
    const { stop: stopHeartbeat } = startGenerationGuardHeartbeat(
      kv,
      GUARD_KEY,
      logger,
    )

    await stopHeartbeat()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('counts only successful heartbeat renewals', async () => {
    const { kv, logger, put } = createDependencies()

    put.mockRejectedValueOnce(new Error('kv unavailable'))

    const heartbeat = startGenerationGuardHeartbeat(kv, GUARD_KEY, logger)

    expect(heartbeat.getRenewalCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(
      GENERATION_GUARD_HEARTBEAT_INTERVAL_MS,
    )

    expect(heartbeat.getRenewalCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(
      GENERATION_GUARD_HEARTBEAT_INTERVAL_MS * 2,
    )

    expect(heartbeat.getRenewalCount()).toBe(2)
  })

  it('does not count a skipped tick as a renewal', async () => {
    const { kv, logger, put } = createDependencies()
    let releaseSlowPut: () => void = () => undefined

    put.mockImplementationOnce(() => {
      return new Promise<undefined>((resolve) => {
        releaseSlowPut = () => resolve(undefined)
      })
    })

    const heartbeat = startGenerationGuardHeartbeat(kv, GUARD_KEY, logger)

    await vi.advanceTimersByTimeAsync(
      GENERATION_GUARD_HEARTBEAT_INTERVAL_MS * 3,
    )

    expect(heartbeat.getRenewalCount()).toBe(0)

    releaseSlowPut()
    await vi.advanceTimersByTimeAsync(0)

    expect(heartbeat.getRenewalCount()).toBe(1)
  })

  it('reports false from a failed put and true from a successful one',
    async () => {
      const { kv, logger, put } = createDependencies()

      put.mockRejectedValueOnce(new Error('kv unavailable'))

      expect(await putGenerationGuard(kv, GUARD_KEY, 'put', logger))
        .toBe(false)
      expect(await putGenerationGuard(kv, GUARD_KEY, 'put', logger))
        .toBe(true)
    })
})
