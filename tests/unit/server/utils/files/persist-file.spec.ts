import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    put: vi.fn(),
    remove: vi.fn(),
    invalidateStorageCache: vi.fn(),
    logger: { set: vi.fn() },
  }
})

vi.mock('~~/server/api/v1/storage/index.get', () => {
  return { invalidateStorageCache: mocks.invalidateStorageCache }
})

vi.mock('~~/server/utils/files/file-governance', () => {
  return {
    getEffectiveUserFilePolicy: vi.fn(),
    getUserStorageUsageBytes: vi.fn(),
  }
})

const SECRET_NAME = 'patient-diagnosis-report.CSV'

describe('persistFile logging', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.put.mockReset()
    mocks.remove.mockReset()
    mocks.logger.set.mockReset()
    mocks.put.mockResolvedValue({ key: 'storage-key' })
    mocks.remove.mockResolvedValue(undefined)
    vi.stubGlobal('useFileStorage', () => {
      return { put: mocks.put, delete: mocks.remove }
    })
    vi.stubGlobal('useDb', () => {
      return {
        insert: () => {
          return {
            values: () => {
              return {
                returning: () => {
                  return {
                    get: async () => {
                      throw new Error('insert failed')
                    },
                  }
                },
              }
            },
          }
        },
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('describes a name by extension and length only', async () => {
    const { describeFileNameForLog } = await import(
      '~~/server/utils/files/persist-file'
    )

    expect(describeFileNameForLog(SECRET_NAME)).toEqual({
      fileExtension: 'csv',
      fileNameLength: SECRET_NAME.length,
    })
    expect(describeFileNameForLog('README')).toEqual({
      fileExtension: null,
      fileNameLength: 6,
    })
    expect(describeFileNameForLog('.env')).toEqual({
      fileExtension: null,
      fileNameLength: 4,
    })
  })

  it('never logs the file name when the row insert fails', async () => {
    const { persistFile } = await import('~~/server/utils/files/persist-file')

    await expect(persistFile({
      userId: 1,
      fileName: SECRET_NAME,
      mediaType: 'text/plain',
      fileData: new Uint8Array([1, 2, 3]),
      logger: mocks.logger,
      policy: {
        maxStorageBytes: 1000,
        fileRetentionDays: 30,
      } as never,
      totalFilesSize: 0,
    })).rejects.toMatchObject({ status: 500 })

    const logged = JSON.stringify(mocks.logger.set.mock.calls)

    expect(logged).not.toContain('patient-diagnosis')
    expect(logged).toContain('"fileExtension":"csv"')
    expect(logged).toContain(`"fileNameLength":${SECRET_NAME.length}`)
  })
})
