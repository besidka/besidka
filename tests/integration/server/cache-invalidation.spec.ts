import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  kvDelete: vi.fn(),
}))

interface LoggerLike {
  set: (data: Record<string, unknown>) => void
}

type InvalidateFileCacheFn = (
  storageKey: string,
  logger?: LoggerLike,
) => Promise<void>

type InvalidateStorageCacheFn = (
  userId: number,
  logger?: LoggerLike,
) => Promise<void>

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
  }),
}))

describe('cache invalidation helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('useKV', () => ({
      delete: mocks.kvDelete,
    }))
  })

  it('uses provided logger for file-cache invalidation in cron context', async () => {
    const loggerSet = vi.fn()
    const invalidateFileCache = await getInvalidateFileCache()

    vi.stubGlobal('useEvent', () => {
      throw new Error('Request event is unavailable')
    })
    mocks.kvDelete.mockRejectedValueOnce(new Error('KV unavailable'))

    await expect(
      invalidateFileCache('file-cache-key', { set: loggerSet }),
    ).resolves.toBeUndefined()

    expect(loggerSet).toHaveBeenCalledTimes(1)
  })

  it('uses provided logger for storage-cache invalidation in cron context', async () => {
    const loggerSet = vi.fn()
    const invalidateStorageCache = await getInvalidateStorageCache()

    vi.stubGlobal('useEvent', () => {
      throw new Error('Request event is unavailable')
    })
    mocks.kvDelete.mockRejectedValueOnce(new Error('KV unavailable'))

    await expect(
      invalidateStorageCache(12, { set: loggerSet }),
    ).resolves.toBeUndefined()

    expect(loggerSet).toHaveBeenCalledTimes(1)
  })

  it('falls back to no-op logger when event is unavailable', async () => {
    const invalidateFileCache = await getInvalidateFileCache()
    const invalidateStorageCache = await getInvalidateStorageCache()

    vi.stubGlobal('useEvent', () => {
      throw new Error('Request event is unavailable')
    })
    mocks.kvDelete.mockRejectedValueOnce(new Error('KV unavailable'))
    mocks.kvDelete.mockRejectedValueOnce(new Error('KV unavailable'))

    await expect(invalidateFileCache('file-cache-key'))
      .resolves.toBeUndefined()
    await expect(invalidateStorageCache(12))
      .resolves.toBeUndefined()

    expect(mocks.loggerSet).not.toHaveBeenCalled()
  })
})

async function getInvalidateFileCache(): Promise<InvalidateFileCacheFn> {
  const module = await import(
    '../../../server/utils/files/convert-files-for-ai'
  )

  return module.invalidateFileCache
}

async function getInvalidateStorageCache(): Promise<InvalidateStorageCacheFn> {
  const module = await import('../../../server/api/v1/storage/index.get')

  return module.invalidateStorageCache
}
