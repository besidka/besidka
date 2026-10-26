import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acquireKnowledgePackLease,
  clearKnowledgePackBackoff,
  isKnowledgePackBackedOff,
  knowledgePackBackoffKey,
  knowledgePackBuildLeaseKey,
  recordKnowledgePackFailure,
} from '~~/server/utils/knowledge/pack-lease'

const HEARTBEAT_INTERVAL_MS = 30_000
const LEASE_TTL_SECONDS = 120

function createKv() {
  const entries = new Map<string, number>()
  const values = new Map<string, string>()

  return {
    entries,
    get: vi.fn(async (key: string) => {
      const expiresAt = entries.get(key)

      if (expiresAt === undefined || expiresAt <= Date.now()) {
        return null
      }

      return values.get(key) ?? '1'
    }),
    put: vi.fn(async (
      key: string,
      value: string,
      options: { expirationTtl: number },
    ) => {
      entries.set(key, Date.now() + options.expirationTtl * 1000)
      values.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      entries.delete(key)
      values.delete(key)
    }),
  }
}

describe('knowledge pack lease', () => {
  let kv: ReturnType<typeof createKv>

  beforeEach(() => {
    vi.useFakeTimers()
    kv = createKv()
    vi.stubGlobal('useKV', () => kv)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('builds the key from the internal project id', () => {
    expect(knowledgePackBuildLeaseKey(42)).toBe('knowledge-pack-build:42')
  })

  it('takes a 120 second lease under the pack build key', async () => {
    const lease = await acquireKnowledgePackLease(42)

    expect(lease).not.toBeNull()
    expect(kv.put).toHaveBeenCalledWith(
      'knowledge-pack-build:42',
      '1',
      { expirationTtl: LEASE_TTL_SECONDS },
    )

    await lease!.release()
  })

  it('refuses a second holder for the same project', async () => {
    const first = await acquireKnowledgePackLease(42)
    const second = await acquireKnowledgePackLease(42)

    expect(first).not.toBeNull()
    expect(second).toBeNull()

    await first!.release()
  })

  it('lets different projects build at the same time', async () => {
    const first = await acquireKnowledgePackLease(1)
    const second = await acquireKnowledgePackLease(2)

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()

    await first!.release()
    await second!.release()
  })

  it('renews the lease with a heartbeat while it is held', async () => {
    const lease = await acquireKnowledgePackLease(42)

    kv.put.mockClear()

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 3)

    expect(kv.put).toHaveBeenCalledTimes(3)
    expect(await acquireKnowledgePackLease(42)).toBeNull()

    await lease!.release()
  })

  it('frees the key and stops the heartbeat on release', async () => {
    const lease = await acquireKnowledgePackLease(42)

    await lease!.release()
    kv.put.mockClear()
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 3)

    expect(kv.put).not.toHaveBeenCalled()
    expect(kv.entries.has('knowledge-pack-build:42')).toBe(false)

    const next = await acquireKnowledgePackLease(42)

    expect(next).not.toBeNull()

    await next!.release()
  })

  it('lets a dead holder expire after the ttl', async () => {
    const abandoned = await acquireKnowledgePackLease(42)

    expect(abandoned).not.toBeNull()

    kv.put.mockImplementation(async () => undefined)
    await vi.advanceTimersByTimeAsync((LEASE_TTL_SECONDS + 1) * 1000)

    expect(await acquireKnowledgePackLease(42)).not.toBeNull()
  })

  it('reports lease activity through the provided logger', async () => {
    const logger = { set: vi.fn() }
    const lease = await acquireKnowledgePackLease(42, logger)

    await lease!.release()

    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        projectMemoryLease: { operation: 'release', heartbeats: 0 },
      },
    })
  })

  describe('failed-build backoff', () => {
    it('builds the key from the internal project id', () => {
      expect(knowledgePackBackoffKey(42)).toBe('knowledge-pack-backoff:42')
    })

    it('is open until three failures are recorded for the version', async () => {
      expect(await isKnowledgePackBackedOff(42, 7)).toBe(false)

      await recordKnowledgePackFailure(42, 7)
      await recordKnowledgePackFailure(42, 7)

      expect(await isKnowledgePackBackedOff(42, 7)).toBe(false)

      await recordKnowledgePackFailure(42, 7)

      expect(await isKnowledgePackBackedOff(42, 7)).toBe(true)
    })

    it('stores count and version with a 600 second ttl', async () => {
      await recordKnowledgePackFailure(42, 7)

      expect(kv.put).toHaveBeenCalledWith(
        'knowledge-pack-backoff:42',
        JSON.stringify({ count: 1, version: 7 }),
        { expirationTtl: 600 },
      )
    })

    it('does not apply to another version and restarts the count', async () => {
      await recordKnowledgePackFailure(42, 7)
      await recordKnowledgePackFailure(42, 7)
      await recordKnowledgePackFailure(42, 7)
      await recordKnowledgePackFailure(42, 8)

      expect(await isKnowledgePackBackedOff(42, 7)).toBe(false)
      expect(await isKnowledgePackBackedOff(42, 8)).toBe(false)
      expect(kv.put).toHaveBeenLastCalledWith(
        'knowledge-pack-backoff:42',
        JSON.stringify({ count: 1, version: 8 }),
        { expirationTtl: 600 },
      )
    })

    it('keeps projects apart', async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await recordKnowledgePackFailure(42, 7)
      }

      expect(await isKnowledgePackBackedOff(43, 7)).toBe(false)
    })

    it('expires after ten minutes', async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await recordKnowledgePackFailure(42, 7)
      }

      await vi.advanceTimersByTimeAsync(601_000)

      expect(await isKnowledgePackBackedOff(42, 7)).toBe(false)
    })

    it('is cleared by clearKnowledgePackBackoff', async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await recordKnowledgePackFailure(42, 7)
      }

      await clearKnowledgePackBackoff(42)

      expect(kv.delete).toHaveBeenCalledWith('knowledge-pack-backoff:42')
      expect(await isKnowledgePackBackedOff(42, 7)).toBe(false)
    })

    it('fails open and never throws when KV errors', async () => {
      const logger = { set: vi.fn() }

      kv.get.mockRejectedValue(new Error('KV down'))
      kv.put.mockRejectedValue(new Error('KV down'))
      kv.delete.mockRejectedValue(new Error('KV down'))

      expect(await isKnowledgePackBackedOff(42, 7, logger)).toBe(false)
      await expect(recordKnowledgePackFailure(42, 7, logger))
        .resolves.toBeUndefined()
      await expect(clearKnowledgePackBackoff(42, logger))
        .resolves.toBeUndefined()
      expect(logger.set).toHaveBeenCalledTimes(3)
    })
  })
})
