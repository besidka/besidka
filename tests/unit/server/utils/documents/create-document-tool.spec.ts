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
  withSpecStats,
} = await import('~~/server/utils/documents/create-document-tool')
const { toolRequiresFollowUpTurn } = await import(
  '~~/server/utils/ai/tool-loop'
)

const FORMAT_SUBSETS: DocumentFormat[][] = DOCUMENT_FORMATS.reduce<
  DocumentFormat[][]
>((subsets, format) => {
  return [...subsets, ...subsets.map(subset => [...subset, format])]
}, [[]]).filter(subset => subset.length > 0)

const TOP_LEVEL_FORBIDDEN_KEYWORDS = [
  'oneOf',
  'anyOf',
  'allOf',
  'not',
  'enum',
  '$ref',
]

function hasTupleItems(node: unknown): boolean {
  if (Array.isArray(node)) {
    return node.some(hasTupleItems)
  }

  if (typeof node !== 'object' || node === null) {
    return false
  }

  return Object.entries(node).some(([key, value]) => {
    return (key === 'items' && Array.isArray(value)) || hasTupleItems(value)
  })
}

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

    it('says that both theme fields are optional', () => {
      const description = buildDocumentToolDescription(['pdf'])

      expect(description).toContain('"font"?:"sans"|"serif"')
      expect(description).toContain('"accent"?:"neutral"')
      expect(description).toContain('both fields are optional')
    })

    it('fills docx stats from the spec and keeps renderer stats', () => {
      const docxSpec = {
        specVersion: 1,
        format: 'docx',
        title: 'Letter',
        blocks: [
          { type: 'heading', level: 1, text: 'Hi' },
          { type: 'paragraph', runs: [{ text: 'Body' }] },
        ],
      } as never
      const pdfSpec = { ...(docxSpec as object), format: 'pdf' } as never

      expect(withSpecStats({}, docxSpec)).toEqual({ blocks: 2 })
      expect(withSpecStats({ blocks: 7 }, docxSpec)).toEqual({ blocks: 7 })
      expect(withSpecStats({ pages: 3 }, pdfSpec)).toEqual({ pages: 3 })
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

    describe.each(FORMAT_SUBSETS.map(subset => [subset.join('+'), subset]))(
      'advertised JSON schema for %s',
      (_label, subset) => {
        const formats = subset as DocumentFormat[]

        function readSchema(): Record<string, any> {
          return asSchema(createTool(formats).inputSchema)
            .jsonSchema as Record<string, any>
        }

        it('is a plain top-level object', () => {
          const jsonSchema = readSchema()

          expect(jsonSchema.type).toBe('object')
          expect(jsonSchema.properties).toBeTypeOf('object')

          for (const keyword of TOP_LEVEL_FORBIDDEN_KEYWORDS) {
            expect(jsonSchema).not.toHaveProperty(keyword)
          }
        })

        it('narrows format to the enabled formats', () => {
          const jsonSchema = readSchema()

          expect([...jsonSchema.properties.format.enum].sort())
            .toEqual([...formats].sort())
          expect(jsonSchema.required).toEqual(
            expect.arrayContaining(['format', 'title']),
          )
        })

        it('keeps every theme field optional', () => {
          const theme = readSchema().properties.theme

          if (!theme) {
            return
          }

          expect(theme.properties).toHaveProperty('font')
          expect(theme.properties).toHaveProperty('accent')
          expect(theme.required ?? []).toEqual([])
        })

        it('does not require specVersion', () => {
          const jsonSchema = readSchema()

          expect(jsonSchema.properties).toHaveProperty('specVersion')
          expect(jsonSchema.required).not.toContain('specVersion')
        })

        it('offers the fields of enabled formats only', () => {
          const properties = Object.keys(readSchema().properties)
          const offers = (key: string) => properties.includes(key)

          expect(offers('blocks')).toBe(
            formats.includes('pdf') || formats.includes('docx'),
          )
          expect(offers('pageSize')).toBe(formats.includes('pdf'))
          expect(offers('aspect')).toBe(formats.includes('pptx'))
          expect(offers('slides')).toBe(formats.includes('pptx'))
          expect(offers('sheets')).toBe(formats.includes('xlsx'))

          if (formats.length > 1 && formats.includes('pptx')) {
            expect(readSchema().required).not.toContain('blocks')
          }
        })

        it('uses no keyword that a provider rejects, at any depth', () => {
          const serialized = JSON.stringify(readSchema())

          expect(serialized).not.toContain('"oneOf"')
          expect(serialized).not.toContain('"allOf"')
          expect(serialized).not.toContain('"$ref"')
          expect(serialized).not.toContain('"const"')
          expect(serialized).not.toContain('"additionalItems"')
          expect(hasTupleItems(readSchema())).toBe(false)
        })
      },
    )

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

    it('rejects input that breaks the per-format rules', async () => {
      const invalidInputs = [
        { ...PDF_SPEC, pageSize: undefined },
        { ...PDF_SPEC, pageSize: 'A3' },
        { ...PDF_SPEC, sheets: XLSX_SPEC.sheets },
        { specVersion: 1, format: 'pptx', title: 'Deck', blocks: PDF_SPEC.blocks },
        { ...XLSX_SPEC, sheets: undefined },
        { ...XLSX_SPEC, specVersion: 2 },
        { format: 'odt', title: 'Letter', blocks: PDF_SPEC.blocks },
      ]

      for (const invalidInput of invalidInputs) {
        await expect(createTool().execute(invalidInput, {})).rejects
          .toMatchObject({ code: DOCUMENT_TOOL_ERROR_CODES.invalidInput })
      }

      expect(await countDocuments()).toBe(0)
    })

    it('defaults a missing or null specVersion to the current version', async () => {
      const validate = asSchema(createTool().inputSchema).validate!
      const { specVersion: _specVersion, ...withoutVersion } = PDF_SPEC

      for (const candidate of [
        withoutVersion,
        { ...withoutVersion, specVersion: null },
      ]) {
        const result = await validate(candidate)

        expect(result).toMatchObject({
          success: true,
          value: { specVersion: 1 },
        })
      }

      const output = await createTool().execute(withoutVersion as never, {})

      expect(output).toMatchObject({ format: 'pdf', specVersion: 1 })
    })

    it('rejects a foreign field that carries a real value', async () => {
      const validate = asSchema(createTool().inputSchema).validate!
      const result = await validate({
        ...XLSX_SPEC,
        pageSize: 'A4',
        blocks: PDF_SPEC.blocks,
      })

      expect(result.success).toBe(false)
    })

    it('ignores null and empty placeholders of other formats', async () => {
      const validate = asSchema(createTool().inputSchema).validate!
      const result = await validate({
        ...XLSX_SPEC,
        language: null,
        theme: null,
        pageSize: null,
        aspect: null,
        blocks: [],
        slides: [],
      })

      expect(result.success).toBe(true)

      const output = await createTool().execute({
        ...XLSX_SPEC,
        blocks: [],
        pageSize: null,
      }, {})

      expect(output).toMatchObject({ format: 'xlsx' })
    })

    it('still rejects an empty array for a field of the chosen format', async () => {
      await expect(createTool().execute({ ...PDF_SPEC, blocks: [] }, {}))
        .rejects.toMatchObject({
          code: DOCUMENT_TOOL_ERROR_CODES.invalidInput,
        })
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
