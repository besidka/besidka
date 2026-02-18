import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FilePolicy } from '#shared/types/files.d'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  getEffectiveUserFilePolicy: vi.fn(),
  getUserStorageUsageBytes: vi.fn(),
  reserveImageTransformSlots: vi.fn(),
  releaseImageTransformSlots: vi.fn(),
  invalidateStorageCache: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
  }),
}))

vi.mock('~~/server/utils/files/file-governance', () => ({
  getEffectiveUserFilePolicy: mocks.getEffectiveUserFilePolicy,
  getUserStorageUsageBytes: mocks.getUserStorageUsageBytes,
  reserveImageTransformSlots: mocks.reserveImageTransformSlots,
  releaseImageTransformSlots: mocks.releaseImageTransformSlots,
}))

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: mocks.invalidateStorageCache,
}))

interface DbMockOptions {
  insertResult?: {
    id: string
    storageKey: string
    name: string
    size: number
    type: string
    source: 'upload' | 'assistant'
    expiresAt: Date | null
  }
  insertError?: Error
}

function createDbMock(options: DbMockOptions = {}) {
  const get = options.insertError
    ? vi.fn().mockRejectedValue(options.insertError)
    : vi.fn().mockResolvedValue(options.insertResult || {
      id: 'file-1',
      storageKey: 'stored-file-key',
      name: 'file',
      size: 1,
      type: 'text/plain',
      source: 'upload',
      expiresAt: null,
    })
  const returning = vi.fn(() => ({ get }))
  const values = vi.fn(() => ({ returning }))
  const insert = vi.fn(() => ({ values }))

  return {
    db: { insert },
    spies: { insert, values, returning, get },
  }
}

function createEvent(headers: Record<string, string>) {
  return { headers }
}

function createFilePolicy(overrides: Partial<FilePolicy> = {}): FilePolicy {
  return {
    tier: 'free',
    maxStorageBytes: 20 * 1024 * 1024,
    maxFilesPerMessage: 10,
    maxMessageFilesBytes: 1000 * 1024 * 1024,
    fileRetentionDays: 30,
    imageTransformLimitTotal: 0,
    imageTransformUsedTotal: 0,
    ...overrides,
  }
}

async function getHandler() {
  const module = await import('../../../server/api/v1/files/upload.put')

  return module.default
}

