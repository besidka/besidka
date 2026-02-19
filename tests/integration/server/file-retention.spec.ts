import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupExpiredFiles,
} from '../../../server/utils/files/cleanup-expired-files'
import {
  recomputeUserFileExpiry,
} from '../../../server/utils/files/file-governance'

const mocks = vi.hoisted(() => ({
  invalidateStorageCache: vi.fn(),
  invalidateFileCache: vi.fn(),
}))

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: mocks.invalidateStorageCache,
}))

vi.mock('~~/server/utils/files/convert-files-for-ai', () => ({
  invalidateFileCache: mocks.invalidateFileCache,
}))

interface StorageRow {
  tier: 'free' | 'vip'
  storage: number
  maxFilesPerMessage: number
  maxMessageFilesBytes: number
  fileRetentionDays: number | null
  imageTransformLimitTotal: number | null
  imageTransformUsedTotal: number
}

interface FileRow {
  id: string
  createdAt: Date
  expiresAt: Date | null
}

function createStorageRow(overrides: Partial<StorageRow> = {}): StorageRow {
  return {
    tier: 'free',
    storage: 20 * 1024 * 1024,
    maxFilesPerMessage: 10,
    maxMessageFilesBytes: 1000 * 1024 * 1024,
    fileRetentionDays: 30,
    imageTransformLimitTotal: 0,
    imageTransformUsedTotal: 0,
    ...overrides,
  }
}

function createGovernanceDbMock(
  storageRow: StorageRow,
  files: FileRow[],
) {
  const insertRun = vi.fn().mockResolvedValue(undefined)
  const onConflictDoNothing = vi.fn(() => ({ run: insertRun }))
  const values = vi.fn(() => ({ onConflictDoNothing }))
  const insert = vi.fn(() => ({ values }))
  const storagesFindFirst = vi.fn().mockResolvedValue(storageRow)
  const filesFindMany = vi.fn().mockResolvedValue(files)
  const updateRun = vi.fn().mockResolvedValue(undefined)
  const updateWhere = vi.fn(() => ({ run: updateRun }))
  const updateSet = vi.fn(() => ({ where: updateWhere }))
  const update = vi.fn(() => ({ set: updateSet }))

  return {
    db: {
      insert,
      update,
      query: {
        storages: {
          findFirst: storagesFindFirst,
        },
        files: {
          findMany: filesFindMany,
        },
      },
    },
    spies: {
      updateSet,
      updateWhere,
      updateRun,
    },
  }
}

function createCleanupDbMock(selectedFiles: Array<{
  id: string
  userId: number
  storageKey: string
  expiresAt: Date | null
}>) {
  const findMany = vi.fn().mockResolvedValue(selectedFiles)
  const deleteRun = vi.fn().mockResolvedValue(undefined)
  const deleteWhere = vi.fn(() => ({ run: deleteRun }))
  const deleteFile = vi.fn(() => ({ where: deleteWhere }))

  return {
    db: {
      query: {
        files: {
          findMany,
        },
      },
      delete: deleteFile,
    },
    spies: {
      findMany,
      deleteFile,
      deleteWhere,
      deleteRun,
    },
  }
}

