import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asSchema } from 'ai'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import {
  createFakeDocumentStorage,
  readDocument,
} from '../../../../setup/helpers/documents-db'
import type {
  FakeDocumentStorage,
} from '../../../../setup/helpers/documents-db'
import * as schema from '~~/server/db/schema'
import { DOCUMENT_FORMATS } from '#shared/utils/documents'
import type { DocumentFormat } from '#shared/utils/documents'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const {
  DOCUMENT_TOOL_DESCRIPTION_MAX_CHARACTERS,
  DOCUMENT_TOOL_ERROR_CODES,
  buildDocumentToolDescription,
  createDocumentTool,
} = await import('~~/server/utils/documents/create-document-tool')
const { toolRequiresFollowUpTurn } = await import(
  '~~/server/utils/ai/tool-loop'
)

type ToolExecute = (input: unknown, options: unknown) => Promise<unknown>

const SECRET_TEXT = 'CONFIDENTIAL-QUARTERLY-FIGURES'

const PDF_SPEC = {
  specVersion: 1,
  format: 'pdf',
  title: 'Trip plan',
  pageSize: 'A4',
  blocks: [
    { type: 'heading', level: 1, text: 'Trip plan' },
    { type: 'paragraph', runs: [{ text: 'Leave on Friday' }] },
  ],
}

const XLSX_SPEC = {
  specVersion: 1,
  format: 'xlsx',
  title: 'Budget',
  sheets: [{
    name: 'Budget',
    columns: [
      { header: 'Item', type: 'string' },
      { header: 'Cost', type: 'currency' },
    ],
    rows: [['Rent', 1200]],
  }],
}

function createImageSpec(fileId: string) {
  return {
    specVersion: 1,
    format: 'docx',
    title: 'With picture',
    blocks: [{ type: 'image', fileId, alt: 'Chart', widthPercent: 50 }],
  }
}

