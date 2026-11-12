import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FilePolicy } from '#shared/types/files.d'
import { OFFICE_MEDIA_TYPES } from '#shared/utils/office-files'
import {
  docxPackage,
  paragraphXml,
  xlsxPackage,
  worksheetXml,
} from '../../fixtures/documents/extract/builders'

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  getEffectiveUserFilePolicy: vi.fn(),
  getUserStorageUsageBytes: vi.fn(),
  reserveImageTransformSlots: vi.fn(),
  releaseImageTransformSlots: vi.fn(),
  invalidateStorageCache: vi.fn(),
  evaluateFeatureForEvent: vi.fn(),
  extractOfficeText: vi.fn(),
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

vi.mock('~~/server/utils/files/file-governance', () => ({
  getEffectiveUserFilePolicy: mocks.getEffectiveUserFilePolicy,
  getUserStorageUsageBytes: mocks.getUserStorageUsageBytes,
  reserveImageTransformSlots: mocks.reserveImageTransformSlots,
  releaseImageTransformSlots: mocks.releaseImageTransformSlots,
}))

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: mocks.invalidateStorageCache,
}))

vi.mock('~~/server/utils/features/context', () => ({
  evaluateFeatureForEvent: mocks.evaluateFeatureForEvent,
}))

vi.mock('~~/server/utils/documents/renderer', () => ({
  extractOfficeText: mocks.extractOfficeText,
}))

const DOCX_TYPE = OFFICE_MEDIA_TYPES.docx
const STORED_KEY = 'stored-uuid.docx'

function createFilePolicy(): FilePolicy {
  return {
    tier: 'free',
    maxStorageBytes: 20 * 1024 * 1024,
    maxFilesPerMessage: 10,
    maxMessageFilesBytes: 1000 * 1024 * 1024,
    fileRetentionDays: 30,
    imageTransformLimitTotal: 0,
    imageTransformUsedTotal: 0,
  }
}

function createDbMock() {
  const get = vi.fn().mockResolvedValue({
    id: 'file-1',
    storageKey: STORED_KEY,
    name: 'report.docx',
    size: 1,
    type: DOCX_TYPE,
    source: 'upload',
    expiresAt: null,
  })
  const insertValues = vi.fn(() => ({ returning: vi.fn(() => ({ get })) }))
  const updateWhere = vi.fn().mockResolvedValue(undefined)
  const updateSet = vi.fn(() => ({ where: updateWhere }))

  return {
    db: {
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: updateSet })),
    },
    spies: { insertValues, updateSet },
  }
}

function createEvent(
  headers: Record<string, string>,
  bytes: Uint8Array,
) {
  return {
    headers: {
      'content-length': String(bytes.byteLength),
      ...headers,
    },
    context: {},
    req: {
      body: new Blob([bytes as BlobPart]).stream(),
    },
  }
}

async function getHandler(route: 'upload.put' | 'create.post' = 'upload.put') {
  const module = await import(`../../../server/api/v1/files/${route}`)

  return module.default
}

function validDocx(): Uint8Array {
  return docxPackage(paragraphXml('Quarterly numbers'))
}

