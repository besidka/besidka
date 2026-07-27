import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateFileCache: vi.fn(),
  invalidateStorageCache: vi.fn(),
}))

vi.mock('~~/server/utils/files/convert-files-for-ai', () => ({
  invalidateFileCache: mocks.invalidateFileCache,
}))

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: mocks.invalidateStorageCache,
}))

async function importPurgeUserData() {
  return import('../../../../server/utils/account/purge-user-data')
}

function createDb(storageKeys: string[], sessionTokens: string[] = []) {
  const deleteReturning = vi.fn()
    .mockResolvedValueOnce([{ userId: 1 }])
    .mockResolvedValueOnce([{ id: 10 }, { id: 11 }])

  return {
    query: {
      files: {
        findMany: vi.fn(async () => {
          return storageKeys.map((storageKey) => {
            return { storageKey }
          })
        }),
      },
      sessions: {
        findMany: vi.fn(async () => {
          return sessionTokens.map((token) => {
            return { token }
          })
        }),
      },
    },
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: deleteReturning,
      })),
    })),
  }
}

function createStorage() {
  return {
    delete: vi.fn(async () => undefined),
  }
}

function createKv() {
  return {
    delete: vi.fn(async () => undefined),
  }
}

function stubBindings(
  db: ReturnType<typeof createDb>,
  storage: ReturnType<typeof createStorage>,
  kv: ReturnType<typeof createKv> = createKv(),
) {
  vi.stubGlobal('useDb', () => db)
  vi.stubGlobal('useFileStorage', () => storage)
  vi.stubGlobal('useKV', () => kv)
}

describe('purgeUserData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('removes every R2 object in a single batched delete call', async () => {
    const storageKeys = ['users/1/a.png', 'users/1/b.png', 'users/1/c.pdf']
    const db = createDb(storageKeys)
    const storage = createStorage()
    const logger = { set: vi.fn() }

    stubBindings(db, storage)

    const { purgeUserData } = await importPurgeUserData()
    const result = await purgeUserData({ userId: 1, logger })

    expect(storage.delete).toHaveBeenCalledTimes(1)
    expect(storage.delete).toHaveBeenCalledWith(storageKeys)
    expect(mocks.invalidateFileCache).toHaveBeenCalledTimes(3)
    expect(mocks.invalidateStorageCache).toHaveBeenCalledWith(1, logger)
    expect(db.delete).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      filesFound: 3,
      storageKeysDeleted: 3,
      storageBatches: 1,
      fileCacheKeysInvalidated: 3,
      imageGenerationLocksDeleted: 1,
      verificationsDeleted: 2,
      sessionKeysDeleted: 1,
    })
  })

  it('deletes every KV session record and the active-sessions list', async () => {
    const db = createDb([], ['token-a', 'token-b'])
    const storage = createStorage()
    const kv = createKv()

    stubBindings(db, storage, kv)

    const { purgeUserData } = await importPurgeUserData()
    const result = await purgeUserData({
      userId: 42,
      logger: { set: vi.fn() },
    })

    expect(kv.delete.mock.calls.map(([key]) => key)).toEqual([
      'auth:token-a',
      'auth:token-b',
      'auth:active-sessions-42',
    ])
    expect(result.sessionKeysDeleted).toBe(3)
  })

  it('chunks R2 deletes so no call exceeds the batch limit', async () => {
    const storageKeys = Array.from({ length: 1001 }, (_key, index) => {
      return `users/1/file-${index}`
    })
    const db = createDb(storageKeys)
    const storage = createStorage()

    stubBindings(db, storage)

    const { purgeUserData } = await importPurgeUserData()
    const result = await purgeUserData({
      userId: 1,
      logger: { set: vi.fn() },
    })

    expect(storage.delete).toHaveBeenCalledTimes(2)
    expect(storage.delete.mock.calls[0]![0]).toHaveLength(1000)
    expect(storage.delete.mock.calls[1]![0]).toHaveLength(1)
    expect(result.storageBatches).toBe(2)
  })

  it('does not throw or touch R2 when the user has no files', async () => {
    const db = createDb([])
    const storage = createStorage()
    const logger = { set: vi.fn() }

    stubBindings(db, storage)

    const { purgeUserData } = await importPurgeUserData()
    const result = await purgeUserData({ userId: 7, logger })

    expect(storage.delete).not.toHaveBeenCalled()
    expect(mocks.invalidateFileCache).not.toHaveBeenCalled()
    expect(mocks.invalidateStorageCache).toHaveBeenCalledWith(7, logger)
    expect(result).toEqual({
      filesFound: 0,
      storageKeysDeleted: 0,
      storageBatches: 0,
      fileCacheKeysInvalidated: 0,
      imageGenerationLocksDeleted: 1,
      verificationsDeleted: 2,
      sessionKeysDeleted: 1,
    })
  })

  it('rethrows an R2 failure so the account deletion aborts', async () => {
    const db = createDb(['users/1/a.png'])
    const storage = createStorage()
    const logger = { set: vi.fn() }

    storage.delete.mockRejectedValueOnce(new Error('r2 unavailable'))
    stubBindings(db, storage)

    const { purgeUserData } = await importPurgeUserData()

    await expect(purgeUserData({ userId: 1, logger })).rejects.toThrow(
      'r2 unavailable',
    )
    expect(db.delete).not.toHaveBeenCalled()
    expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
      accountPurge: expect.objectContaining({
        phase: 'r2-delete',
        userId: 1,
      }),
    }))
  })
})
