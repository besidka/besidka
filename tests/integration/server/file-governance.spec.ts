import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validateMessageFilePolicy } from '../../../server/utils/files/file-governance'

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
