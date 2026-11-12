import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import { seedDocument } from '../../setup/helpers/documents-db'

const mocks = vi.hoisted(() => ({
  featureActive: true,
  requireFeature: vi.fn(),
  logger: { set: vi.fn() },
  sessionUserId: 0,
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

async function importListHandler() {
  const module = await import('../../../server/api/v1/documents/index.get')

  return module.default as (event: unknown) => Promise<any>
}

function createEvent(query: Record<string, string> = {}) {
  return {
    context: {},
    params: {},
    query,
    res: { headers: new Headers() },
  }
}

const MEDIA_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument'
    + '.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument'
    + '.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument'
    + '.spreadsheetml.sheet',
} as const

describe('documents library API', () => {
  let testDb: MemoryExtractionTestDb
  let ownerId: number
  let strangerId: number
  let fileSequence: number

  beforeEach(() => {
    testDb = createMemoryExtractionTestDb()
    fileSequence = 0
    mocks.featureActive = true
    mocks.logger.set.mockClear()
    mocks.requireFeature.mockReset()
    mocks.requireFeature.mockImplementation(async () => {
      if (!mocks.featureActive) {
        throw Object.assign(new Error('Not found'), { status: 404 })
      }

      return { active: true }
    })

    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useUserSession', async () => {
      return mocks.sessionUserId
        ? { user: { id: String(mocks.sessionUserId) } }
        : null
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  async function seedUsers() {
    ownerId = await seedUser(testDb.db, null)
    strangerId = await seedUser(testDb.db, null)
    mocks.sessionUserId = ownerId
  }

  async function seedReadyDocument(input: {
    userId: number
    format: keyof typeof MEDIA_TYPES
    fileName: string
    title?: string | null
    createdVia?: 'chat' | 'mcp' | 'research' | 'schedule'
    aiGenerated?: boolean | null
    originChatId?: string
    minutesAgo: number
    size?: number
  }) {
    fileSequence += 1

    const [file] = await testDb.db.insert(schema.files).values({
      userId: input.userId,
      storageKey: `library-${fileSequence}.bin`,
      name: input.fileName,
      size: input.size ?? 2048,
      type: MEDIA_TYPES[input.format],
      source: 'assistant',
    }).returning({ id: schema.files.id })

    return await seedDocument(testDb.db, {
      userId: input.userId,
      format: input.format,
      title: input.title === undefined ? input.fileName : input.title,
      status: 'ready',
      fileId: file!.id,
      createdVia: input.createdVia ?? 'chat',
      aiGenerated: input.aiGenerated,
      originChatId: input.originChatId,
      stats: {
        pages: 3,
        slides: null,
        sheets: null,
        cells: null,
        images: 0,
      },
      createdAt: new Date(Date.now() - input.minutesAgo * 60_000),
    })
  }

  async function seedLibrary() {
    await seedUsers()

    const chat = await seedChat(testDb.db, ownerId, { title: 'Quarterly chat' })
    const report = await seedReadyDocument({
      userId: ownerId,
      format: 'pdf',
      fileName: 'Quarterly report.pdf',
      originChatId: chat.id,
      minutesAgo: 30,
    })
    const deck = await seedReadyDocument({
      userId: ownerId,
      format: 'pptx',
      fileName: 'Launch deck.pptx',
      createdVia: 'mcp',
      aiGenerated: true,
      minutesAgo: 20,
    })
    const budget = await seedReadyDocument({
      userId: ownerId,
      format: 'xlsx',
      fileName: '100%_budget.xlsx',
      createdVia: 'mcp',
      minutesAgo: 10,
    })
    const foreign = await seedReadyDocument({
      userId: strangerId,
      format: 'pdf',
      fileName: 'Stranger plan.pdf',
      minutesAgo: 5,
    })

    return { chat, report, deck, budget, foreign }
  }

  it('lists only the owner finished documents newest first', async () => {
    const { chat, report, deck, budget, foreign } = await seedLibrary()
    const list = await importListHandler()
    const result = await list(createEvent())

    expect(result.total).toBe(3)
    expect(result.items.map((item: { id: string }) => item.id)).toEqual([
      budget.id,
      deck.id,
      report.id,
    ])
    expect(result.items.map((item: { id: string }) => item.id))
      .not.toContain(foreign.id)
    expect(result.items[2]).toEqual({
      id: report.id,
      format: 'pdf',
      title: 'Quarterly report',
      source: 'chat',
      aiGenerated: true,
      fileId: expect.any(String),
      fileName: 'Quarterly report.pdf',
      storageKey: 'library-1.bin',
      size: 2048,
      stats: expect.objectContaining({ pages: 3 }),
      originChatSlug: chat.slug,
      originChatTitle: 'Quarterly chat',
      createdAt: expect.any(String),
    })
    expect(result.items[1]).toMatchObject({
      source: 'mcp',
      aiGenerated: true,
      originChatSlug: null,
      originChatTitle: null,
    })
  })

  it('labels documents by the stored flag and reads null by channel',
    async () => {
      const { report, deck, budget } = await seedLibrary()
      const list = await importListHandler()
      const result = await list(createEvent())
      const flags = Object.fromEntries(
        result.items.map((item: { id: string, aiGenerated: boolean }) => {
          return [item.id, item.aiGenerated]
        }),
      )

      expect(flags[report.id]).toBe(true)
      expect(flags[deck.id]).toBe(true)
      expect(flags[budget.id]).toBe(false)
    })

  it('counts formats and sources for every document of the owner',
    async () => {
      await seedLibrary()

      const list = await importListHandler()
      const unfiltered = await list(createEvent())
      const filtered = await list(createEvent({ format: 'pdf' }))

      expect(unfiltered.formatCounts).toEqual({
        pdf: 1,
        docx: 0,
        pptx: 1,
        xlsx: 1,
      })
      expect(unfiltered.sourceCounts).toEqual({ chat: 1, mcp: 2 })
      expect(filtered.formatCounts).toEqual(unfiltered.formatCounts)
      expect(filtered.sourceCounts).toEqual(unfiltered.sourceCounts)
    })

  it('filters by format and by source', async () => {
    const { report, deck, budget } = await seedLibrary()
    const list = await importListHandler()

    const pdfs = await list(createEvent({ format: 'pdf' }))
    const mcp = await list(createEvent({ source: 'mcp' }))
    const chat = await list(createEvent({ source: 'chat' }))
    const mcpSheets = await list(createEvent({
      source: 'mcp',
      format: 'xlsx',
    }))
    const none = await list(createEvent({ source: 'chat', format: 'xlsx' }))

    expect(pdfs.items.map((item: { id: string }) => item.id))
      .toEqual([report.id])
    expect(pdfs.total).toBe(1)
    expect(mcp.items.map((item: { id: string }) => item.id))
      .toEqual([budget.id, deck.id])
    expect(mcp.total).toBe(2)
    expect(chat.items.map((item: { id: string }) => item.id))
      .toEqual([report.id])
    expect(mcpSheets.items.map((item: { id: string }) => item.id))
      .toEqual([budget.id])
    expect(none.items).toEqual([])
    expect(none.total).toBe(0)
  })

  it('counts research and schedule documents as chat, like the filter',
    async () => {
      const { report } = await seedLibrary()
      const research = await seedReadyDocument({
        userId: ownerId,
        format: 'docx',
        fileName: 'Research brief.docx',
        createdVia: 'research',
        minutesAgo: 3,
      })
      const scheduled = await seedReadyDocument({
        userId: ownerId,
        format: 'pdf',
        fileName: 'Weekly digest.pdf',
        createdVia: 'schedule',
        minutesAgo: 2,
      })
      const list = await importListHandler()
      const chat = await list(createEvent({ source: 'chat' }))
      const all = await list(createEvent())

      expect(chat.items.map((item: { id: string, source: string }) => {
        return [item.id, item.source]
      })).toEqual([
        [scheduled.id, 'chat'],
        [research.id, 'chat'],
        [report.id, 'chat'],
      ])
      expect(chat.total).toBe(3)
      expect(all.sourceCounts.chat).toBe(chat.total)
      expect(all.sourceCounts).toEqual({ chat: 3, mcp: 2 })
    })

  it('searches the file name and the title with escaped wildcards',
    async () => {
      const { report, deck, budget } = await seedLibrary()
      const list = await importListHandler()

      const byName = await list(createEvent({ query: 'launch' }))
      const wildcard = await list(createEvent({ query: '100%' }))
      const underscore = await list(createEvent({ query: 'budget' }))
      const noWildcardMatch = await list(createEvent({ query: '%' }))

      expect(byName.items.map((item: { id: string }) => item.id))
        .toEqual([deck.id])
      expect(wildcard.items.map((item: { id: string }) => item.id))
        .toEqual([budget.id])
      expect(underscore.items.map((item: { id: string }) => item.id))
        .toEqual([budget.id])
      expect(noWildcardMatch.items.map((item: { id: string }) => item.id))
        .toEqual([budget.id])

      await testDb.db.update(schema.documents)
        .set({ title: 'Annual summary' })
        .where(eq(schema.documents.id, report.id))

      const byTitle = await list(createEvent({ query: 'annual' }))

      expect(byTitle.items.map((item: { id: string }) => item.id))
        .toEqual([report.id])
    })

  it('shows the renamed file name as the title', async () => {
    const { report } = await seedLibrary()

    await testDb.db.update(schema.files)
      .set({ name: 'Renamed plan.pdf' })
      .where(eq(schema.files.name, 'Quarterly report.pdf'))

    const list = await importListHandler()
    const result = await list(createEvent({ query: 'renamed' }))

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: report.id,
      title: 'Renamed plan',
      fileName: 'Renamed plan.pdf',
    })
  })

  it('paginates with offset and limit and keeps the total', async () => {
    const { report, deck, budget } = await seedLibrary()
    const list = await importListHandler()

    const first = await list(createEvent({ limit: '2' }))
    const second = await list(createEvent({ limit: '2', offset: '2' }))

    expect(first.items.map((item: { id: string }) => item.id))
      .toEqual([budget.id, deck.id])
    expect(second.items.map((item: { id: string }) => item.id))
      .toEqual([report.id])
    expect(first.total).toBe(3)
    expect(second.total).toBe(3)
  })

  it('leaves out documents that are not ready or lost their file',
    async () => {
      const { report, deck } = await seedLibrary()

      await seedDocument(testDb.db, {
        userId: ownerId,
        format: 'docx',
        status: 'spec_ready',
      })
      await seedDocument(testDb.db, {
        userId: ownerId,
        format: 'docx',
        status: 'failed',
        errorCode: 'file_deleted',
      })
      await testDb.db.update(schema.documents)
        .set({ status: 'failed', errorCode: 'file_deleted', fileId: null })
        .where(eq(schema.documents.id, deck.id))
      await testDb.db.delete(schema.files)
        .where(eq(schema.files.name, 'Quarterly report.pdf'))

      const list = await importListHandler()
      const result = await list(createEvent())

      expect(result.items.map((item: { id: string }) => item.id))
        .not.toContain(deck.id)
      expect(result.items.map((item: { id: string }) => item.id))
        .not.toContain(report.id)
      expect(result.total).toBe(1)
      expect(result.formatCounts).toEqual({
        pdf: 0,
        docx: 0,
        pptx: 0,
        xlsx: 1,
      })
      expect(result.sourceCounts).toEqual({ chat: 0, mcp: 1 })
    })

  it('keeps a document whose origin chat was deleted', async () => {
    const { chat, report } = await seedLibrary()

    await testDb.db.update(schema.documents)
      .set({ originChatId: null })
      .where(eq(schema.documents.id, report.id))

    const list = await importListHandler()
    const result = await list(createEvent({ source: 'chat' }))

    expect(chat.slug).toBeTruthy()
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: report.id,
      originChatSlug: null,
      originChatTitle: null,
    })
  })

  it('reads the page, the total and the counts in one D1 batch with '
    + 'unique column names', async () => {
    await seedLibrary()

    const batchSpy = vi.spyOn(testDb.db, 'batch')
    const list = await importListHandler()

    await list(createEvent())

    expect(batchSpy).toHaveBeenCalledTimes(1)

    const statements = batchSpy.mock.calls[0]![0] as unknown as Array<{
      toSQL: () => { sql: string }
    }>
    const itemsSql = statements[0]!.toSQL().sql

    expect(statements).toHaveLength(3)
    expect(itemsSql).toContain('as "file_row_id"')
    expect(itemsSql).toContain('as "origin_chat_title"')
  })

  it('rejects invalid query parameters', async () => {
    await seedLibrary()

    const list = await importListHandler()

    await expect(list(createEvent({ format: 'txt' }))).rejects
      .toMatchObject({ status: 400 })
    await expect(list(createEvent({ source: 'research' }))).rejects
      .toMatchObject({ status: 400 })
    await expect(list(createEvent({ limit: '1000' }))).rejects
      .toMatchObject({ status: 400 })
  })

  it('returns 404 when the documents feature is off', async () => {
    await seedLibrary()
    mocks.featureActive = false

    const list = await importListHandler()

    await expect(list(createEvent())).rejects.toMatchObject({ status: 404 })
    expect(mocks.requireFeature).toHaveBeenCalledWith(
      expect.anything(),
      'documents',
    )
  })

  it('rejects a request without a session', async () => {
    await seedLibrary()
    mocks.sessionUserId = 0

    const list = await importListHandler()

    await expect(list(createEvent())).rejects.toMatchObject({ status: 401 })
  })

  it('logs the list operation without the search text', async () => {
    await seedLibrary()

    const list = await importListHandler()

    await list(createEvent({ query: 'launch', format: 'pptx' }))

    expect(mocks.logger.set).toHaveBeenCalledWith({
      userId: ownerId,
      attributes: {
        documents: {
          operation: 'list',
          hasQuery: true,
          format: 'pptx',
          source: null,
          total: 1,
        },
      },
    })
  })
})
