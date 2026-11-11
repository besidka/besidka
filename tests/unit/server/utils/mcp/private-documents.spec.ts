import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import {
  createFakeDocumentStorage,
} from '../../../../setup/helpers/documents-db'
import type {
  FakeDocumentStorage,
} from '../../../../setup/helpers/documents-db'

const mocks = vi.hoisted(() => {
  return {
    enabledFlags: new Set<string>(),
    optedOutFlags: new Set<string>(),
    renderDocument: vi.fn(),
    persistFile: vi.fn(),
    deleteOwnedFile: vi.fn(),
    storage: { usedBytes: 900, maxStorageBytes: 1000 },
  }
})

vi.mock('cloudflare:workers', () => ({ env: {} }))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/features/evaluate', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/features/evaluate')
  >()

  return {
    ...original,
    getFeatureEvaluationConfig: () => ({}),
    loadFeatureRules: async () => ({}),
    loadUserFeatureState: async () => null,
    evaluateFeature: async (flag: string) => {
      return { value: mocks.enabledFlags.has(flag) }
    },
    isFeatureActive: (flag: string, resolution: { value: boolean }) => {
      return resolution.value && !mocks.optedOutFlags.has(flag)
    },
  }
})

vi.mock('~~/server/utils/documents/renderer', () => {
  return { renderDocument: mocks.renderDocument }
})

vi.mock('~~/server/utils/files/persist-file', () => {
  return { persistFile: mocks.persistFile }
})

vi.mock('~~/server/utils/files/file-governance', () => {
  return {
    getEffectiveUserFilePolicy: async () => {
      return { maxStorageBytes: mocks.storage.maxStorageBytes }
    },
    getUserStorageUsageBytes: async () => mocks.storage.usedBytes,
  }
})

vi.mock('~~/server/utils/chats/share', () => {
  return {
    getActiveShareForChat: vi.fn(),
    syncChatShareFiles: vi.fn(),
  }
})

vi.mock('~~/server/utils/files/delete-files', () => {
  return { deleteOwnedFile: mocks.deleteOwnedFile }
})

const {
  MCP_DOCUMENT_UNAVAILABLE_MESSAGE,
  createMcpDocument,
} = await import('~~/server/utils/mcp/private/documents')
const { FORMAT_EXAMPLES } = await import(
  '~~/server/utils/documents/create-document-tool'
)

const ALL_FLAGS = [
  'documents',
  'documents.mcp',
  'documents.pdf',
  'documents.docx',
  'documents.pptx',
  'documents.xlsx',
]

const PDF_SPEC = {
  specVersion: 1,
  language: 'en',
  pageSize: 'A4',
  blocks: [{ type: 'heading', level: 1, text: 'Trip plan' }],
}

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const RENDERED_BYTES = new Uint8Array([1, 2, 3, 4, 5])
const MINUTE_BUCKET_PREFIX = 'mcp:rate-limit:document-minute'
const DAILY_BUCKET_PREFIX = 'mcp:rate-limit:document-day'
const SECRET_TEXT = 'Secret chapter about the merger'

type CreateInput = Parameters<typeof createMcpDocument>[1]

function createFakeKv() {
  const entries = new Map<string, string>()

  return {
    entries,
    get: vi.fn(async (key: string) => entries.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      entries.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      entries.delete(key)
    }),
  }
}

function specOf(format: 'pdf' | 'docx' | 'pptx' | 'xlsx') {
  const { format: _format, title: _title, ...spec } = JSON.parse(
    FORMAT_EXAMPLES[format],
  )

  return spec as Record<string, unknown>
}

