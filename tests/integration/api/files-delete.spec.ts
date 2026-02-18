import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  invalidateStorageCache: vi.fn(),
  invalidateFileCache: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
  }),
}))

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: mocks.invalidateStorageCache,
}))

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
      statusCode: 409,
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
})