describe('files upload API', () => {
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
    vi.stubGlobal('readRawBody', vi.fn().mockResolvedValue(Buffer.from('data')))
    vi.stubGlobal('getRequestHeader', (event: any, key: string) => {
      return event.headers[key.toLowerCase()]
    })
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: {
        allowedFileFormats: [
          'image/png',
          'image/jpeg',
          'image/webp',
          'application/pdf',
          'text/plain',
        ],
        maxFilesPerMessage: 10,
        maxMessageFilesBytes: 1000 * 1024 * 1024,
      },
      filesHardMaxStorageBytes: 5 * 1024 * 1024 * 1024,
      filesGlobalTransformLimitMonthly: 1000,
    }))
    mocks.getEffectiveUserFilePolicy.mockResolvedValue(createFilePolicy())
    mocks.getUserStorageUsageBytes.mockResolvedValue(0)
    mocks.reserveImageTransformSlots.mockResolvedValue({
      reserved: false,
      used: 0,
      limit: 0,
      reason: 'disabled',
    })
    vi.stubGlobal('useImageTransform', vi.fn())
  })

  it('rejects unauthorized upload', async () => {
    const handler = await getHandler()

    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    await expect(handler(createEvent({} as any) as any)).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('rejects upload when required headers are missing', async () => {
    const handler = await getHandler()

    await expect(handler(createEvent({
      'content-type': 'text/plain',
    }) as any)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Missing required headers',
    })
  })

  it('enforces quota using real body size, not X-Filesize header', async () => {
    const handler = await getHandler()

    vi.stubGlobal('readRawBody', vi.fn().mockResolvedValue(Buffer.from('123456')))
    mocks.getEffectiveUserFilePolicy.mockResolvedValue(createFilePolicy({
      maxStorageBytes: 10,
    }))
    mocks.getUserStorageUsageBytes.mockResolvedValue(5)
    const { db } = createDbMock()
    const put = vi.fn().mockResolvedValue({ key: 'stored.txt' })

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useFileStorage', () => ({ put, delete: vi.fn() }))

    await expect(handler(createEvent({
      'content-type': 'text/plain',
      'x-filename': encodeURIComponent('notes.txt'),
      'x-filesize': '1',
    }) as any)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('normalizes content-type parameters before persistence', async () => {
    const handler = await getHandler()

    const { db, spies } = createDbMock({
      insertResult: {
        id: 'file-1',
        storageKey: 'stored.txt',
        name: 'notes.txt',
        size: 4,
        type: 'text/plain',
        source: 'upload',
        expiresAt: new Date(),
      },
    })
    const put = vi.fn().mockResolvedValue({ key: 'stored.txt' })

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useFileStorage', () => ({
      put,
      delete: vi.fn(),
    }))

    const result = await handler(createEvent({
      'content-type': 'text/plain; charset=utf-8',
      'x-filename': encodeURIComponent('notes.txt'),
      'x-filesize': '4',
    }) as any)

    expect(result.type).toBe('text/plain')
    expect(put.mock.calls[0]?.[0]).toMatch(/\.txt$/)
    expect(put.mock.calls[0]?.[2]?.httpMetadata?.contentType)
      .toBe('text/plain')
    expect(spies.values.mock.calls[0]?.[0]?.expiresAt)
      .toBeInstanceOf(Date)
  })

  it('stores vip uploads without expiry date', async () => {
    const handler = await getHandler()

    mocks.getEffectiveUserFilePolicy.mockResolvedValue(createFilePolicy({
      tier: 'vip',
      fileRetentionDays: null,
    }))
    const { db, spies } = createDbMock({
      insertResult: {
        id: 'file-1',
        storageKey: 'stored.txt',
        name: 'vip-notes.txt',
        size: 4,
        type: 'text/plain',
        source: 'upload',
        expiresAt: null,
      },
    })
    const put = vi.fn().mockResolvedValue({ key: 'stored.txt' })

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useFileStorage', () => ({
      put,
      delete: vi.fn(),
    }))

    await handler(createEvent({
      'content-type': 'text/plain',
      'x-filename': encodeURIComponent('vip-notes.txt'),
      'x-filesize': '4',
    }) as any)

    expect(spies.values.mock.calls[0]?.[0]?.expiresAt).toBeNull()
  })

  it('transforms image when user and global budgets are available', async () => {
    const handler = await getHandler()

    const { db } = createDbMock({
      insertResult: {
        id: 'file-1',
        storageKey: 'stored.webp',
        name: 'img.png',
        size: 123,
        type: 'image/webp',
        source: 'upload',
        expiresAt: new Date(),
      },
    })
    const put = vi.fn().mockResolvedValue({ key: 'stored.webp' })
    const del = vi.fn().mockResolvedValue(undefined)

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useFileStorage', () => ({ put, delete: del }))
    mocks.reserveImageTransformSlots.mockResolvedValue({
      reserved: true,
      used: 1,
      limit: 100,
    })
    vi.stubGlobal('useImageTransform', () => ({
      input: () => ({
        transform: () => ({
          output: () => ({
            response: () => ({
              body: new Blob(['webp-data']).stream(),
            }),
          }),
        }),
      }),
    }))

    const result = await handler(createEvent({
      'content-type': 'image/png',
      'x-filename': encodeURIComponent('img.png'),
      'x-filesize': '8',
    }) as any)

    expect(result.type).toBe('image/webp')
    expect(result.source).toBe('upload')
    expect(put).toHaveBeenCalled()
    expect(put.mock.calls[0]?.[0]).toMatch(/\.webp$/)
    expect(put.mock.calls[0]?.[2]?.httpMetadata?.contentType)
      .toBe('image/webp')
  })

  it('skips transform and stores original image when budget is unavailable', async () => {
    const handler = await getHandler()

    const { db } = createDbMock({
      insertResult: {
        id: 'file-1',
        storageKey: 'stored.png',
        name: 'img.png',
        size: 123,
        type: 'image/png',
        source: 'upload',
        expiresAt: new Date(),
      },
    })
    const put = vi.fn().mockResolvedValue({ key: 'stored.png' })

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useFileStorage', () => ({
      put,
      delete: vi.fn(),
    }))
    mocks.reserveImageTransformSlots.mockResolvedValue({
      reserved: false,
      used: 100,
      limit: 100,
      reason: 'user-limit',
    })

    const result = await handler(createEvent({
      'content-type': 'image/png',
      'x-filename': encodeURIComponent('img.png'),
      'x-filesize': '8',
    }) as any)

    expect(result.type).toBe('image/png')
    expect(result.source).toBe('upload')
    expect(put.mock.calls[0]?.[0]).toMatch(/\.png$/)
    expect(put.mock.calls[0]?.[2]?.httpMetadata?.contentType)
      .toBe('image/png')
  })

  it('rolls back uploaded R2 object when DB insert fails', async () => {
    const handler = await getHandler()

    const { db } = createDbMock({
      insertError: new Error('insert failed'),
    })
    const put = vi.fn().mockResolvedValue({ key: 'stored.txt' })
    const remove = vi.fn().mockResolvedValue(undefined)

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useFileStorage', () => ({
      put,
      delete: remove,
    }))

    await expect(handler(createEvent({
      'content-type': 'text/plain',
      'x-filename': encodeURIComponent('note.txt'),
      'x-filesize': '4',
    }) as any)).rejects.toMatchObject({
      statusCode: 500,
    })

    expect(remove).toHaveBeenCalledWith('stored.txt')
  })
})
