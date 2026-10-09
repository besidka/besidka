import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getOwnedFilesByStorageKeys,
  getOwnedGeneratedImageFilesByStorageKeys,
  validateMessageFilePolicy,
} from '../../../server/utils/files/file-governance'

const mocks = vi.hoisted(() => ({
  storagesFindFirst: vi.fn(),
  filesFindMany: vi.fn(),
  insertRun: vi.fn(),
}))

describe('validateMessageFilePolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.storagesFindFirst.mockResolvedValue({
      tier: 'free',
      storage: 20 * 1024 * 1024,
      maxFilesPerMessage: 10,
      maxMessageFilesBytes: 10_000,
      fileRetentionDays: 30,
      imageTransformLimitTotal: 0,
      imageTransformUsedTotal: 0,
    })
    mocks.filesFindMany.mockResolvedValue([])
    mocks.insertRun.mockResolvedValue(undefined)

    vi.stubGlobal('useRuntimeConfig', () => ({
      public: {
        maxFilesPerMessage: 10,
        maxMessageFilesBytes: 10_000,
      },
      filesHardMaxStorageBytes: Number.MAX_SAFE_INTEGER,
    }))
    vi.stubGlobal('useDb', () => ({
      insert() {
        return {
          values() {
            return {
              onConflictDoNothing() {
                return {
                  run: mocks.insertRun,
                }
              },
            }
          },
        }
      },
      query: {
        storages: {
          findFirst: mocks.storagesFindFirst,
        },
        files: {
          findMany: mocks.filesFindMany,
        },
      },
    }))
  })

  it('ignores unavailable files and validates remaining files size', async () => {
    mocks.filesFindMany.mockResolvedValue([
      {
        storageKey: 'available.png',
        size: 3_000,
      },
    ])

    await expect(validateMessageFilePolicy(1, [
      {
        type: 'file',
        url: '/files/available.png',
      },
      {
        type: 'file',
        url: '/files/deleted.png',
      },
    ] as any)).resolves.toBeUndefined()
  })

  it('still throws when available attached files exceed the total size limit', async () => {
    mocks.filesFindMany.mockResolvedValue([
      {
        storageKey: 'available.png',
        size: 12_000,
      },
    ])

    await expect(validateMessageFilePolicy(1, [
      {
        type: 'file',
        url: '/files/available.png',
      },
      {
        type: 'file',
        url: '/files/deleted.png',
      },
    ] as any)).rejects.toMatchObject({
      statusMessage: 'Attached files exceed the maximum total size per message',
    })
  })
})

describe('getOwnedGeneratedImageFilesByStorageKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('useDb', () => ({
      query: {
        files: {
          findMany: mocks.filesFindMany,
        },
      },
    }))
  })

  it('returns an empty map without querying when given no storage keys', async () => {
    const result = await getOwnedGeneratedImageFilesByStorageKeys(1, [])

    expect(result.size).toBe(0)
    expect(mocks.filesFindMany).not.toHaveBeenCalled()
  })

  it('queries deduplicated storage keys scoped to the owner and assistant source', async () => {
    mocks.filesFindMany.mockResolvedValue([
      {
        id: 'file-1',
        storageKey: 'generated.png',
        name: 'generated.png',
        size: 1_234,
        type: 'image/png',
        originProvider: 'openai',
        originModel: 'gpt-image-1',
      },
    ])

    const result = await getOwnedGeneratedImageFilesByStorageKeys(1, [
      'generated.png',
      'generated.png',
    ])

    expect(mocks.filesFindMany).toHaveBeenCalledWith({
      where: {
        userId: 1,
        source: 'assistant',
        storageKey: { in: ['generated.png'] },
      },
      columns: {
        id: true,
        storageKey: true,
        name: true,
        size: true,
        type: true,
        originProvider: true,
        originModel: true,
      },
    })
    expect(result.get('generated.png')).toEqual({
      id: 'file-1',
      storageKey: 'generated.png',
      name: 'generated.png',
      size: 1_234,
      type: 'image/png',
      originProvider: 'openai',
      originModel: 'gpt-image-1',
    })
  })

  it('keeps null provider/model for legacy rows instead of skipping them', async () => {
    mocks.filesFindMany.mockResolvedValue([
      {
        id: 'file-2',
        storageKey: 'legacy.png',
        name: 'legacy.png',
        size: 500,
        type: 'image/png',
        originProvider: null,
        originModel: null,
      },
    ])

    const result = await getOwnedGeneratedImageFilesByStorageKeys(1, [
      'legacy.png',
    ])

    expect(result.get('legacy.png')).toEqual({
      id: 'file-2',
      storageKey: 'legacy.png',
      name: 'legacy.png',
      size: 500,
      type: 'image/png',
      originProvider: null,
      originModel: null,
    })
  })
})

describe('getOwnedFilesByStorageKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('useDb', () => ({
      query: {
        files: {
          findMany: mocks.filesFindMany,
        },
      },
    }))
  })

  it('returns an empty map without querying when given no storage keys', async () => {
    const result = await getOwnedFilesByStorageKeys(1, [])

    expect(result.size).toBe(0)
    expect(mocks.filesFindMany).not.toHaveBeenCalled()
  })

  it('splits a large lookup into sequential chunks and merges the rows', async () => {
    const storageKeys = Array.from({ length: 200 }, (_unused, index) => {
      return `file-${index}.png`
    })

    mocks.filesFindMany.mockImplementation(async (query: any) => {
      return query.where.storageKey.in.map((storageKey: string) => ({
        id: `id-${storageKey}`,
        storageKey,
        size: 1,
      }))
    })

    const result = await getOwnedFilesByStorageKeys(1, [
      ...storageKeys,
      storageKeys[0]!,
    ])
    const chunkSizes = mocks.filesFindMany.mock.calls.map(([query]) => {
      return query.where.storageKey.in.length
    })

    expect(result.size).toBe(200)
    expect(chunkSizes).toEqual([90, 90, 20])
    expect(mocks.filesFindMany.mock.calls[0]?.[0].where.userId).toBe(1)
  })
})
