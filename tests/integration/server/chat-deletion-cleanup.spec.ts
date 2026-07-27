import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateFileCache: vi.fn(async () => undefined),
  invalidateStorageCache: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/files/convert-files-for-ai', () => ({
  invalidateFileCache: mocks.invalidateFileCache,
}))

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: mocks.invalidateStorageCache,
}))

async function loadModule() {
  return import('../../../server/utils/files/chat-deletion-cleanup')
}

function createLogger() {
  return { set: vi.fn() }
}

function createJoinWhereChain(result: unknown[]) {
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn(async () => result),
      })),
    })),
  }
}

describe('findChatOriginFiles', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('joins files to their origin messages scoped to the chat and user', async () => {
    const rows = [{ id: 'file-1', storageKey: 'key-1' }]
    const select = vi.fn(() => createJoinWhereChain(rows))

    vi.stubGlobal('useDb', () => ({ select }))

    const { findChatOriginFiles } = await loadModule()
    const result = await findChatOriginFiles('chat-1', 1)

    expect(result).toEqual(rows)
    expect(select).toHaveBeenCalledOnce()
  })
})

describe('cleanupFilesOrphanedByChatDeletion', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.invalidateFileCache.mockResolvedValue(undefined)
    mocks.invalidateStorageCache.mockResolvedValue(undefined)
  })

  it('is a no-op when there are no candidate files', async () => {
    const storageDelete = vi.fn()
    const select = vi.fn()
    const deleteQuery = vi.fn()

    vi.stubGlobal('useFileStorage', () => ({ delete: storageDelete }))
    vi.stubGlobal('useDb', () => ({ select, delete: deleteQuery }))

    const { cleanupFilesOrphanedByChatDeletion } = await loadModule()
    const result = await cleanupFilesOrphanedByChatDeletion(
      [],
      1,
      createLogger(),
    )

    expect(result).toEqual({
      candidateCount: 0,
      stillReferencedCount: 0,
      deletedCount: 0,
      failedCount: 0,
    })
    expect(storageDelete).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
    expect(deleteQuery).not.toHaveBeenCalled()
    expect(mocks.invalidateStorageCache).not.toHaveBeenCalled()
  })

  it('batch-deletes R2 objects and file rows in a single call', async () => {
    const storageDelete = vi.fn(async () => undefined)
    const deleteWhere = vi.fn(async () => undefined)
    const deleteQuery = vi.fn(() => ({ where: deleteWhere }))

    vi.stubGlobal('useFileStorage', () => ({ delete: storageDelete }))
    vi.stubGlobal('useDb', () => ({
      select: vi.fn(() => createJoinWhereChain([])),
      delete: deleteQuery,
    }))

    const { cleanupFilesOrphanedByChatDeletion } = await loadModule()
    const candidateFiles = [
      { id: 'file-1', storageKey: 'key-1' },
      { id: 'file-2', storageKey: 'key-2' },
    ]

    const result = await cleanupFilesOrphanedByChatDeletion(
      candidateFiles,
      1,
      createLogger(),
    )

    expect(storageDelete).toHaveBeenCalledOnce()
    expect(storageDelete).toHaveBeenCalledWith(['key-1', 'key-2'])
    expect(deleteQuery).toHaveBeenCalledOnce()
    expect(mocks.invalidateFileCache).toHaveBeenCalledTimes(2)
    expect(mocks.invalidateStorageCache).toHaveBeenCalledOnce()
    expect(result).toEqual({
      candidateCount: 2,
      stillReferencedCount: 0,
      deletedCount: 2,
      failedCount: 0,
    })
  })

  it('keeps a file whose storage key is still referenced by another message', async () => {
    const storageDelete = vi.fn(async () => undefined)
    const deleteWhere = vi.fn(async () => undefined)
    const deleteQuery = vi.fn(() => ({ where: deleteWhere }))
    const stillReferencedMessage = {
      parts: [
        { type: 'file', url: '/files/key-2' },
      ],
    }

    vi.stubGlobal('useFileStorage', () => ({ delete: storageDelete }))
    vi.stubGlobal('useDb', () => ({
      select: vi.fn(() => createJoinWhereChain([stillReferencedMessage])),
      delete: deleteQuery,
    }))

    const { cleanupFilesOrphanedByChatDeletion } = await loadModule()
    const candidateFiles = [
      { id: 'file-1', storageKey: 'key-1' },
      { id: 'file-2', storageKey: 'key-2' },
    ]

    const result = await cleanupFilesOrphanedByChatDeletion(
      candidateFiles,
      1,
      createLogger(),
    )

    expect(storageDelete).toHaveBeenCalledOnce()
    expect(storageDelete).toHaveBeenCalledWith(['key-1'])
    expect(deleteQuery).toHaveBeenCalledOnce()
    expect(result).toEqual({
      candidateCount: 2,
      stillReferencedCount: 1,
      deletedCount: 1,
      failedCount: 0,
    })
  })

  it('ignores data: URLs and non-file parts when scanning for reuse', async () => {
    const storageDelete = vi.fn(async () => undefined)
    const deleteWhere = vi.fn(async () => undefined)
    const deleteQuery = vi.fn(() => ({ where: deleteWhere }))
    const unrelatedMessage = {
      parts: [
        { type: 'text', text: 'hello' },
        { type: 'file', url: 'data:image/png;base64,key-1' },
      ],
    }

    vi.stubGlobal('useFileStorage', () => ({ delete: storageDelete }))
    vi.stubGlobal('useDb', () => ({
      select: vi.fn(() => createJoinWhereChain([unrelatedMessage])),
      delete: deleteQuery,
    }))

    const { cleanupFilesOrphanedByChatDeletion } = await loadModule()
    const candidateFiles = [{ id: 'file-1', storageKey: 'key-1' }]

    const result = await cleanupFilesOrphanedByChatDeletion(
      candidateFiles,
      1,
      createLogger(),
    )

    expect(storageDelete).toHaveBeenCalledWith(['key-1'])
    expect(result.stillReferencedCount).toBe(0)
    expect(result.deletedCount).toBe(1)
  })

  it('does not delete the DB row when the R2 batch delete fails', async () => {
    const storageDelete = vi.fn(async () => {
      throw new Error('R2 failure')
    })
    const deleteQuery = vi.fn()

    vi.stubGlobal('useFileStorage', () => ({ delete: storageDelete }))
    vi.stubGlobal('useDb', () => ({
      select: vi.fn(() => createJoinWhereChain([])),
      delete: deleteQuery,
    }))

    const { cleanupFilesOrphanedByChatDeletion } = await loadModule()
    const candidateFiles = [{ id: 'file-1', storageKey: 'key-1' }]
    const logger = createLogger()

    const result = await cleanupFilesOrphanedByChatDeletion(
      candidateFiles,
      1,
      logger,
    )

    expect(deleteQuery).not.toHaveBeenCalled()
    expect(mocks.invalidateStorageCache).not.toHaveBeenCalled()
    expect(result).toEqual({
      candidateCount: 1,
      stillReferencedCount: 0,
      deletedCount: 0,
      failedCount: 1,
    })
    expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
      orphanedFileCleanup: expect.objectContaining({ failedCount: 1 }),
      attributes: expect.objectContaining({
        orphanedFileCleanup: expect.objectContaining({
          batchDeleteErrors: [expect.stringContaining('R2 failure')],
        }),
      }),
    }))
  })
})
