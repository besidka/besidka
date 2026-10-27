import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acquireMemoryLease,
  acquireProjectMemoryLease,
  memoryExtractionLeaseKey,
  isProjectMemoryLeaseHeld,
  projectMemoryRefreshKvKey,
} from '../../../server/utils/projects/memory-lease'

const KEY = 'project-memory-refreshing:project-1'
const HEARTBEAT_INTERVAL_MS = 30_000
const EXTRACTION_KEY = 'memory-extraction:chat-1'
const LEASE_TTL_MS = 120_000

function createExpiringKv() {
  const entries = new Map<string, number>()

  return {
    entries,
    get: vi.fn(async (key: string) => {
      const expiresAt = entries.get(key)

      if (expiresAt === undefined || expiresAt <= Date.now()) {
        return null
      }

      return '1'
    }),
    put: vi.fn(async (
      key: string,
      _value: string,
      options: { expirationTtl: number },
    ) => {
      entries.set(key, Date.now() + options.expirationTtl * 1000)
    }),
    delete: vi.fn(async (key: string) => {
      entries.delete(key)
    }),
  }
}

function createKv(heldValue: string | null = null) {
  return {
    get: vi.fn(async () => heldValue),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  }
}

describe('project memory lease', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('builds the lease key from the project id', () => {
    expect(projectMemoryRefreshKvKey('project-1')).toBe(KEY)
  })

  it('acquires the lease with a 120 second ttl when it is free', async () => {
    const kv = createKv()

    vi.stubGlobal('useKV', () => kv)

    const lease = await acquireProjectMemoryLease('project-1')

    expect(lease).not.toBeNull()
    expect(kv.get).toHaveBeenCalledWith(KEY)
    expect(kv.put).toHaveBeenCalledTimes(1)
    expect(kv.put).toHaveBeenCalledWith(KEY, '1', { expirationTtl: 120 })

    await lease?.release()
  })

  it('returns null without writing when a live lease is held', async () => {
    const kv = createKv('1')

    vi.stubGlobal('useKV', () => kv)

    const lease = await acquireProjectMemoryLease('project-1')

    expect(lease).toBeNull()
    expect(kv.put).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('fails open and logs when reading the lease throws', async () => {
    const kv = createKv()
    const logger = { set: vi.fn() }

    kv.get.mockRejectedValueOnce(new Error('kv down'))
    vi.stubGlobal('useKV', () => kv)

    const lease = await acquireProjectMemoryLease('project-1', logger)

    expect(lease).not.toBeNull()
    expect(kv.put).toHaveBeenCalledWith(KEY, '1', { expirationTtl: 120 })
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        projectMemoryLease: {
          operation: 'get',
          error: 'kv down',
        },
      },
    })

    await lease?.release()
  })

  it('renews the lease on a 30 second heartbeat', async () => {
    const kv = createKv()

    vi.stubGlobal('useKV', () => kv)

    const lease = await acquireProjectMemoryLease('project-1')

    expect(kv.put).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)

    expect(kv.put).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)

    expect(kv.put).toHaveBeenCalledTimes(3)
    expect(kv.put).toHaveBeenLastCalledWith(
      KEY,
      '1',
      { expirationTtl: 120 },
    )

    await lease?.release()
  })

  it('deletes the key and stops the heartbeat on release', async () => {
    const kv = createKv()
    const logger = { set: vi.fn() }

    vi.stubGlobal('useKV', () => kv)

    const lease = await acquireProjectMemoryLease('project-1', logger)

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)
    await lease?.release()

    expect(kv.delete).toHaveBeenCalledWith(KEY)
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 3)

    expect(kv.put).toHaveBeenCalledTimes(2)
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        projectMemoryLease: {
          operation: 'release',
          heartbeats: 1,
        },
      },
    })
  })

  it('logs and swallows a failing delete on release', async () => {
    const kv = createKv()
    const logger = { set: vi.fn() }

    kv.delete.mockRejectedValueOnce(new Error('delete failed'))
    vi.stubGlobal('useKV', () => kv)

    const lease = await acquireProjectMemoryLease('project-1', logger)

    await expect(lease?.release()).resolves.toBeUndefined()
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        projectMemoryLease: {
          operation: 'delete',
          error: 'delete failed',
        },
      },
    })
  })

  describe('isProjectMemoryLeaseHeld', () => {
    it('is true while the lease key exists', async () => {
      const kv = createKv('1')

      vi.stubGlobal('useKV', () => kv)

      expect(await isProjectMemoryLeaseHeld('project-1')).toBe(true)
      expect(kv.get).toHaveBeenCalledWith(KEY)
      expect(kv.put).not.toHaveBeenCalled()
    })

    it('is false when the lease key is absent', async () => {
      vi.stubGlobal('useKV', () => createKv())

      expect(await isProjectMemoryLeaseHeld('project-1')).toBe(false)
    })

    it('fails open as held and logs when the read throws', async () => {
      const kv = createKv()
      const logger = { set: vi.fn() }

      kv.get.mockRejectedValueOnce(new Error('kv down'))
      vi.stubGlobal('useKV', () => kv)

      expect(await isProjectMemoryLeaseHeld('project-1', logger)).toBe(true)
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          projectMemoryLease: {
            operation: 'get',
            error: 'kv down',
          },
        },
      })
    })
  })

  describe('memoryExtractionLeaseKey', () => {
    it('builds the extraction lease key from the chat id', () => {
      expect(memoryExtractionLeaseKey('chat-1')).toBe(EXTRACTION_KEY)
    })

    it('does not collide with the project refresh key', () => {
      expect(memoryExtractionLeaseKey('x')).not.toBe(projectMemoryRefreshKvKey('x'))
    })
  })

  describe('acquireMemoryLease', () => {
    it('acquires a free key with a 120 second ttl', async () => {
      const kv = createKv()

      vi.stubGlobal('useKV', () => kv)

      const lease = await acquireMemoryLease(EXTRACTION_KEY)

      expect(lease).not.toBeNull()
      expect(kv.get).toHaveBeenCalledWith(EXTRACTION_KEY)
      expect(kv.put).toHaveBeenCalledWith(
        EXTRACTION_KEY,
        '1',
        { expirationTtl: 120 },
      )

      await lease?.release()
    })

    it('returns null without writing when the lease is held', async () => {
      const kv = createKv('1')

      vi.stubGlobal('useKV', () => kv)

      const lease = await acquireMemoryLease(EXTRACTION_KEY)

      expect(lease).toBeNull()
      expect(kv.put).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('deletes the key and stops the heartbeat on release', async () => {
      const kv = createKv()
      const logger = { set: vi.fn() }

      vi.stubGlobal('useKV', () => kv)

      const lease = await acquireMemoryLease(EXTRACTION_KEY, logger)

      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)
      await lease?.release()

      expect(kv.delete).toHaveBeenCalledWith(EXTRACTION_KEY)
      expect(vi.getTimerCount()).toBe(0)

      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 3)

      expect(kv.put).toHaveBeenCalledTimes(2)
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          projectMemoryLease: {
            operation: 'release',
            heartbeats: 1,
          },
        },
      })
    })

    it('fails open and logs when reading the lease throws', async () => {
      const kv = createKv()
      const logger = { set: vi.fn() }

      kv.get.mockRejectedValueOnce(new Error('kv down'))
      vi.stubGlobal('useKV', () => kv)

      const lease = await acquireMemoryLease(EXTRACTION_KEY, logger)

      expect(lease).not.toBeNull()
      expect(kv.put).toHaveBeenCalledWith(
        EXTRACTION_KEY,
        '1',
        { expirationTtl: 120 },
      )
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          projectMemoryLease: {
            operation: 'get',
            error: 'kv down',
          },
        },
      })

      await lease?.release()
    })

    it('lets a second holder in after release', async () => {
      const kv = createExpiringKv()

      vi.stubGlobal('useKV', () => kv)

      const firstLease = await acquireMemoryLease(EXTRACTION_KEY)

      expect(await acquireMemoryLease(EXTRACTION_KEY)).toBeNull()

      await firstLease?.release()

      const secondLease = await acquireMemoryLease(EXTRACTION_KEY)

      expect(secondLease).not.toBeNull()

      await secondLease?.release()
    })

    it('blocks other chats independently of each other', async () => {
      const kv = createExpiringKv()

      vi.stubGlobal('useKV', () => kv)

      const firstLease = await acquireMemoryLease(
        memoryExtractionLeaseKey('chat-1'),
      )
      const otherLease = await acquireMemoryLease(
        memoryExtractionLeaseKey('chat-2'),
      )

      expect(firstLease).not.toBeNull()
      expect(otherLease).not.toBeNull()

      await firstLease?.release()
      await otherLease?.release()
    })

    it('frees the key by ttl after a dead worker stops renewing it', async () => {
      const kv = createExpiringKv()

      vi.stubGlobal('useKV', () => kv)
      await kv.put(EXTRACTION_KEY, '1', { expirationTtl: 120 })

      expect(await acquireMemoryLease(EXTRACTION_KEY)).toBeNull()

      await vi.advanceTimersByTimeAsync(LEASE_TTL_MS - 1000)

      expect(await acquireMemoryLease(EXTRACTION_KEY)).toBeNull()

      await vi.advanceTimersByTimeAsync(2000)

      const recoveredLease = await acquireMemoryLease(EXTRACTION_KEY)

      expect(recoveredLease).not.toBeNull()

      await recoveredLease?.release()
    })

    it('keeps a live holder from expiring through the heartbeat', async () => {
      const kv = createExpiringKv()

      vi.stubGlobal('useKV', () => kv)

      const lease = await acquireMemoryLease(EXTRACTION_KEY)

      await vi.advanceTimersByTimeAsync(LEASE_TTL_MS * 2)

      expect(await acquireMemoryLease(EXTRACTION_KEY)).toBeNull()

      await lease?.release()
    })
  })

  describe('acquireProjectMemoryLease delegation', () => {
    it('uses the project refresh key through the generic lease', async () => {
      const kv = createExpiringKv()

      vi.stubGlobal('useKV', () => kv)

      const lease = await acquireProjectMemoryLease('project-1')

      expect(kv.entries.has(KEY)).toBe(true)
      expect(await acquireMemoryLease(KEY)).toBeNull()

      await lease?.release()

      expect(kv.entries.has(KEY)).toBe(false)
    })
  })
})