describe('file retention governance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('clears expiry dates for vip policy', async () => {
    const { db, spies } = createGovernanceDbMock(
      createStorageRow({
        tier: 'vip',
        fileRetentionDays: 30,
      }),
      [
        {
          id: 'file-1',
          createdAt: new Date('2025-01-01T00:00:00.000Z'),
          expiresAt: new Date('2025-02-01T00:00:00.000Z'),
        },
        {
          id: 'file-2',
          createdAt: new Date('2025-01-10T00:00:00.000Z'),
          expiresAt: null,
        },
      ],
    )

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: {
        maxFilesPerMessage: 10,
        maxMessageFilesBytes: 1000 * 1024 * 1024,
      },
      filesHardMaxStorageBytes: 1 * 1024 * 1024 * 1024,
      filesGlobalTransformLimitMonthly: 1000,
    }))

    const result = await recomputeUserFileExpiry(1, {
      now: new Date('2026-02-18T00:00:00.000Z'),
    })

    expect(result.retentionDays).toBeNull()
    expect(result.updatedFiles).toBe(1)
    expect(spies.updateSet).toHaveBeenCalledTimes(1)
    expect(spies.updateSet.mock.calls[0]?.[0]).toEqual({
      expiresAt: null,
    })
  })

  it('applies grace window when files would expire immediately after downgrade', async () => {
    const { db, spies } = createGovernanceDbMock(
      createStorageRow({
        tier: 'free',
        fileRetentionDays: 30,
      }),
      [{
        id: 'file-1',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        expiresAt: null,
      }],
    )
    const now = new Date('2026-02-18T00:00:00.000Z')
    const expectedExpiry = new Date('2026-02-25T00:00:00.000Z')

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: {
        maxFilesPerMessage: 10,
        maxMessageFilesBytes: 1000 * 1024 * 1024,
      },
      filesHardMaxStorageBytes: 1 * 1024 * 1024 * 1024,
      filesGlobalTransformLimitMonthly: 1000,
    }))

    const result = await recomputeUserFileExpiry(1, { now })
    const setInput = spies.updateSet.mock.calls[0]?.[0] as {
      expiresAt: Date
    }

    expect(result.retentionDays).toBe(30)
    expect(result.updatedFiles).toBe(1)
    expect(setInput.expiresAt.getTime()).toBe(expectedExpiry.getTime())
  })

  it('recomputes expiry dates when retention shortens from 30 to 7 days', async () => {
    const { db, spies } = createGovernanceDbMock(
      createStorageRow({
        tier: 'free',
        fileRetentionDays: 7,
      }),
      [{
        id: 'file-1',
        createdAt: new Date('2026-02-18T00:00:00.000Z'),
        expiresAt: new Date('2026-03-20T00:00:00.000Z'),
      }],
    )
    const now = new Date('2026-02-18T00:00:00.000Z')
    const expectedExpiry = new Date('2026-02-25T00:00:00.000Z')

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: {
        maxFilesPerMessage: 10,
        maxMessageFilesBytes: 1000 * 1024 * 1024,
      },
      filesHardMaxStorageBytes: 1 * 1024 * 1024 * 1024,
      filesGlobalTransformLimitMonthly: 1000,
    }))

    const result = await recomputeUserFileExpiry(1, { now })
    const setInput = spies.updateSet.mock.calls[0]?.[0] as {
      expiresAt: Date
    }

    expect(result.retentionDays).toBe(7)
    expect(result.updatedFiles).toBe(1)
    expect(setInput.expiresAt.getTime()).toBe(expectedExpiry.getTime())
  })
})

describe('cleanupExpiredFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('deletes expired files and invalidates related caches', async () => {
    const { db, spies } = createCleanupDbMock([{
      id: 'file-1',
      userId: 7,
      storageKey: 'expired.txt',
      expiresAt: new Date('2026-01-01T00:00:00.000Z'),
    }])
    const storageDelete = vi.fn().mockResolvedValue(undefined)

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useFileStorage', () => ({
      delete: storageDelete,
    }))

    const result = await cleanupExpiredFiles({
      batchSize: 100,
      maxRuntimeMs: 20000,
      now: new Date('2026-02-18T00:00:00.000Z'),
    })

    expect(result.selectedCount).toBe(1)
    expect(result.deletedCount).toBe(1)
    expect(result.failedCount).toBe(0)
    expect(spies.deleteRun).toHaveBeenCalledTimes(1)
    expect(mocks.invalidateFileCache).toHaveBeenCalledWith(
      'expired.txt',
      undefined,
    )
    expect(mocks.invalidateStorageCache).toHaveBeenCalledWith(
      7,
      undefined,
    )
  })

  it('keeps DB row when R2 delete fails so next run can retry', async () => {
    const { db, spies } = createCleanupDbMock([{
      id: 'file-1',
      userId: 7,
      storageKey: 'expired.txt',
      expiresAt: new Date('2026-01-01T00:00:00.000Z'),
    }])
    const storageDelete = vi.fn().mockRejectedValue(new Error('R2 unavailable'))

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useFileStorage', () => ({
      delete: storageDelete,
    }))

    const result = await cleanupExpiredFiles({
      batchSize: 100,
      maxRuntimeMs: 20000,
      now: new Date('2026-02-18T00:00:00.000Z'),
      logger: {
        set: vi.fn(),
      },
    })

    expect(result.selectedCount).toBe(1)
    expect(result.deletedCount).toBe(0)
    expect(result.failedCount).toBe(1)
    expect(spies.deleteRun).not.toHaveBeenCalled()
    expect(mocks.invalidateStorageCache).not.toHaveBeenCalled()
  })

  it('is a no-op when there are no expired files', async () => {
    const { db, spies } = createCleanupDbMock([])

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useFileStorage', () => ({
      delete: vi.fn(),
    }))

    const result = await cleanupExpiredFiles({
      batchSize: 100,
      maxRuntimeMs: 20000,
      now: new Date('2026-02-18T00:00:00.000Z'),
    })

    expect(result.selectedCount).toBe(0)
    expect(result.deletedCount).toBe(0)
    expect(result.failedCount).toBe(0)
    expect(spies.deleteRun).not.toHaveBeenCalled()
  })
})
