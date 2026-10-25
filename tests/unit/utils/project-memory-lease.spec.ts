import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acquireProjectMemoryLease,
  isProjectMemoryLeaseHeld,
  projectMemoryRefreshKvKey,
} from '../../../server/utils/projects/memory-lease'

const KEY = 'project-memory-refreshing:project-1'
const HEARTBEAT_INTERVAL_MS = 30_000

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
})
