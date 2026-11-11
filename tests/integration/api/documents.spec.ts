import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createError } from 'evlog'
import * as schema from '~~/server/db/schema'
import {
  DOCUMENT_FILE_RATE_LIMIT_PER_MINUTE,
  DOCUMENT_MAX_FILE_BYTES,
  DOCUMENT_RENDER_RATE_LIMIT_PER_MINUTE,
} from '#shared/utils/documents'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedMessage,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import {
  createFakeDocumentStorage,
  readDocument,
  seedDocument,
} from '../../setup/helpers/documents-db'
import type {
  FakeDocumentStorage,
} from '../../setup/helpers/documents-db'

const mocks = vi.hoisted(() => ({
  featureActive: true,
  requireFeature: vi.fn(),
  logger: { set: vi.fn() },
  sessionUserId: 0,
  testDb: null as unknown as { db: any },
  validateDocumentBytes: vi.fn(),
  renderDocument: vi.fn(),
  persistFile: vi.fn(),
  deleteOwnedFile: vi.fn(),
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/features/guards', () => ({
  requireFeature: mocks.requireFeature,
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

vi.mock('~~/server/utils/documents/renderer', async () => {
  const actual = await vi.importActual<
    typeof import('~~/server/utils/documents/renderer')
  >('~~/server/utils/documents/renderer')

  return {
    getRenderFailureStatus: actual.getRenderFailureStatus,
    validateDocumentBytes: (...args: unknown[]) => {
      return mocks.validateDocumentBytes(...args)
    },
    renderDocument: (...args: unknown[]) => mocks.renderDocument(...args),
  }
})

vi.mock('~~/server/utils/files/persist-file', () => ({
  persistFile: (...args: unknown[]) => mocks.persistFile(...args),
}))

vi.mock('~~/server/utils/files/delete-files', () => ({
  deleteOwnedFile: (...args: unknown[]) => mocks.deleteOwnedFile(...args),
}))

const { createDocumentTool } = await import(
  '~~/server/utils/documents/create-document-tool'
)
const { createDocument } = await import('~~/server/utils/documents/store')

async function importHandler(path: string) {
  const module = await import(path)

  return module.default as (event: unknown) => Promise<any>
}

const handlers = {
  status: () => importHandler(
    '../../../server/api/v1/documents/[id]/index.get',
  ),
  spec: () => importHandler(
    '../../../server/api/v1/documents/[id]/spec.get',
  ),
  file: () => importHandler(
    '../../../server/api/v1/documents/[id]/file.post',
  ),
  render: () => importHandler(
    '../../../server/api/v1/documents/[id]/render.post',
  ),
}

const PDF_SPEC = {
  specVersion: 1,
  format: 'pdf',
  title: 'Trip plan',
  pageSize: 'A4',
  blocks: [{ type: 'paragraph', runs: [{ text: 'Leave on Friday' }] }],
}

const XLSX_SPEC = {
  specVersion: 1,
  format: 'xlsx',
  title: 'Budget',
  sheets: [{
    name: 'Budget',
    columns: [{ header: 'Item', type: 'string' }],
    rows: [['Rent']],
  }],
}

const DOCUMENT_BYTES = new Uint8Array([37, 80, 68, 70, 45, 49])
const IMAGE_BYTES = new Uint8Array([137, 80, 78, 71, 1, 2, 3])

interface EventInput {
  documentId: string
  body?: Uint8Array
  headers?: Record<string, string | null>
}

function createEvent(input: EventInput) {
  const headers = new Headers()

  for (const [name, value] of Object.entries(input.headers ?? {})) {
    if (value !== null) {
      headers.set(name, value)
    }
  }

  return {
    context: {},
    params: { id: input.documentId },
    req: new Request('http://localhost/api/v1/documents', {
      method: input.body ? 'POST' : 'GET',
      body: input.body ? input.body.slice() : undefined,
      headers,
    }),
    res: { headers: new Headers() },
  }
}

function createUploadEvent(
  documentId: string,
  options: {
    format?: string | null
    contentLength?: string | null
    body?: Uint8Array
  } = {},
) {
  const body = options.body ?? DOCUMENT_BYTES
  const contentLength = options.contentLength === undefined
    ? String(body.byteLength)
    : options.contentLength

  return createEvent({
    documentId,
    body,
    headers: {
      'content-type': 'application/octet-stream',
      'x-document-format': options.format === undefined
        ? 'pdf'
        : options.format,
      'content-length': contentLength,
    },
  })
}

function createQuotaError() {
  return createError({
    message: 'Not enough storage space. Please delete some files.',
    status: 400,
  })
}

function createRendererUnavailableError() {
  return createError({
    message: 'Document rendering is unavailable',
    status: 503,
    why: 'The DOC_RENDERER call failed',
  })
}

describe('documents API', () => {
  let testDb: MemoryExtractionTestDb
  let storage: FakeDocumentStorage
  let imageObjects: Map<string, Uint8Array>
  let kvStore: Map<string, string>
  let ownerId: number
  let strangerId: number
  let chatId: string
  let fileSequence: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    mocks.testDb = testDb
    storage = createFakeDocumentStorage()
    imageObjects = new Map()
    kvStore = new Map()
    fileSequence = 0
    ownerId = await seedUser(testDb.db, null)
    strangerId = await seedUser(testDb.db, null)
    chatId = (await seedChat(testDb.db, ownerId)).id
    mocks.sessionUserId = ownerId
    mocks.featureActive = true
    mocks.logger.set.mockClear()
    mocks.requireFeature.mockReset()
    mocks.requireFeature.mockImplementation(async () => {
      if (!mocks.featureActive) {
        throw Object.assign(new Error('Not found'), { status: 404 })
      }

      return { active: true }
    })
    mocks.validateDocumentBytes.mockReset()
    mocks.validateDocumentBytes.mockResolvedValue({
      ok: true,
      stats: { bytes: DOCUMENT_BYTES.byteLength },
      provenance: 'ai',
    })
    mocks.renderDocument.mockReset()
    mocks.renderDocument.mockResolvedValue({
      ok: true,
      bytes: DOCUMENT_BYTES,
      mediaType: 'application/pdf',
      extension: 'pdf',
      stats: { pages: 1 },
      rendererVersion: '1.0.0+1.0.0',
    })
    mocks.deleteOwnedFile.mockReset()
    mocks.deleteOwnedFile.mockResolvedValue('deleted')
    mocks.persistFile.mockReset()
    mocks.persistFile.mockImplementation(async (input: {
      userId: number
      fileName: string
      mediaType: string
      fileData: Uint8Array
      originMessageId?: number | null
    }) => {
      fileSequence += 1

      const [file] = await testDb.db.insert(schema.files).values({
        userId: input.userId,
        storageKey: `stored-${fileSequence}.bin`,
        name: input.fileName,
        size: input.fileData.byteLength,
        type: input.mediaType,
        source: 'assistant',
        originMessageId: input.originMessageId ?? null,
      }).returning({
        id: schema.files.id,
        storageKey: schema.files.storageKey,
        name: schema.files.name,
        size: schema.files.size,
        type: schema.files.type,
        source: schema.files.source,
        expiresAt: schema.files.expiresAt,
      })

      return file
    })

    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useFileStorage', () => ({
      ...storage,
      get: async (key: string) => {
        const imageBytes = imageObjects.get(key)

        if (imageBytes) {
          return { arrayBuffer: async () => imageBytes.buffer }
        }

        return storage.get(key)
      },
    }))
    vi.stubGlobal('useKV', () => ({
      get: async (key: string) => kvStore.get(key) ?? null,
      put: async (key: string, value: string) => {
        kvStore.set(key, value)
      },
    }))
    vi.stubGlobal('useUserSession', async () => {
      return mocks.sessionUserId
        ? { user: { id: String(mocks.sessionUserId) } }
        : null
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
      return event.params
    })
    vi.stubGlobal('getRequestHeader', (
      event: { req: Request },
      name: string,
    ) => {
      return event.req.headers.get(name) ?? undefined
    })
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  async function createRowWithTool(
    spec: unknown = PDF_SPEC,
    userId: number = ownerId,
  ): Promise<string> {
    const tools = createDocumentTool({
      userId,
      chatId,
      db: testDb.db,
      logger: mocks.logger,
      enabledFormats: ['pdf', 'docx', 'pptx', 'xlsx'],
      modelId: 'claude-haiku-4-5',
      provider: 'anthropic',
      assistantMessageId: 'ASSISTANT-ULID',
    })
    const output = await (tools.create_document as unknown as {
      execute: (input: unknown, options: unknown) => Promise<{
        documentId: string
      }>
    }).execute(spec, {})

    return output.documentId
  }

  async function seedOwnedImage(): Promise<{ id: string, storageKey: string }> {
    const [file] = await testDb.db.insert(schema.files).values({
      userId: ownerId,
      storageKey: 'picture.png',
      name: 'picture.png',
      size: IMAGE_BYTES.byteLength,
      type: 'image/png',
    }).returning({
      id: schema.files.id,
      storageKey: schema.files.storageKey,
    })

    imageObjects.set(file!.storageKey, IMAGE_BYTES)

    return file!
  }

  async function expectRejection(
    promise: Promise<unknown>,
    expected: { status: number, why?: string },
  ) {
    const exception = await promise.then(() => null, error => error)

    expect(exception).not.toBeNull()
    expect(exception.status).toBe(expected.status)

    if (expected.why !== undefined) {
      expect(exception.why).toBe(expected.why)
    }

    return exception
  }

  describe('POST /documents/:id/file', () => {
    it('validates the bytes, stores the file and marks the row ready', async () => {
      const documentId = await createRowWithTool()
      const handler = await handlers.file()

      const result = await handler(createUploadEvent(documentId))
      const row = await readDocument(testDb.db, documentId)

      expect(result.status).toBe('ready')
      expect(result.file).toMatchObject({
        name: 'Trip plan.pdf',
        type: 'application/pdf',
        size: DOCUMENT_BYTES.byteLength,
      })
      expect(row).toMatchObject({
        status: 'ready',
        renderedBy: 'client',
        fileId: result.file.id,
        errorCode: null,
        renderLeaseUntil: null,
        renderAttempts: 1,
      })
      expect(mocks.validateDocumentBytes).toHaveBeenCalledTimes(1)

      const [request] = mocks.validateDocumentBytes.mock.calls[0]!

      expect(request.format).toBe('pdf')
      expect(Array.from(request.bytes)).toEqual(Array.from(DOCUMENT_BYTES))
      expect(request.spec).toBeUndefined()
      expect(mocks.persistFile).toHaveBeenCalledWith(expect.objectContaining({
        userId: ownerId,
        fileName: 'Trip plan.pdf',
        mediaType: 'application/pdf',
        source: 'assistant',
        originMessageId: null,
        originProvider: 'anthropic',
        originModel: 'claude-haiku-4-5',
        logger: mocks.logger,
      }))
    })

    it('links the file to the assistant message once it is persisted', async () => {
      await seedMessage(
        testDb.db,
        chatId,
        'assistant',
        [],
        new Date(),
        { publicId: 'ASSISTANT-ULID' },
      )

      const documentId = await createRowWithTool()
      const handler = await handlers.file()

      await handler(createUploadEvent(documentId))

      const [firstCall] = mocks.persistFile.mock.calls[0]!

      expect(firstCall.originMessageId).toBe(1)
    })

    it('hands the stored spec to the validator for a workbook', async () => {
      const documentId = await createRowWithTool(XLSX_SPEC)
      const handler = await handlers.file()

      await handler(createUploadEvent(documentId, { format: 'xlsx' }))

      const [request] = mocks.validateDocumentBytes.mock.calls[0]!

      expect(request.format).toBe('xlsx')
      expect(request.spec).toEqual(XLSX_SPEC)
    })

    it('answers 422 with the validator code and fails the row', async () => {
      mocks.validateDocumentBytes.mockResolvedValue({
        ok: false,
        code: 'pdf_javascript',
        detail: 'Contains /JavaScript with secret detail',
      })

      const documentId = await createRowWithTool()
      const handler = await handlers.file()
      const exception = await expectRejection(
        handler(createUploadEvent(documentId)),
        { status: 422, why: 'pdf_javascript' },
      )
      const row = await readDocument(testDb.db, documentId)

      expect(JSON.stringify(exception)).not.toContain('secret detail')
      expect(row).toMatchObject({
        status: 'failed',
        errorCode: 'pdf_javascript',
        fileId: null,
      })
      expect(mocks.persistFile).not.toHaveBeenCalled()
    })

    it.each(['missing', 'channel-only'])(
      'refuses a file whose provenance is %s',
      async (provenance) => {
        mocks.validateDocumentBytes.mockResolvedValue({
          ok: true,
          stats: { bytes: 6 },
          provenance,
        })

        const documentId = await createRowWithTool()
        const handler = await handlers.file()

        await expectRejection(
          handler(createUploadEvent(documentId)),
          { status: 422, why: 'provenance_missing' },
        )
        expect(await readDocument(testDb.db, documentId)).toMatchObject({
          status: 'failed',
          errorCode: 'provenance_missing',
        })
        expect(mocks.persistFile).not.toHaveBeenCalled()
      },
    )

    it('answers 413 from Content-Length before reading or claiming', async () => {
      const documentId = await createRowWithTool()
      const handler = await handlers.file()

      await expectRejection(
        handler(createUploadEvent(documentId, {
          contentLength: String(DOCUMENT_MAX_FILE_BYTES + 1),
        })),
        { status: 413 },
      )
      expect(mocks.validateDocumentBytes).not.toHaveBeenCalled()
      expect(await readDocument(testDb.db, documentId)).toMatchObject({
        status: 'spec_ready',
        renderAttempts: 0,
      })
    })

    it('answers 411 when Content-Length is missing', async () => {
      const documentId = await createRowWithTool()
      const handler = await handlers.file()

      await expectRejection(
        handler(createUploadEvent(documentId, { contentLength: null })),
        { status: 411 },
      )
      expect(await readDocument(testDb.db, documentId)).toMatchObject({
        status: 'spec_ready',
      })
    })

    it('stops reading a body that is larger than it declared and gives the claim back', async () => {
      const documentId = await createRowWithTool()
      const handler = await handlers.file()

      await expectRejection(
        handler(createUploadEvent(documentId, {
          contentLength: '10',
          body: new Uint8Array(DOCUMENT_MAX_FILE_BYTES + 1),
        })),
        { status: 413 },
      )
      expect(mocks.validateDocumentBytes).not.toHaveBeenCalled()
      expect(await readDocument(testDb.db, documentId)).toMatchObject({
        status: 'spec_ready',
        renderLeaseUntil: null,
      })
    })

    it('answers 409 while another request holds the lease', async () => {
      const documentId = await createRowWithTool()

      await testDb.db.update(schema.documents)
        .set({
          status: 'rendering',
          renderLeaseUntil: new Date(Date.now() + 60_000),
        })
        .where(eq(schema.documents.id, documentId))

      const handler = await handlers.file()

      await expectRejection(
        handler(createUploadEvent(documentId)),
        { status: 409 },
      )
      expect(mocks.validateDocumentBytes).not.toHaveBeenCalled()
      expect(await readDocument(testDb.db, documentId)).toMatchObject({
        status: 'rendering',
      })
    })

    it('takes over an expired lease', async () => {
      const documentId = await createRowWithTool()

      await testDb.db.update(schema.documents)
        .set({
          status: 'rendering',
          renderLeaseUntil: new Date(Date.now() - 1000),
        })
        .where(eq(schema.documents.id, documentId))

      const handler = await handlers.file()
      const result = await handler(createUploadEvent(documentId))

      expect(result.status).toBe('ready')
    })

    it('answers 409 for a row that is already ready', async () => {
      const documentId = await createRowWithTool()
      const handler = await handlers.file()

      await handler(createUploadEvent(documentId))
      await expectRejection(
        handler(createUploadEvent(documentId)),
        { status: 409 },
      )
      expect(mocks.persistFile).toHaveBeenCalledTimes(1)
    })

    it('answers 507 on a full quota, frees the claim and works on retry', async () => {
      const documentId = await createRowWithTool()
      const handler = await handlers.file()

      mocks.persistFile.mockRejectedValueOnce(createQuotaError())

      await expectRejection(
        handler(createUploadEvent(documentId)),
        { status: 507, why: 'quota_exceeded' },
      )
      expect(await readDocument(testDb.db, documentId)).toMatchObject({
        status: 'spec_ready',
        renderLeaseUntil: null,
        fileId: null,
      })

      const result = await handler(createUploadEvent(documentId))

      expect(result.status).toBe('ready')
    })

    it('answers 503 and frees the claim when the renderer binding fails', async () => {
      mocks.validateDocumentBytes.mockRejectedValue(
        createRendererUnavailableError(),
      )

      const documentId = await createRowWithTool()
      const handler = await handlers.file()

      await expectRejection(
        handler(createUploadEvent(documentId)),
        { status: 503 },
      )
      expect(await readDocument(testDb.db, documentId)).toMatchObject({
        status: 'spec_ready',
        renderLeaseUntil: null,
        errorCode: null,
      })
    })

    it('deletes the stored file when the lease was taken over meanwhile', async () => {
      const documentId = await createRowWithTool()
      const handler = await handlers.file()

      mocks.validateDocumentBytes.mockImplementation(async () => {
        await testDb.db.update(schema.documents)
          .set({ status: 'spec_ready', renderLeaseUntil: null })
          .where(eq(schema.documents.id, documentId))

        return { ok: true, stats: { bytes: 6 }, provenance: 'ai' }
      })

      await expectRejection(
        handler(createUploadEvent(documentId)),
        { status: 409 },
      )
      expect(mocks.deleteOwnedFile).toHaveBeenCalledWith(
        expect.objectContaining({ userId: ownerId }),
      )
      expect(await readDocument(testDb.db, documentId)).toMatchObject({
        fileId: null,
      })
    })

    it('rejects a missing or wrong x-document-format header', async () => {
      const documentId = await createRowWithTool()
      const handler = await handlers.file()

      await expectRejection(
        handler(createUploadEvent(documentId, { format: 'docx' })),
        { status: 400 },
      )
      await expectRejection(
        handler(createUploadEvent(documentId, { format: null })),
        { status: 400 },
      )
      expect(await readDocument(testDb.db, documentId)).toMatchObject({
        status: 'spec_ready',
        renderAttempts: 0,
      })
    })

    it('answers 410 for a row without a spec', async () => {
      const row = await seedDocument(testDb.db, {
        userId: ownerId,
        originChatId: chatId,
        status: 'failed',
        errorCode: 'spec_missing',
      })
      const handler = await handlers.file()

      await expectRejection(
        handler(createUploadEvent(row.id)),
        { status: 410 },
      )
      expect(await readDocument(testDb.db, row.id)).toMatchObject({
        status: 'failed',
        renderAttempts: 0,
      })
    })

    it('limits uploads to 20 per minute per user', async () => {
      const handler = await handlers.file()

      const fileLimit = DOCUMENT_FILE_RATE_LIMIT_PER_MINUTE

      for (let call = 0; call < fileLimit; call += 1) {
        await expectRejection(
          handler(createUploadEvent('pub-999')),
          { status: 404 },
        )
      }

      await expectRejection(
        handler(createUploadEvent('pub-999')),
        { status: 429 },
      )
    })

    it('logs counts and codes but never the title', async () => {
      const documentId = await createRowWithTool()
      const handler = await handlers.file()

      await handler(createUploadEvent(documentId))

      const logged = JSON.stringify(mocks.logger.set.mock.calls)

      expect(logged).toContain('"renderedBy":"client"')
      expect(logged).toContain('"status":"ready"')
      expect(logged).not.toContain('Trip plan')
      expect(logged).not.toContain('Leave on Friday')
    })
  })

  describe('POST /documents/:id/render', () => {
    it('renders on the server and stores the file as the worker', async () => {
      const documentId = await createRowWithTool()
      const handler = await handlers.render()

      const result = await handler(createEvent({ documentId }))
      const row = await readDocument(testDb.db, documentId)

      expect(result.status).toBe('ready')
      expect(result.file.name).toBe('Trip plan.pdf')
      expect(row).toMatchObject({
        status: 'ready',
        renderedBy: 'worker',
        fileId: result.file.id,
      })

      const [request] = mocks.renderDocument.mock.calls[0]!

      expect(request).toMatchObject({
        specVersion: 1,
        spec: PDF_SPEC,
        assets: [],
        provenance: {
          model: 'claude-haiku-4-5',
          createdVia: 'chat',
          aiGenerated: true,
        },
      })
      expect(mocks.persistFile).toHaveBeenCalledWith(expect.objectContaining({
        source: 'assistant',
        originProvider: 'anthropic',
        originModel: 'claude-haiku-4-5',
      }))
    })

    it('retries a row whose client render failed', async () => {
      const documentId = await createRowWithTool()

      await testDb.db.update(schema.documents)
        .set({ status: 'failed', errorCode: 'validation_failed' })
        .where(eq(schema.documents.id, documentId))

      const handler = await handlers.render()
      const result = await handler(createEvent({ documentId }))

      expect(result.status).toBe('ready')
      expect(await readDocument(testDb.db, documentId)).toMatchObject({
        status: 'ready',
        errorCode: null,
      })
    })

    it('loads the owner\'s images one by one and passes their bytes', async () => {
      const image = await seedOwnedImage()
      const documentId = await createRowWithTool({
        specVersion: 1,
        format: 'docx',
        title: 'With picture',
        blocks: [{
          type: 'image',
          fileId: image.id,
          alt: 'Chart',
          widthPercent: 50,
        }],
      })
      const handler = await handlers.render()

      await handler(createEvent({ documentId }))

      const [request] = mocks.renderDocument.mock.calls[0]!

      expect(request.assets).toHaveLength(1)
      expect(request.assets[0]).toMatchObject({
        fileId: image.id,
        mediaType: 'image/png',
      })
      expect(Array.from(request.assets[0].bytes)).toEqual(
        Array.from(IMAGE_BYTES),
      )
    })

    it('fails with asset_invalid when an image is not the owner\'s', async () => {
      const [foreign] = await testDb.db.insert(schema.files).values({
        userId: strangerId,
        storageKey: 'foreign.png',
        name: 'foreign.png',
        size: 7,
        type: 'image/png',
      }).returning({ id: schema.files.id })
      const documentId = (await createDocument(testDb.db, {
        userId: ownerId,
        format: 'docx',
        title: 'Stolen picture',
        createdVia: 'chat',
        originChatId: chatId,
        specVersion: 1,
        specJson: JSON.stringify({
          specVersion: 1,
          format: 'docx',
          title: 'Stolen picture',
          blocks: [{
            type: 'image',
            fileId: foreign!.id,
            alt: 'Foreign',
            widthPercent: 50,
          }],
        }),
      })).id
      const handler = await handlers.render()

      await expectRejection(
        handler(createEvent({ documentId })),
        { status: 422, why: 'asset_invalid' },
      )
      expect(mocks.renderDocument).not.toHaveBeenCalled()
      expect(await readDocument(testDb.db, documentId)).toMatchObject({
        status: 'failed',
        errorCode: 'asset_invalid',
      })
    })

    it('fails with spec_invalid for a stored spec that no longer parses', async () => {
      const row = await createDocument(testDb.db, {
        userId: ownerId,
        format: 'pdf',
        title: 'Broken',
        createdVia: 'chat',
        originChatId: chatId,
        specVersion: 1,
        specJson: JSON.stringify({ specVersion: 1, format: 'pdf' }),
      })
      const handler = await handlers.render()

      await expectRejection(
        handler(createEvent({ documentId: row.id })),
        { status: 422, why: 'spec_invalid' },
      )
      expect(mocks.renderDocument).not.toHaveBeenCalled()
      expect(await readDocument(testDb.db, row.id)).toMatchObject({
        status: 'failed',
        errorCode: 'spec_invalid',
      })
    })

    it.each([
      ['spec_invalid', 422],
      ['bounds_exceeded', 422],
      ['asset_invalid', 422],
      ['render_failed', 500],
      ['output_invalid', 500],
    ])('maps the renderer failure %s to %i without its detail', async (
      code,
      status,
    ) => {
      mocks.renderDocument.mockResolvedValue({
        ok: false,
        code,
        detail: 'detail with Leave on Friday',
        issues: [{ path: '$.blocks[0]', message: 'issue text' }],
      })

      const documentId = await createRowWithTool()
      const handler = await handlers.render()
      const exception = await expectRejection(
        handler(createEvent({ documentId })),
        { status, why: code },
      )

      expect(JSON.stringify(exception)).not.toContain('Leave on Friday')
      expect(JSON.stringify(exception)).not.toContain('issue text')
      expect(await readDocument(testDb.db, documentId)).toMatchObject({
        status: 'failed',
        errorCode: code,
      })
    })

    it('answers 503 for an unsupported spec version without failing the row', async () => {
      mocks.renderDocument.mockResolvedValue({
        ok: false,
        code: 'spec_version_unsupported',
        detail: 'The renderer supports spec versions 1',
      })

      const documentId = await createRowWithTool()
      const handler = await handlers.render()

      await expectRejection(
        handler(createEvent({ documentId })),
        { status: 503 },
      )
      expect(await readDocument(testDb.db, documentId)).toMatchObject({
        status: 'spec_ready',
        errorCode: null,
      })
    })

    it('answers 503 and frees the claim when the binding throws', async () => {
      mocks.renderDocument.mockRejectedValue(createRendererUnavailableError())

      const documentId = await createRowWithTool()
      const handler = await handlers.render()

      await expectRejection(
        handler(createEvent({ documentId })),
        { status: 503 },
      )
      expect(await readDocument(testDb.db, documentId)).toMatchObject({
        status: 'spec_ready',
        renderLeaseUntil: null,
      })
    })

    it('answers 507 on a full quota and frees the claim', async () => {
      mocks.persistFile.mockRejectedValueOnce(createQuotaError())

      const documentId = await createRowWithTool()
      const handler = await handlers.render()

      await expectRejection(
        handler(createEvent({ documentId })),
        { status: 507, why: 'quota_exceeded' },
      )
      expect(await readDocument(testDb.db, documentId)).toMatchObject({
        status: 'spec_ready',
        fileId: null,
      })
    })

    it('answers 409 when the row is ready or leased', async () => {
      const documentId = await createRowWithTool()
      const handler = await handlers.render()

      await handler(createEvent({ documentId }))
      await expectRejection(
        handler(createEvent({ documentId })),
        { status: 409 },
      )
      expect(mocks.renderDocument).toHaveBeenCalledTimes(1)
    })

    it('limits renders to 10 per minute per user', async () => {
      const handler = await handlers.render()

      const renderLimit = DOCUMENT_RENDER_RATE_LIMIT_PER_MINUTE

      for (let call = 0; call < renderLimit; call += 1) {
        await expectRejection(
          handler(createEvent({ documentId: 'pub-999' })),
          { status: 404 },
        )
      }

      await expectRejection(
        handler(createEvent({ documentId: 'pub-999' })),
        { status: 429 },
      )
    })
  })

  describe('GET /documents/:id', () => {
    it('reports a fresh row without a file', async () => {
      const documentId = await createRowWithTool()
      const handler = await handlers.status()

      expect(await handler(createEvent({ documentId }))).toEqual({
        id: documentId,
        format: 'pdf',
        title: 'Trip plan',
        status: 'spec_ready',
        file: null,
        renderedBy: null,
        errorCode: null,
        stats: {
          pages: 1,
          slides: null,
          sheets: null,
          cells: null,
          images: 0,
        },
      })
    })

    it('reports the file of a ready row', async () => {
      const documentId = await createRowWithTool()

      await (await handlers.file())(createUploadEvent(documentId))

      const result = await (await handlers.status())(
        createEvent({ documentId }),
      )

      expect(result.status).toBe('ready')
      expect(result.renderedBy).toBe('client')
      expect(result.file).toEqual({
        id: expect.any(String),
        storageKey: 'stored-1.bin',
        name: 'Trip plan.pdf',
        size: DOCUMENT_BYTES.byteLength,
        type: 'application/pdf',
      })
    })

    it('reports failed/file_deleted without writing when the file vanished', async () => {
      const documentId = await createRowWithTool()

      await (await handlers.file())(createUploadEvent(documentId))
      await testDb.db.delete(schema.files)

      const result = await (await handlers.status())(
        createEvent({ documentId }),
      )

      expect(result).toMatchObject({
        status: 'failed',
        errorCode: 'file_deleted',
        file: null,
      })
      expect(await readDocument(testDb.db, documentId)).toMatchObject({
        status: 'ready',
        errorCode: null,
      })
    })

    it('reports an expired lease as spec_ready without writing', async () => {
      const documentId = await createRowWithTool()

      await testDb.db.update(schema.documents)
        .set({
          status: 'rendering',
          renderLeaseUntil: new Date(Date.now() - 1000),
        })
        .where(eq(schema.documents.id, documentId))

      const handler = await handlers.status()

      expect((await handler(createEvent({ documentId }))).status)
        .toBe('spec_ready')
      expect(await readDocument(testDb.db, documentId)).toMatchObject({
        status: 'rendering',
      })
    })

    it('keeps reporting rendering while the lease is alive', async () => {
      const documentId = await createRowWithTool()

      await testDb.db.update(schema.documents)
        .set({
          status: 'rendering',
          renderLeaseUntil: new Date(Date.now() + 60_000),
        })
        .where(eq(schema.documents.id, documentId))

      const handler = await handlers.status()

      expect((await handler(createEvent({ documentId }))).status)
        .toBe('rendering')
    })

    it('answers 404 for another user\'s document and for an unknown id', async () => {
      const foreignId = await createRowWithTool(PDF_SPEC, strangerId)
      const handler = await handlers.status()

      await expectRejection(
        handler(createEvent({ documentId: foreignId })),
        { status: 404 },
      )
      await expectRejection(
        handler(createEvent({ documentId: 'pub-9999' })),
        { status: 404 },
      )
    })

    it('answers 400 for a malformed id', async () => {
      const handler = await handlers.status()

      await expectRejection(
        handler(createEvent({ documentId: '../etc/passwd' })),
        { status: 400 },
      )
    })
  })

  describe('GET /documents/:id/spec', () => {
    it('returns the bare spec with private, no-store caching', async () => {
      const documentId = await createRowWithTool()
      const event = createEvent({ documentId })
      const result = await (await handlers.spec())(event)

      expect(result).toEqual(PDF_SPEC)
      expect(event.res.headers.get('cache-control'))
        .toBe('private, no-store')
    })

    it('answers 410 when the row has no spec key', async () => {
      const row = await seedDocument(testDb.db, {
        userId: ownerId,
        originChatId: chatId,
        status: 'failed',
        errorCode: 'spec_missing',
      })

      await expectRejection(
        (await handlers.spec())(createEvent({ documentId: row.id })),
        { status: 410 },
      )
    })

    it('answers 404 when the spec object is gone from R2', async () => {
      const documentId = await createRowWithTool()

      storage.objects.clear()

      await expectRejection(
        (await handlers.spec())(createEvent({ documentId })),
        { status: 404 },
      )
    })

    it('answers 404 for another user\'s document', async () => {
      const foreignId = await createRowWithTool(PDF_SPEC, strangerId)

      await expectRejection(
        (await handlers.spec())(createEvent({ documentId: foreignId })),
        { status: 404 },
      )
    })
  })

  describe('feature flag and session', () => {
    it.each(['status', 'spec', 'file', 'render'] as const)(
      'answers 404 from the %s route when the flag is off',
      async (route) => {
        const documentId = await createRowWithTool()

        mocks.featureActive = false

        const handler = await handlers[route]()
        const event = route === 'file'
          ? createUploadEvent(documentId)
          : createEvent({ documentId })

        await expectRejection(handler(event), { status: 404 })
        expect(await readDocument(testDb.db, documentId)).toMatchObject({
          status: 'spec_ready',
          renderAttempts: 0,
        })
      },
    )

    it.each(['status', 'spec', 'file', 'render'] as const)(
      'answers 401 from the %s route without a session',
      async (route) => {
        mocks.sessionUserId = 0

        const handler = await handlers[route]()
        const event = route === 'file'
          ? createUploadEvent('pub-1')
          : createEvent({ documentId: 'pub-1' })

        await expectRejection(handler(event), { status: 401 })
      },
    )

    it('asks the guard for the documents feature on every route', async () => {
      const documentId = await createRowWithTool()

      for (const route of ['status', 'spec', 'render'] as const) {
        await (await handlers[route]())(createEvent({ documentId })).catch(
          () => undefined,
        )
      }

      await (await handlers.file())(createUploadEvent(documentId))
        .catch(() => undefined)

      expect(mocks.requireFeature).toHaveBeenCalledTimes(4)

      for (const [, flag] of mocks.requireFeature.mock.calls) {
        expect(flag).toBe('documents')
      }
    })
  })
})