describe('Office uploads', () => {
  let storagePut: ReturnType<typeof vi.fn>
  let storageDelete: ReturnType<typeof vi.fn>
  let dbMock: ReturnType<typeof createDbMock>

  function stubStorage() {
    storagePut = vi.fn(async (key: string) => ({ key }))
    storageDelete = vi.fn().mockResolvedValue(undefined)
    dbMock = createDbMock()
    vi.stubGlobal('useDb', () => dbMock.db)
    vi.stubGlobal('useFileStorage', () => ({
      put: storagePut,
      delete: storageDelete,
    }))
    vi.stubGlobal('crypto', {
      ...globalThis.crypto,
      randomUUID: () => 'stored-uuid',
    })
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('defineEventHandler', (handler: any) => handler)
    vi.stubGlobal('createError', (input: any) => {
      return Object.assign(new Error(input.message), input)
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw new Error('Unauthorized')
    })
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
    vi.stubGlobal('getRequestHeader', (event: any, key: string) => {
      return event.headers[key.toLowerCase()]
    })
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: {
        allowedFileFormats: [
          'image/png',
          'application/pdf',
          'text/plain',
        ],
      },
    }))
    vi.stubGlobal('useImageTransform', vi.fn())
    mocks.getEffectiveUserFilePolicy.mockResolvedValue(createFilePolicy())
    mocks.getUserStorageUsageBytes.mockResolvedValue(0)
    mocks.evaluateFeatureForEvent.mockResolvedValue({ active: true })
    mocks.extractOfficeText.mockResolvedValue({
      status: 'ready',
      text: '# Quarterly numbers',
      truncated: false,
      stats: { inputBytes: 1, entries: 1, textBytes: 19, truncations: [] },
    })
    stubStorage()
  })

  it('rejects an Office upload exactly as before when the flag is off', async () => {
    mocks.evaluateFeatureForEvent.mockResolvedValue({ active: false })
    const handler = await getHandler()

    await expect(handler(createEvent({
      'content-type': DOCX_TYPE,
      'x-filename': encodeURIComponent('report.docx'),
    }, validDocx()) as any)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/^File type must be one of: image\/png,/),
    })
    expect(storagePut).not.toHaveBeenCalled()
  })

  it('keeps the missing-header error for an untyped Office upload with the flag off', async () => {
    mocks.evaluateFeatureForEvent.mockResolvedValue({ active: false })
    const handler = await getHandler()

    await expect(handler(createEvent({
      'x-filename': encodeURIComponent('report.docx'),
    }, validDocx()) as any)).rejects.toMatchObject({
      status: 400,
      message: 'Missing required headers',
    })
  })

  it('does not evaluate the flag for a non-Office upload', async () => {
    const handler = await getHandler()

    await handler(createEvent({
      'content-type': 'text/plain',
      'x-filename': encodeURIComponent('notes.txt'),
    }, new TextEncoder().encode('hello')) as any)

    expect(mocks.evaluateFeatureForEvent).not.toHaveBeenCalled()
  })

  for (const route of ['upload.put', 'create.post'] as const) {
    describe(route, () => {
      for (const declaredType of [
        'application/octet-stream',
        'application/zip',
        'text/plain',
        '',
      ]) {
        it(`stores a docx declared as "${declaredType}" with its text`, async () => {
          const handler = await getHandler(route)
          const headers: Record<string, string> = {
            'x-filename': encodeURIComponent('report.docx'),
          }

          if (declaredType) {
            headers['content-type'] = declaredType
          }

          const result = await handler(
            createEvent(headers, validDocx()) as any,
          )

          expect(storagePut).toHaveBeenCalledTimes(2)
          expect(storagePut.mock.calls[0]?.[0]).toBe(STORED_KEY)
          expect(storagePut.mock.calls[0]?.[2]?.httpMetadata?.contentType)
            .toBe(DOCX_TYPE)
          expect(dbMock.spies.insertValues.mock.calls[0]?.[0]?.type)
            .toBe(DOCX_TYPE)

          const [sidecarKey, sidecarBytes] = storagePut.mock.calls[1] ?? []

          expect(sidecarKey).toBe(`${STORED_KEY}.text.md`)
          expect(new TextDecoder().decode(sidecarBytes))
            .toBe('# Quarterly numbers')
          expect(dbMock.spies.updateSet).toHaveBeenCalledWith({
            textStatus: 'ready',
            textBytes: 19,
            textVersion: 1,
          })
          expect(result).toMatchObject({
            id: 'file-1',
            textStatus: 'ready',
            textBytes: 19,
          })
        })
      }

      it('stores an xlsx under its own media type', async () => {
        const handler = await getHandler(route)

        await handler(createEvent({
          'content-type': 'application/zip',
          'x-filename': encodeURIComponent('data.xlsx'),
        }, xlsxPackage([
          { name: 'Sheet1', xml: worksheetXml('') },
        ])) as any)

        expect(dbMock.spies.insertValues.mock.calls[0]?.[0]?.type)
          .toBe(OFFICE_MEDIA_TYPES.xlsx)
        expect(storagePut.mock.calls[0]?.[0]).toMatch(/\.xlsx$/)
      })
    })
  }

  it('rejects legacy files with a save-as hint', async () => {
    const handler = await getHandler()

    for (const name of ['old.doc', 'old.xls', 'old.ppt']) {
      await expect(handler(createEvent({
        'content-type': 'application/msword',
        'x-filename': encodeURIComponent(name),
      }, validDocx()) as any)).rejects.toMatchObject({
        status: 400,
        fix: expect.stringMatching(/\.docx, \.xlsx or \.pptx/),
      })
    }

    expect(storagePut).not.toHaveBeenCalled()
  })

  it('rejects macro-enabled files', async () => {
    const handler = await getHandler()

    await expect(handler(createEvent({
      'content-type': DOCX_TYPE,
      'x-filename': encodeURIComponent('macro.docm'),
    }, validDocx()) as any)).rejects.toMatchObject({
      status: 400,
      why: expect.stringMatching(/Macro-enabled/),
    })
  })

  it('rejects a renamed legacy file whose bytes are a compound file', async () => {
    const handler = await getHandler()
    const compound = new Uint8Array(64)

    compound.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

    await expect(handler(createEvent({
      'content-type': DOCX_TYPE,
      'x-filename': encodeURIComponent('renamed.docx'),
    }, compound) as any)).rejects.toMatchObject({
      status: 400,
      why: expect.stringMatching(/legacy or password-protected/),
    })
    expect(storagePut).not.toHaveBeenCalled()
  })

  it('rejects an Office file over 20 MB before reading it', async () => {
    mocks.getEffectiveUserFilePolicy.mockResolvedValue({
      ...createFilePolicy(),
      maxStorageBytes: 100 * 1024 * 1024,
    })
    const handler = await getHandler()
    const event = createEvent({
      'content-type': DOCX_TYPE,
      'x-filename': encodeURIComponent('big.docx'),
      'content-length': String(21 * 1024 * 1024),
    }, validDocx())

    await expect(handler(event as any)).rejects.toMatchObject({
      status: 400,
      why: expect.stringMatching(/limited to 20\.0 MB/),
    })
  })

  it('stops reading an Office stream at 20 MB when no length was sent', async () => {
    mocks.getEffectiveUserFilePolicy.mockResolvedValue({
      ...createFilePolicy(),
      maxStorageBytes: 100 * 1024 * 1024,
    })
    const handler = await getHandler()
    const event = createEvent({
      'content-type': DOCX_TYPE,
      'x-filename': encodeURIComponent('big.docx'),
      'content-length': '',
    }, new Uint8Array(21 * 1024 * 1024))

    await expect(handler(event as any)).rejects.toMatchObject({
      status: 400,
      why: expect.stringMatching(/limited to 20\.0 MB/),
    })
    expect(storagePut).not.toHaveBeenCalled()
  })

  it('does not fail the upload when the extraction fails', async () => {
    mocks.extractOfficeText.mockResolvedValue({
      status: 'failed',
      text: '',
      truncated: false,
      stats: { inputBytes: 1, entries: 0, textBytes: 0, truncations: [] },
      errorCode: 'ooxml_malformed',
    })
    const handler = await getHandler()

    const result = await handler(createEvent({
      'content-type': DOCX_TYPE,
      'x-filename': encodeURIComponent('report.docx'),
    }, validDocx()) as any)

    expect(result).toMatchObject({ id: 'file-1', textStatus: 'failed' })
    expect(storagePut).toHaveBeenCalledTimes(1)
    expect(dbMock.spies.updateSet).toHaveBeenCalledWith({
      textStatus: 'failed',
      textBytes: null,
      textVersion: 1,
    })
  })

  it('leaves the status empty when the renderer is unavailable', async () => {
    mocks.extractOfficeText.mockResolvedValue({
      status: 'failed',
      text: '',
      truncated: false,
      stats: { inputBytes: 1, entries: 0, textBytes: 0, truncations: [] },
      errorCode: 'renderer_unavailable',
    })
    const handler = await getHandler()

    const result = await handler(createEvent({
      'content-type': DOCX_TYPE,
      'x-filename': encodeURIComponent('report.docx'),
    }, validDocx()) as any)

    expect(result).toMatchObject({ id: 'file-1', textStatus: null })
    expect(dbMock.spies.updateSet).not.toHaveBeenCalled()
  })

  it('does not fail the upload when the extraction call throws', async () => {
    mocks.extractOfficeText.mockRejectedValue(new Error('binding exploded'))
    const handler = await getHandler()

    const result = await handler(createEvent({
      'content-type': DOCX_TYPE,
      'x-filename': encodeURIComponent('report.docx'),
    }, validDocx()) as any)

    expect(result).toMatchObject({ id: 'file-1', textStatus: null })
  })

  it('does not fail the upload when the sidecar write fails', async () => {
    storagePut.mockImplementation(async (key: string) => {
      if (key.endsWith('.text.md')) {
        throw new Error('R2 down')
      }

      return { key }
    })
    const handler = await getHandler()

    const result = await handler(createEvent({
      'content-type': DOCX_TYPE,
      'x-filename': encodeURIComponent('report.docx'),
    }, validDocx()) as any)

    expect(result).toMatchObject({ id: 'file-1', textStatus: null })
    expect(dbMock.spies.updateSet).not.toHaveBeenCalled()
  })

  it('removes the sidecar when the status cannot be saved', async () => {
    dbMock.db.update.mockImplementation(() => {
      throw new Error('D1 down')
    })
    const handler = await getHandler()

    const result = await handler(createEvent({
      'content-type': DOCX_TYPE,
      'x-filename': encodeURIComponent('report.docx'),
    }, validDocx()) as any)

    expect(result).toMatchObject({ id: 'file-1', textStatus: null })
    expect(storageDelete).toHaveBeenCalledWith([`${STORED_KEY}.text.md`])
  })

  it('treats a flag evaluation failure as off', async () => {
    mocks.evaluateFeatureForEvent.mockRejectedValue(new Error('KV down'))
    const handler = await getHandler()

    await expect(handler(createEvent({
      'content-type': DOCX_TYPE,
      'x-filename': encodeURIComponent('report.docx'),
    }, validDocx()) as any)).rejects.toMatchObject({ status: 400 })
  })
})