describe('createMcpDocument', () => {
  let testDb: MemoryExtractionTestDb
  let documentStorage: FakeDocumentStorage
  let kv: ReturnType<typeof createFakeKv>
  let logger: { set: ReturnType<typeof vi.fn> }
  let userId: number
  let strangerId: number
  let imageObjects: Map<string, Uint8Array>
  let activeImageReads: number
  let maxActiveImageReads: number
  let fileSequence: number

  function context() {
    return { db: testDb.db, kv: kv as never, userId, logger }
  }

  function input(overrides: Partial<CreateInput> = {}): CreateInput {
    return {
      format: 'pdf',
      title: 'Trip plan',
      spec: PDF_SPEC,
      ...overrides,
    }
  }

  async function seedImage(
    ownerId: number,
    type = 'image/png',
  ): Promise<string> {
    fileSequence += 1

    const storageKey = `image-${fileSequence}.png`
    const [file] = await testDb.db.insert(schema.files).values({
      userId: ownerId,
      storageKey,
      name: storageKey,
      size: PNG_BYTES.byteLength,
      type,
    }).returning({ id: schema.files.id })

    imageObjects.set(storageKey, PNG_BYTES)

    return file!.id
  }

  async function documentRows() {
    return await testDb.db.select().from(schema.documents)
  }

  async function fileRows() {
    return await testDb.db.select().from(schema.files)
  }

  function renderSucceeds(stats: Record<string, number> = { pages: 1 }) {
    mocks.renderDocument.mockResolvedValue({
      ok: true,
      bytes: RENDERED_BYTES,
      mediaType: 'application/pdf',
      extension: 'pdf',
      stats,
      rendererVersion: 'test',
    })
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    documentStorage = createFakeDocumentStorage()
    kv = createFakeKv()
    logger = { set: vi.fn() }
    imageObjects = new Map()
    activeImageReads = 0
    maxActiveImageReads = 0
    fileSequence = 0
    userId = await seedUser(testDb.db, null)
    strangerId = await seedUser(testDb.db, null)
    mocks.enabledFlags = new Set(ALL_FLAGS)
    mocks.optedOutFlags = new Set()
    mocks.storage.usedBytes = 900
    mocks.storage.maxStorageBytes = 1000
    mocks.renderDocument.mockReset()
    mocks.persistFile.mockReset()
    mocks.deleteOwnedFile.mockReset()
    mocks.persistFile.mockImplementation(async (file: {
      userId: number
      fileName: string
      mediaType: string
      fileData: Uint8Array
      source?: 'upload' | 'assistant'
    }) => {
      fileSequence += 1

      const [stored] = await testDb.db.insert(schema.files).values({
        userId: file.userId,
        storageKey: `document-${fileSequence}`,
        name: file.fileName,
        size: file.fileData.byteLength,
        type: file.mediaType,
        source: file.source,
      }).returning()

      return {
        id: stored!.id,
        storageKey: stored!.storageKey,
        name: stored!.name,
        size: stored!.size,
        type: stored!.type,
        source: stored!.source,
        expiresAt: stored!.expiresAt,
      }
    })
    renderSucceeds()
    vi.stubGlobal('useFileStorage', () => {
      return {
        ...documentStorage,
        get: async (key: string) => {
          const image = imageObjects.get(key)

          if (!image) {
            return await documentStorage.get(key)
          }

          activeImageReads += 1
          maxActiveImageReads = Math.max(maxActiveImageReads, activeImageReads)
          await new Promise(resolve => setTimeout(resolve, 1))
          activeImageReads -= 1

          return { arrayBuffer: async () => image.buffer }
        },
      }
    })
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('feature gate', () => {
    it('hides the tool behind one generic error with every flag off',
      async () => {
        mocks.enabledFlags = new Set()

        await expect(createMcpDocument(context(), input()))
          .rejects.toMatchObject({
            status: 404,
            message: MCP_DOCUMENT_UNAVAILABLE_MESSAGE,
          })
        expect(mocks.renderDocument).not.toHaveBeenCalled()
        expect(await documentRows()).toHaveLength(0)
        expect(documentStorage.objects.size).toBe(0)
      })

    it.each([
      ['documents'],
      ['documents.mcp'],
      ['documents.pdf'],
    ])('refuses when %s is off', async (flag) => {
      mocks.enabledFlags.delete(flag)

      await expect(createMcpDocument(context(), input()))
        .rejects.toMatchObject({
          status: 404,
          message: MCP_DOCUMENT_UNAVAILABLE_MESSAGE,
        })
      expect(await documentRows()).toHaveLength(0)
    })

    it('checks the flag of the requested format only', async () => {
      mocks.enabledFlags.delete('documents.docx')

      await expect(createMcpDocument(context(), input({
        format: 'docx',
        spec: specOf('docx'),
      }))).rejects.toMatchObject({ status: 404 })

      await expect(createMcpDocument(context(), input()))
        .resolves.toMatchObject({ format: 'pdf' })
    })

    it('refuses when the user switched the feature off', async () => {
      mocks.optedOutFlags.add('documents')

      await expect(createMcpDocument(context(), input()))
        .rejects.toMatchObject({ status: 404 })
    })

    it('gives the same answer whatever the spec contains', async () => {
      mocks.enabledFlags = new Set()

      await expect(createMcpDocument(context(), input({
        spec: { blocks: 'not even valid' },
      }))).rejects.toMatchObject({
        message: MCP_DOCUMENT_UNAVAILABLE_MESSAGE,
      })
    })
  })

  describe('input checks', () => {
    it('rejects an oversize spec before parsing it', async () => {
      const spec = {
        ...PDF_SPEC,
        blocks: [{
          type: 'paragraph',
          runs: [{ text: 'x'.repeat(200_001) }],
        }],
      }

      await expect(createMcpDocument(context(), input({ spec })))
        .rejects.toMatchObject({
          status: 400,
          message: expect.stringContaining('longer than 200000 characters'),
        })
      expect(mocks.renderDocument).not.toHaveBeenCalled()
      expect(await documentRows()).toHaveLength(0)
      expect(kv.entries.size).toBe(0)
    })

    it('accepts a spec well inside the character limit', async () => {
      const spec = {
        ...PDF_SPEC,
        blocks: [{
          type: 'paragraph',
          runs: [{ text: 'x'.repeat(1000) }],
        }],
      }

      await expect(createMcpDocument(context(), input({ spec })))
        .resolves.toMatchObject({ format: 'pdf' })
    })

    it('reports at most 10 path: message lines and writes nothing',
      async () => {
        const blocks = Array.from({ length: 14 }, () => {
          return { type: 'heading', level: 9, text: 'x' }
        })

        const failure = await createMcpDocument(
          context(),
          input({ spec: { ...PDF_SPEC, blocks } }),
        ).catch(exception => exception as { status: number, message: string })

        expect(failure.status).toBe(422)

        const lines = failure.message.split('\n').slice(1)

        expect(lines.length).toBeGreaterThan(0)
        expect(lines.length).toBeLessThanOrEqual(10)

        for (const line of lines) {
          expect(line).toMatch(/^[^:]+: .+/)
        }

        expect(mocks.renderDocument).not.toHaveBeenCalled()
        expect(await documentRows()).toHaveLength(0)
        expect(documentStorage.objects.size).toBe(0)
        expect(kv.entries.size).toBe(0)
      })

    it('does not echo the document text in the error', async () => {
      const failure = await createMcpDocument(context(), input({
        spec: {
          ...PDF_SPEC,
          blocks: [{ type: 'heading', level: 9, text: SECRET_TEXT }],
        },
      })).catch(exception => exception as { message: string })

      expect(failure.message).not.toContain(SECRET_TEXT)
    })

    it('takes format and title from the top-level arguments', async () => {
      await createMcpDocument(context(), input({
        title: 'From the argument',
        spec: { ...PDF_SPEC, format: 'docx', title: 'From the spec' },
      }))

      const request = mocks.renderDocument.mock.calls[0]![0]

      expect(request.spec).toMatchObject({
        format: 'pdf',
        title: 'From the argument',
      })
    })

    it('defaults a missing specVersion to 1', async () => {
      const { specVersion: _specVersion, ...spec } = PDF_SPEC

      await createMcpDocument(context(), input({ spec }))

      expect(mocks.renderDocument.mock.calls[0]![0].specVersion).toBe(1)
    })
  })

  describe('images', () => {
    function specWithImage(fileId: string) {
      return {
        ...PDF_SPEC,
        blocks: [
          ...PDF_SPEC.blocks,
          { type: 'image', fileId, alt: 'Map', widthPercent: 50 },
        ],
      }
    }

    it('rejects the image of another user', async () => {
      const foreignId = await seedImage(strangerId)

      await expect(createMcpDocument(context(), input({
        spec: specWithImage(foreignId),
      }))).rejects.toMatchObject({
        status: 422,
        message: expect.stringContaining(`Unknown image fileId: ${foreignId}`),
      })
      expect(await documentRows()).toHaveLength(0)
      expect(kv.entries.size).toBe(0)
    })

    it('rejects a file that is not a PNG or JPEG image', async () => {
      const textId = await seedImage(userId, 'text/plain')

      await expect(createMcpDocument(context(), input({
        spec: specWithImage(textId),
      }))).rejects.toMatchObject({ status: 422 })
      expect(await documentRows()).toHaveLength(0)
    })

    it('rejects an id that is not a library file', async () => {
      await expect(createMcpDocument(context(), input({
        spec: specWithImage('nope'),
      }))).rejects.toMatchObject({ status: 422 })
    })

    it('passes the bytes of the own image to the renderer', async () => {
      const imageId = await seedImage(userId)

      await createMcpDocument(context(), input({
        spec: specWithImage(imageId),
      }))

      const { assets } = mocks.renderDocument.mock.calls[0]![0]

      expect(assets).toHaveLength(1)
      expect(assets[0]).toMatchObject({
        fileId: imageId,
        mediaType: 'image/png',
      })
      expect([...assets[0].bytes]).toEqual([...PNG_BYTES])
    })

    it('reads image objects one after another', async () => {
      const firstId = await seedImage(userId)
      const secondId = await seedImage(userId)
      const thirdId = await seedImage(userId)

      await createMcpDocument(context(), input({
        spec: {
          ...PDF_SPEC,
          blocks: [firstId, secondId, thirdId].map((fileId) => {
            return { type: 'image', fileId, alt: 'Pic', widthPercent: 40 }
          }),
        },
      }))

      expect(mocks.renderDocument.mock.calls[0]![0].assets).toHaveLength(3)
      expect(maxActiveImageReads).toBe(1)
    })

    it('fails the row when an image object is gone from storage',
      async () => {
        const imageId = await seedImage(userId)

        imageObjects.clear()

        await expect(createMcpDocument(context(), input({
          spec: specWithImage(imageId),
        }))).rejects.toMatchObject({ status: 422 })

        const [row] = await documentRows()

        expect(row).toMatchObject({
          status: 'failed',
          errorCode: 'asset_invalid',
          specR2Key: null,
        })
        expect(documentStorage.objects.size).toBe(0)
        expect(mocks.renderDocument).not.toHaveBeenCalled()
      })
  })

  describe('success', () => {
    it.each(['pdf', 'docx', 'pptx', 'xlsx'] as const)(
      'renders and stores a %s document',
      async (format) => {
        renderSucceeds({ cells: 4 })

        const result = await createMcpDocument(context(), input({
          format,
          title: 'My document',
          spec: specOf(format),
        }))

        expect(result).toMatchObject({
          documentId: expect.any(String),
          format,
          stats: { cells: 4 },
          file: {
            name: `My document.${format}`,
            size: RENDERED_BYTES.byteLength,
            type: expect.stringContaining('/'),
            expiresAt: null,
          },
        })

        const [row] = await documentRows()

        expect(row).toMatchObject({
          id: result.documentId,
          format,
          status: 'ready',
          createdVia: 'mcp',
          renderedBy: 'worker',
          fileId: result.file.id,
          originChatId: null,
          originProvider: null,
          originModel: null,
          errorCode: null,
          renderLeaseUntil: null,
        })
      },
    )

    it('saves the file as an assistant file of the caller', async () => {
      const result = await createMcpDocument(context(), input())
      const [file] = await testDb.db.select()
        .from(schema.files)
        .where(eq(schema.files.id, result.file.id))

      expect(file).toMatchObject({ userId, source: 'assistant' })
      expect(mocks.persistFile).toHaveBeenCalledWith(expect.objectContaining({
        userId,
        source: 'assistant',
        originProvider: null,
        originModel: null,
      }))
    })

    it('marks the channel only, without an AI assertion, by default',
      async () => {
        await createMcpDocument(context(), input())

        expect(mocks.renderDocument.mock.calls[0]![0].provenance).toEqual({
          model: null,
          createdVia: 'mcp',
          aiGenerated: false,
        })
      })

    it('declares AI origin only when the caller says so', async () => {
      await createMcpDocument(context(), input({ aiGenerated: true }))

      expect(mocks.renderDocument.mock.calls[0]![0].provenance).toEqual({
        model: null,
        createdVia: 'mcp',
        aiGenerated: true,
      })
    })

    it('passes an explicit false through', async () => {
      await createMcpDocument(context(), input({ aiGenerated: false }))

      expect(mocks.renderDocument.mock.calls[0]![0].provenance.aiGenerated)
        .toBe(false)
    })

    it('uses the requested file name and appends the extension',
      async () => {
        const named = await createMcpDocument(context(), input({
          fileName: 'Q3 plan.pdf',
        }))
        const unnamed = await createMcpDocument(context(), input({
          fileName: 'Q3 summary',
        }))

        expect(named.file.name).toBe('Q3 plan.pdf')
        expect(unnamed.file.name).toBe('Q3 summary.pdf')

        const stored = await fileRows()

        expect(stored.map(file => file.name).sort())
          .toEqual(['Q3 plan.pdf', 'Q3 summary.pdf'])
      })

    it('reports the retention expiry of the file', async () => {
      const expiresAt = new Date('2027-01-01T00:00:00.000Z')

      mocks.persistFile.mockImplementationOnce(async (file: {
        userId: number
        fileName: string
        fileData: Uint8Array
      }) => {
        const [stored] = await testDb.db.insert(schema.files).values({
          userId: file.userId,
          storageKey: 'with-expiry',
          name: file.fileName,
          size: file.fileData.byteLength,
          type: 'application/pdf',
          source: 'assistant',
          expiresAt,
        }).returning()

        return { ...stored!, expiresAt }
      })

      const result = await createMcpDocument(context(), input())

      expect(result.file.expiresAt).toBe('2027-01-01T00:00:00.000Z')
    })

    it('keeps the spec object for the retention window', async () => {
      const result = await createMcpDocument(context(), input())
      const [row] = await documentRows()

      expect(row!.specR2Key)
        .toBe(`documents/${userId}/${result.documentId}/spec.v1.json`)
      expect(documentStorage.objects.has(row!.specR2Key!)).toBe(true)
    })

    it('logs ids and counts, never the title or the content', async () => {
      await createMcpDocument(context(), input({ title: 'Private memo' }))

      expect(JSON.stringify(logger.set.mock.calls)).not.toContain('Private memo')
      expect(JSON.stringify(logger.set.mock.calls)).not.toContain('Trip plan')
    })
  })

  describe('per-user limiter', () => {
    it('allows 10 renders a minute and refuses the 11th', async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await createMcpDocument(context(), input())
      }

      await expect(createMcpDocument(context(), input()))
        .rejects.toMatchObject({
          status: 429,
          message: expect.stringContaining('at most 10 documents a minute'),
        })
      expect(await documentRows()).toHaveLength(10)
      expect(mocks.renderDocument).toHaveBeenCalledTimes(10)
    })

    it('refuses past 100 renders a day', async () => {
      const now = Date.now()

      kv.entries.set(`${DAILY_BUCKET_PREFIX}:${userId}`, JSON.stringify({
        key: String(userId),
        count: 100,
        lastRequest: now,
        windowStart: now,
      }))

      await expect(createMcpDocument(context(), input()))
        .rejects.toMatchObject({
          status: 429,
          message: expect.stringContaining('at most 100 documents a day'),
        })
      expect(await documentRows()).toHaveLength(0)
      expect(mocks.renderDocument).not.toHaveBeenCalled()
    })

    it('keeps a separate budget for each user', async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await createMcpDocument(context(), input())
      }

      await expect(createMcpDocument(
        { ...context(), userId: strangerId },
        input(),
      )).resolves.toMatchObject({ format: 'pdf' })
    })

    it('does not spend the daily budget on a minute refusal', async () => {
      const now = Date.now()

      kv.entries.set(`${MINUTE_BUCKET_PREFIX}:${userId}`, JSON.stringify({
        key: String(userId),
        count: 10,
        lastRequest: now,
        windowStart: now,
      }))

      await expect(createMcpDocument(context(), input()))
        .rejects.toMatchObject({ status: 429 })
      expect(kv.entries.has(`${DAILY_BUCKET_PREFIX}:${userId}`)).toBe(false)
    })

    it('answers 429 when the counter write is refused', async () => {
      kv.put.mockRejectedValueOnce(new Error('KV PUT failed: 429'))

      await expect(createMcpDocument(context(), input()))
        .rejects.toMatchObject({ status: 429 })
      expect(await documentRows()).toHaveLength(0)
    })
  })

  describe('failure cleanup', () => {
    async function expectFailedWithoutLeftovers(errorCode: string) {
      const rows = await documentRows()

      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        status: 'failed',
        errorCode,
        fileId: null,
        specR2Key: null,
        specBytes: null,
        renderLeaseUntil: null,
      })
      expect(rows.some(row => row.status === 'rendering')).toBe(false)
      expect(documentStorage.objects.size).toBe(0)
      expect(await fileRows()).toHaveLength(0)
    }

    it.each([
      ['bounds_exceeded', 'over a size limit'],
      ['spec_invalid', 'The spec was rejected'],
      ['asset_invalid', 'An image of the document is unusable'],
      ['spec_version_unsupported', 'does not support this specVersion'],
      ['render_failed', 'could not be rendered from this spec'],
      ['output_invalid', 'could not be rendered from this spec'],
    ])('maps the renderer code %s to a readable 422', async (code, text) => {
      mocks.renderDocument.mockResolvedValue({ ok: false, code })

      await expect(createMcpDocument(context(), input()))
        .rejects.toMatchObject({
          status: 422,
          message: expect.stringContaining(text),
        })
      await expectFailedWithoutLeftovers(code)
    })

    it('lists the issues the renderer reports', async () => {
      mocks.renderDocument.mockResolvedValue({
        ok: false,
        code: 'bounds_exceeded',
        issues: [{ path: 'blocks', message: 'Estimated 250 pages, limit 200' }],
      })

      await expect(createMcpDocument(context(), input()))
        .rejects.toMatchObject({
          message: expect.stringContaining(
            'blocks: Estimated 250 pages, limit 200',
          ),
        })
    })

    it('fails the row and rethrows when the renderer is unavailable',
      async () => {
        mocks.renderDocument.mockRejectedValue(
          Object.assign(new Error('Document rendering is unavailable'), {
            status: 503,
          }),
        )

        await expect(createMcpDocument(context(), input()))
          .rejects.toMatchObject({ status: 503 })
        await expectFailedWithoutLeftovers('renderer_unavailable')
      })

    it('fails the row for an unexpected error', async () => {
      mocks.renderDocument.mockRejectedValue(new Error('boom'))

      await expect(createMcpDocument(context(), input()))
        .rejects.toThrow('boom')
      await expectFailedWithoutLeftovers('render_failed')
    })

    it('answers a full library with the current usage and no leftovers',
      async () => {
        mocks.persistFile.mockRejectedValue(Object.assign(
          new Error('Not enough storage space. Please delete some files.'),
          { status: 400 },
        ))

        await expect(createMcpDocument(context(), input()))
          .rejects.toMatchObject({
            status: 413,
            message: expect.stringContaining('900 of 1000 bytes'),
          })
        await expectFailedWithoutLeftovers('quota_exceeded')
      })

    it('can create again after the storage was freed', async () => {
      mocks.persistFile.mockRejectedValueOnce(Object.assign(
        new Error('Not enough storage space. Please delete some files.'),
        { status: 400 },
      ))

      await expect(createMcpDocument(context(), input()))
        .rejects.toMatchObject({ status: 413 })
      await expect(createMcpDocument(context(), input()))
        .resolves.toMatchObject({ format: 'pdf' })

      const statuses = (await documentRows()).map(row => row.status).sort()

      expect(statuses).toEqual(['failed', 'ready'])
    })

    it('deletes the stored file when marking the row ready fails',
      async () => {
        const store = await import('~~/server/utils/documents/store')
        const markReady = vi.spyOn(store, 'markDocumentReady')
          .mockRejectedValueOnce(new Error('D1 unavailable'))

        await expect(createMcpDocument(context(), input()))
          .rejects.toThrow('D1 unavailable')

        const [stored] = await fileRows()

        expect(mocks.deleteOwnedFile).toHaveBeenCalledWith(
          expect.objectContaining({ userId, fileId: stored!.id }),
        )
        expect((await documentRows())[0]).toMatchObject({
          status: 'failed',
          errorCode: 'render_failed',
          specR2Key: null,
        })

        markReady.mockRestore()
      })

    it('keeps the spec object when the row cannot be marked failed',
      async () => {
        const store = await import('~~/server/utils/documents/store')
        const markFailed = vi.spyOn(store, 'markDocumentFailed')
          .mockRejectedValueOnce(new Error('D1 unavailable'))

        mocks.renderDocument.mockResolvedValue({
          ok: false,
          code: 'render_failed',
        })

        await expect(createMcpDocument(context(), input()))
          .rejects.toMatchObject({ status: 422 })
        expect(documentStorage.objects.size).toBe(1)

        markFailed.mockRestore()
      })

    it('leaves no row in rendering when the claim cannot start',
      async () => {
        const store = await import('~~/server/utils/documents/store')
        const claim = vi.spyOn(store, 'claimDocumentRender')
          .mockResolvedValueOnce(null)

        await expect(createMcpDocument(context(), input()))
          .rejects.toMatchObject({ status: 409 })
        expect(await documentRows()).toHaveLength(0)
        expect(documentStorage.objects.size).toBe(0)

        claim.mockRestore()
      })
  })
})
