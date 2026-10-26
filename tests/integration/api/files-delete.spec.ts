import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  invalidateStorageCache: vi.fn(),
  invalidateFileCache: vi.fn(),
  findKnowledgeProjectIdsForFiles: vi.fn(),
  bumpKnowledgeVersion: vi.fn(),
}))

vi.mock('~~/server/utils/knowledge/linked-files', () => ({
  findKnowledgeProjectIdsForFiles: mocks.findKnowledgeProjectIdsForFiles,
}))

vi.mock('~~/server/utils/knowledge/version', () => ({
  bumpKnowledgeVersion: mocks.bumpKnowledgeVersion,
}))

vi.mock('evlog', () => ({
  createError: (input: {
    message: string
    status?: number
    why?: string
    fix?: string
  }) => {
    const exception = new Error(input.message)

    Object.assign(exception, input)

    return exception
  },
  useLogger: () => ({
    set: mocks.loggerSet,
  }),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: mocks.invalidateStorageCache,
}))

async function getBulkDeleteHandler() {
  const module = await import('../../../server/api/v1/files/delete/bulk.post')

  return module.default
}

async function getSingleDeleteHandler() {
  const module = await import('../../../server/api/v1/files/[id]/index.delete')

  return module.default
}

describe('files delete API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('defineEventHandler', (handler: any) => handler)
    vi.stubGlobal('createError', (input: any) => {
      const exception = new Error(input.statusMessage || input.message)

      Object.assign(exception, input)

      return exception
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw (globalThis as any).createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
      })
    })
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
    vi.stubGlobal('setResponseStatus', (_event: any, code: number, message: string) => {
      return { code, message }
    })
    vi.stubGlobal('invalidateFileCache', mocks.invalidateFileCache)
    vi.stubGlobal('readBody', async (event: { body: unknown }) => event.body)
    mocks.findKnowledgeProjectIdsForFiles.mockResolvedValue([])
    mocks.bumpKnowledgeVersion.mockResolvedValue(undefined)
    mocks.invalidateFileCache.mockResolvedValue(undefined)
    mocks.invalidateStorageCache.mockResolvedValue(undefined)
  })

  it('does not remove DB metadata when R2 delete fails', async () => {
    const singleDeleteHandler = await getSingleDeleteHandler()

    const findFirst = vi.fn().mockResolvedValue({
      storageKey: 'file-key-1',
    })
    const where = vi.fn()
    const deleteQuery = vi.fn(() => ({ where }))
    const deleteObject = vi.fn().mockRejectedValue(new Error('R2 failure'))

    vi.stubGlobal('useDb', () => ({
      query: {
        files: { findFirst },
      },
      delete: deleteQuery,
    }))
    vi.stubGlobal('useFileStorage', () => ({
      delete: deleteObject,
    }))

    await expect(singleDeleteHandler({
      context: {
        params: { id: 'file-1' },
      },
    } as any)).rejects.toMatchObject({
      status: 409,
    })

    expect(deleteQuery).not.toHaveBeenCalled()
    expect(mocks.invalidateStorageCache).not.toHaveBeenCalled()
  })

  it('invalidates file and storage caches after successful delete', async () => {
    const singleDeleteHandler = await getSingleDeleteHandler()

    const findFirst = vi.fn().mockResolvedValue({
      storageKey: 'file-key-1',
    })
    const where = vi.fn().mockResolvedValue(undefined)
    const deleteQuery = vi.fn(() => ({ where }))
    const deleteObject = vi.fn().mockResolvedValue(undefined)

    vi.stubGlobal('useDb', () => ({
      query: {
        files: { findFirst },
      },
      delete: deleteQuery,
    }))
    vi.stubGlobal('useFileStorage', () => ({
      delete: deleteObject,
    }))
    mocks.invalidateFileCache.mockResolvedValue(undefined)
    mocks.invalidateStorageCache.mockResolvedValue(undefined)

    await singleDeleteHandler({
      context: {
        params: { id: 'file-1' },
      },
    } as any)

    expect(mocks.invalidateFileCache).toHaveBeenCalledWith('file-key-1')
    expect(mocks.invalidateStorageCache).toHaveBeenCalledWith(1)
    expect(deleteQuery).toHaveBeenCalled()
    expect(where).toHaveBeenCalled()
  })

  describe('knowledge version bump', () => {
    function stubSingleFileDb(callOrder: string[]) {
      const findFirst = vi.fn().mockResolvedValue({
        storageKey: 'file-key-1',
      })
      const where = vi.fn(async () => {
        callOrder.push('delete-row')
      })

      vi.stubGlobal('useDb', () => ({
        query: {
          files: { findFirst },
        },
        delete: vi.fn(() => ({ where })),
      }))
      vi.stubGlobal('useFileStorage', () => ({
        delete: vi.fn(async () => {
          callOrder.push('delete-object')
        }),
      }))
    }

    it('bumps the projects that link the file before deleting it', async () => {
      const singleDeleteHandler = await getSingleDeleteHandler()
      const callOrder: string[] = []

      mocks.findKnowledgeProjectIdsForFiles.mockResolvedValue([4, 9])
      mocks.bumpKnowledgeVersion.mockImplementation(async () => {
        callOrder.push('bump')
      })
      stubSingleFileDb(callOrder)

      await singleDeleteHandler({
        context: { params: { id: 'file-1' } },
      } as any)

      expect(mocks.findKnowledgeProjectIdsForFiles).toHaveBeenCalledWith(
        1,
        ['file-1'],
      )
      expect(mocks.bumpKnowledgeVersion).toHaveBeenCalledTimes(2)
      expect(mocks.bumpKnowledgeVersion).toHaveBeenNthCalledWith(1, [4, 9])
      expect(mocks.bumpKnowledgeVersion).toHaveBeenNthCalledWith(2, [4, 9])
      expect(callOrder).toEqual([
        'bump',
        'delete-object',
        'delete-row',
        'bump',
      ])
    })

    it('keeps the collected projects for the bump after the delete', async () => {
      const singleDeleteHandler = await getSingleDeleteHandler()

      mocks.findKnowledgeProjectIdsForFiles.mockResolvedValue([4])
      stubSingleFileDb([])

      await singleDeleteHandler({
        context: { params: { id: 'file-1' } },
      } as any)

      expect(mocks.findKnowledgeProjectIdsForFiles).toHaveBeenCalledTimes(1)
    })

    it('does not fail the request when the bump after the delete fails', async () => {
      const singleDeleteHandler = await getSingleDeleteHandler()
      const callOrder: string[] = []

      mocks.findKnowledgeProjectIdsForFiles.mockResolvedValue([4])
      mocks.bumpKnowledgeVersion
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('D1 down'))
      stubSingleFileDb(callOrder)

      const response = await singleDeleteHandler({
        context: { params: { id: 'file-1' } },
      } as any)

      expect(response).toEqual({
        code: 204,
        message: 'File deleted successfully',
      })
      expect(callOrder).toEqual(['delete-object', 'delete-row'])
      expect(mocks.invalidateStorageCache).toHaveBeenCalledWith(1)
      expect(mocks.loggerSet).toHaveBeenCalledWith(expect.objectContaining({
        knowledgeVersionBump: { phase: 'after-delete', fileId: 'file-1' },
      }))
    })

    it('hands the bump no projects for a file without knowledge links', async () => {
      const singleDeleteHandler = await getSingleDeleteHandler()

      stubSingleFileDb([])

      await singleDeleteHandler({
        context: { params: { id: 'file-1' } },
      } as any)

      for (const [projectIds] of mocks.bumpKnowledgeVersion.mock.calls) {
        expect(projectIds).toEqual([])
      }
    })

    it('still deletes the file when the bump fails', async () => {
      const singleDeleteHandler = await getSingleDeleteHandler()
      const callOrder: string[] = []

      mocks.findKnowledgeProjectIdsForFiles.mockResolvedValue([4])
      mocks.bumpKnowledgeVersion.mockRejectedValue(new Error('D1 down'))
      stubSingleFileDb(callOrder)

      await singleDeleteHandler({
        context: { params: { id: 'file-1' } },
      } as any)

      expect(callOrder).toEqual(['delete-object', 'delete-row'])
      expect(mocks.loggerSet).toHaveBeenCalledWith(expect.objectContaining({
        knowledgeVersionBump: { phase: 'before-delete', fileId: 'file-1' },
      }))
    })

    it('bumps before and once after a bulk delete with every affected project', async () => {
      const bulkDeleteHandler = await getBulkDeleteHandler()
      const callOrder: string[] = []
      const findFirst = vi.fn(async () => ({ storageKey: 'key' }))
      const where = vi.fn(async () => {
        callOrder.push('delete-row')
      })

      mocks.findKnowledgeProjectIdsForFiles.mockResolvedValue([2, 3])
      mocks.bumpKnowledgeVersion.mockImplementation(async () => {
        callOrder.push('bump')
      })
      vi.stubGlobal('useDb', () => ({
        query: { files: { findFirst } },
        delete: vi.fn(() => ({ where })),
      }))
      vi.stubGlobal('useFileStorage', () => ({
        delete: vi.fn(async () => {
          callOrder.push('delete-object')
        }),
      }))

      await bulkDeleteHandler({
        body: { ids: ['file-1', 'file-2'] },
      } as any)

      expect(mocks.findKnowledgeProjectIdsForFiles).toHaveBeenCalledTimes(1)
      expect(mocks.findKnowledgeProjectIdsForFiles).toHaveBeenCalledWith(
        1,
        ['file-1', 'file-2'],
      )
      expect(mocks.bumpKnowledgeVersion).toHaveBeenCalledTimes(2)
      expect(mocks.bumpKnowledgeVersion).toHaveBeenNthCalledWith(1, [2, 3])
      expect(mocks.bumpKnowledgeVersion).toHaveBeenNthCalledWith(2, [2, 3])
      expect(callOrder).toEqual([
        'bump',
        'delete-object',
        'delete-row',
        'delete-object',
        'delete-row',
        'bump',
      ])
    })

    it('does not fail a bulk delete when the bump after it fails', async () => {
      const bulkDeleteHandler = await getBulkDeleteHandler()
      const where = vi.fn(async () => undefined)

      mocks.findKnowledgeProjectIdsForFiles.mockResolvedValue([2])
      mocks.bumpKnowledgeVersion
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('D1 down'))
      vi.stubGlobal('useDb', () => ({
        query: {
          files: { findFirst: vi.fn(async () => ({ storageKey: 'key' })) },
        },
        delete: vi.fn(() => ({ where })),
      }))
      vi.stubGlobal('useFileStorage', () => ({
        delete: vi.fn(async () => undefined),
      }))

      const response = await bulkDeleteHandler({
        body: { ids: ['file-1'] },
      } as any)

      expect(response).toEqual({
        code: 204,
        message: 'Files deleted successfully',
      })
      expect(where).toHaveBeenCalledTimes(1)
      expect(mocks.loggerSet).toHaveBeenCalledWith(expect.objectContaining({
        knowledgeVersionBump: { phase: 'after-delete', fileCount: 1 },
      }))
    })

    it('skips the bump after the delete when nothing was deleted', async () => {
      const bulkDeleteHandler = await getBulkDeleteHandler()

      mocks.findKnowledgeProjectIdsForFiles.mockResolvedValue([2])
      vi.stubGlobal('useDb', () => ({
        query: {
          files: { findFirst: vi.fn(async () => undefined) },
        },
      }))
      vi.stubGlobal('useFileStorage', () => ({ delete: vi.fn() }))

      await expect(bulkDeleteHandler({
        body: { ids: ['file-1'] },
      } as any)).rejects.toMatchObject({ status: 404 })

      expect(mocks.bumpKnowledgeVersion).toHaveBeenCalledTimes(1)
    })

    it('still bulk-deletes when collecting the projects fails', async () => {
      const bulkDeleteHandler = await getBulkDeleteHandler()
      const where = vi.fn(async () => undefined)

      mocks.findKnowledgeProjectIdsForFiles.mockRejectedValue(
        new Error('D1 down'),
      )
      vi.stubGlobal('useDb', () => ({
        query: {
          files: { findFirst: vi.fn(async () => ({ storageKey: 'key' })) },
        },
        delete: vi.fn(() => ({ where })),
      }))
      vi.stubGlobal('useFileStorage', () => ({
        delete: vi.fn(async () => undefined),
      }))

      await bulkDeleteHandler({ body: { ids: ['file-1'] } } as any)

      for (const [projectIds] of mocks.bumpKnowledgeVersion.mock.calls) {
        expect(projectIds).toEqual([])
      }

      expect(where).toHaveBeenCalledTimes(1)
    })

    it('does not bump for a file that is not found', async () => {
      const singleDeleteHandler = await getSingleDeleteHandler()

      vi.stubGlobal('useDb', () => ({
        query: {
          files: { findFirst: vi.fn().mockResolvedValue(undefined) },
        },
      }))

      await expect(singleDeleteHandler({
        context: { params: { id: 'file-1' } },
      } as any)).rejects.toMatchObject({ status: 404 })

      expect(mocks.findKnowledgeProjectIdsForFiles).not.toHaveBeenCalled()
      expect(mocks.bumpKnowledgeVersion).not.toHaveBeenCalled()
    })
  })
})