describe('create_document tool', () => {
  let testDb: MemoryExtractionTestDb
  let storage: FakeDocumentStorage
  let userId: number
  let otherUserId: number
  let chatId: string
  const logger = { set: vi.fn() }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    storage = createFakeDocumentStorage()
    vi.stubGlobal('useFileStorage', () => storage)
    userId = await seedUser(testDb.db, null)
    otherUserId = await seedUser(testDb.db, null)
    chatId = (await seedChat(testDb.db, userId)).id
    logger.set.mockClear()
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  function createTool(
    enabledFormats: readonly DocumentFormat[] = DOCUMENT_FORMATS,
  ) {
    const tools = createDocumentTool({
      userId,
      chatId,
      db: testDb.db,
      logger,
      enabledFormats,
      modelId: 'claude-haiku-4-5',
      provider: 'anthropic',
      assistantMessageId: 'ASSISTANT-ULID',
    })

    return tools.create_document as unknown as {
      description: string
      inputSchema: ReturnType<typeof asSchema>
      execute: ToolExecute
    }
  }

  async function seedFile(
    ownerId: number,
    type: string,
    storageKey: string,
  ): Promise<string> {
    const [file] = await testDb.db.insert(schema.files).values({
      userId: ownerId,
      storageKey,
      name: storageKey,
      size: 100,
      type,
    }).returning({ id: schema.files.id })

    return file!.id
  }

  async function countDocuments(): Promise<number> {
    const rows = await testDb.db.select().from(schema.documents)

    return rows.length
  }

  describe('description and schema', () => {
    it('stays inside the character budget for every format', () => {
      const description = buildDocumentToolDescription(DOCUMENT_FORMATS)

      expect(description.length).toBeLessThanOrEqual(
        DOCUMENT_TOOL_DESCRIPTION_MAX_CHARACTERS,
      )

      for (const format of DOCUMENT_FORMATS) {
        expect(description).toContain(`${format}: {"specVersion":1`)
      }
    })

    it('carries only the examples and rules of enabled formats', () => {
      const description = buildDocumentToolDescription(['pdf'])

      expect(description).toContain('pdf: {"specVersion":1')
      expect(description).not.toContain('xlsx: {')
      expect(description).not.toContain('pptx: {')
      expect(description).not.toContain('Slide layouts')
      expect(description).toContain('Blocks for pdf and docx')
      expect(buildDocumentToolDescription(['xlsx']))
        .not.toContain('Blocks for pdf and docx')
    })

    it('advertises a JSON schema that only offers enabled formats', () => {
      const jsonSchema = asSchema(createTool(['pdf', 'docx']).inputSchema)
        .jsonSchema as { oneOf?: unknown[], anyOf?: unknown[] }
      const variants = jsonSchema.oneOf ?? jsonSchema.anyOf ?? []

      expect(variants).toHaveLength(2)
      expect(JSON.stringify(variants)).not.toContain('"xlsx"')
      expect(JSON.stringify(variants)).not.toContain('"pptx"')
    })

    it('is marked for a follow-up turn', () => {
      expect(toolRequiresFollowUpTurn(createTool())).toBe(true)
    })

    it('rejects a disabled format with a clear message', async () => {
      const validate = asSchema(createTool(['pdf']).inputSchema).validate!
      const result = await validate(XLSX_SPEC)

      expect(result.success).toBe(false)
      expect(String((result as { error: Error }).error.message))
        .toContain('The xlsx format is not available')
    })

    it('accepts a spec of an enabled format', async () => {
      const validate = asSchema(createTool(['pdf']).inputSchema).validate!
      const result = await validate(PDF_SPEC)

      expect(result.success).toBe(true)
    })
  })

  describe('execute', () => {
    it('stores the spec in R2 and a spec_ready row, without echoing it', async () => {
      const output = await createTool().execute(PDF_SPEC, {}) as Record<
        string,
        unknown
      >

      expect(Object.keys(output).sort()).toEqual([
        'documentId',
        'format',
        'specVersion',
        'stats',
        'title',
      ])
      expect(output).toMatchObject({
        format: 'pdf',
        title: 'Trip plan',
        specVersion: 1,
        stats: { slides: null, sheets: null, cells: null, images: 0 },
      })
      expect(JSON.stringify(output)).not.toContain('Leave on Friday')

      const row = await readDocument(testDb.db, output.documentId as string)

      expect(row).toMatchObject({
        userId,
        format: 'pdf',
        status: 'spec_ready',
        createdVia: 'chat',
        originChatId: chatId,
        originMessagePublicId: 'ASSISTANT-ULID',
        originProvider: 'anthropic',
        originModel: 'claude-haiku-4-5',
        specVersion: 1,
        title: 'Trip plan',
      })

      const expectedKey = `documents/${userId}/${row!.id}/spec.v1.json`

      expect(row!.specR2Key).toBe(expectedKey)
      expect(JSON.parse(storage.objects.get(expectedKey)!)).toEqual(PDF_SPEC)
    })

    it('reports the stats of a workbook', async () => {
      const output = await createTool().execute(XLSX_SPEC, {}) as {
        stats: Record<string, unknown>
      }

      expect(output.stats).toMatchObject({ sheets: 1, cells: 4 })
    })

    it('feeds back JSON paths without the document text', async () => {
      const badSpec = {
        ...PDF_SPEC,
        blocks: [
          { type: 'paragraph', runs: [{ text: SECRET_TEXT }] },
          { type: 'heading', level: 9, text: SECRET_TEXT },
        ],
      }

      await expect(createTool().execute(badSpec, {})).rejects.toMatchObject({
        code: DOCUMENT_TOOL_ERROR_CODES.invalidInput,
        message: expect.stringContaining('$.blocks[1].level'),
      })
      await expect(createTool().execute(badSpec, {})).rejects.not
        .toMatchObject({ message: expect.stringContaining(SECRET_TEXT) })
      expect(await countDocuments()).toBe(0)
      expect(storage.objects.size).toBe(0)
    })

    it('rejects a format that is not enabled', async () => {
      await expect(createTool(['pdf']).execute(XLSX_SPEC, {}))
        .rejects.toMatchObject({
          code: DOCUMENT_TOOL_ERROR_CODES.formatDisabled,
        })
      expect(await countDocuments()).toBe(0)
    })

    it('allows three calls and refuses the fourth', async () => {
      const documentTool = createTool()

      for (let call = 0; call < 3; call += 1) {
        await documentTool.execute(PDF_SPEC, {})
      }

      await expect(documentTool.execute(PDF_SPEC, {})).rejects.toMatchObject({
        code: DOCUMENT_TOOL_ERROR_CODES.turnLimit,
      })
      expect(await countDocuments()).toBe(3)
    })

    it('counts calls that run at the same time', async () => {
      const documentTool = createTool()
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => documentTool.execute(PDF_SPEC, {})),
      )
      const fulfilled = results.filter(result => result.status === 'fulfilled')
      const rejected = results.filter(result => result.status === 'rejected')

      expect(fulfilled).toHaveLength(3)
      expect(rejected).toHaveLength(3)

      for (const result of rejected) {
        expect((result as PromiseRejectedResult).reason).toMatchObject({
          code: DOCUMENT_TOOL_ERROR_CODES.turnLimit,
        })
      }

      expect(await countDocuments()).toBe(3)
    })

    it('keeps the counter per tool instance, so a new send starts at zero', async () => {
      const first = createTool()

      for (let call = 0; call < 3; call += 1) {
        await first.execute(PDF_SPEC, {})
      }

      await expect(createTool().execute(PDF_SPEC, {})).resolves.toBeDefined()
    })

    it('accepts images that are the user\'s PNG or JPEG files', async () => {
      const png = await seedFile(userId, 'image/png', 'a.png')
      const jpeg = await seedFile(userId, 'image/jpeg', 'b.jpg')

      const output = await createTool().execute(createImageSpec(png), {})
      const second = await createTool().execute(createImageSpec(jpeg), {})

      expect(output).toMatchObject({ stats: { images: 1 } })
      expect(second).toMatchObject({ stats: { images: 1 } })
    })

    it('refuses an image of another user', async () => {
      const foreign = await seedFile(otherUserId, 'image/png', 'foreign.png')

      await expect(createTool().execute(createImageSpec(foreign), {}))
        .rejects.toMatchObject({
          code: DOCUMENT_TOOL_ERROR_CODES.unknownImage,
        })
      expect(await countDocuments()).toBe(0)
    })

    it('refuses a file that is not a PNG or JPEG image', async () => {
      const pdfFile = await seedFile(userId, 'application/pdf', 'a.pdf')
      const webp = await seedFile(userId, 'image/webp', 'a.webp')

      for (const fileId of [pdfFile, webp, 'not-a-file-id', 'pub-99999']) {
        await expect(createTool().execute(createImageSpec(fileId), {}))
          .rejects.toMatchObject({
            code: DOCUMENT_TOOL_ERROR_CODES.unknownImage,
          })
      }

      expect(await countDocuments()).toBe(0)
    })

    it('returns a tool error and leaves no row when R2 fails', async () => {
      storage.put.mockRejectedValueOnce(new Error('R2 down'))

      await expect(createTool().execute(PDF_SPEC, {})).rejects.toMatchObject({
        code: DOCUMENT_TOOL_ERROR_CODES.writeFailed,
      })
      expect(await countDocuments()).toBe(0)
    })

    it('logs counts and error codes, never the title or text', async () => {
      await createTool().execute({ ...PDF_SPEC, title: SECRET_TEXT }, {})
      await createTool().execute({
        ...PDF_SPEC,
        blocks: [{ type: 'heading', level: 9, text: SECRET_TEXT }],
      }, {}).catch(() => undefined)

      const logged = JSON.stringify(logger.set.mock.calls)

      expect(logged).toContain('"created":1')
      expect(logged).not.toContain(SECRET_TEXT)
    })
  })
})
