import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import { createMemoryBlobStore } from '../../setup/helpers/artifacts-store'
import type { MemoryBlobStore } from '../../setup/helpers/artifacts-store'

const mocks = vi.hoisted(() => ({
  featureActive: true,
  requireFeature: vi.fn(),
  logger: { set: vi.fn() },
  storage: null as unknown as MemoryBlobStore,
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

vi.mock('~~/server/utils/artifacts/blob-store', () => ({
  useArtifactBlobStore: () => mocks.storage,
}))

const { createArtifact, appendArtifactVersion } = await import(
  '~~/server/utils/artifacts/store'
)

async function importHandler(path: string) {
  const module = await import(path)

  return module.default as (event: unknown) => Promise<any>
}

const handlers = {
  list: () => importHandler('../../../server/api/v1/artifacts/index.get'),
  detail: () => importHandler(
    '../../../server/api/v1/artifacts/[id]/index.get',
  ),
  version: () => importHandler(
    '../../../server/api/v1/artifacts/[id]/versions/[version].get',
  ),
  bulkDelete: () => importHandler(
    '../../../server/api/v1/artifacts/delete/bulk.post',
  ),
}

function createEvent(input: {
  params?: Record<string, string>
  query?: Record<string, string>
  body?: unknown
} = {}) {
  return {
    context: {},
    params: input.params ?? {},
    query: input.query ?? {},
    body: input.body,
    res: { headers: new Headers() },
  }
}

describe('artifacts owner API', () => {
  let testDb: MemoryExtractionTestDb
  let ownerId: number
  let strangerId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    mocks.storage = createMemoryBlobStore()
    ownerId = await seedUser(testDb.db, null)
    strangerId = await seedUser(testDb.db, null)
    mocks.sessionUserId = ownerId
    mocks.featureActive = true
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
    vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
      return event.params
    })
    vi.stubGlobal('readValidatedBody', async (
      event: { body: unknown },
      validate: (value: unknown) => unknown,
    ) => validate(event.body))
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  async function seedArtifacts() {
    const chat = await seedChat(testDb.db, ownerId)
    const quiz = await createArtifact({
      db: testDb.db,
      storage: mocks.storage,
      userId: ownerId,
      kind: 'html',
      title: 'Photosynthesis 100% quiz',
      content: '<p>v1</p>',
      originChatId: chat.id,
      createdVia: 'chat',
      createdBy: 'model',
    })

    await appendArtifactVersion({
      db: testDb.db,
      storage: mocks.storage,
      userId: ownerId,
      artifactId: quiz.artifactId,
      content: '<p>v2</p>',
      createdBy: 'model',
    })

    const diagram = await createArtifact({
      db: testDb.db,
      storage: mocks.storage,
      userId: ownerId,
      kind: 'mermaid',
      title: 'Cell diagram',
      content: 'graph TD; A-->B',
      createdVia: 'mcp',
      createdBy: 'mcp',
    })
    const foreign = await createArtifact({
      db: testDb.db,
      storage: mocks.storage,
      userId: strangerId,
      kind: 'svg',
      title: 'Stranger art',
      content: '<svg/>',
      createdVia: 'chat',
      createdBy: 'model',
    })

    return { chat, quiz, diagram, foreign }
  }

  it('lists only the owner artifacts with filters and escaped search', async () => {
    const { chat, quiz, diagram } = await seedArtifacts()
    const list = await handlers.list()

    const all = await list(createEvent())

    expect(all.total).toBe(2)
    expect(all.items.map((item: { id: string }) => item.id).sort()).toEqual(
      [quiz.artifactId, diagram.artifactId].sort(),
    )
    expect(all.items.find((item: { id: string }) => {
      return item.id === quiz.artifactId
    })).toEqual({
      id: quiz.artifactId,
      title: 'Photosynthesis 100% quiz',
      kind: 'html',
      currentVersion: 2,
      versionCount: 2,
      updatedAt: expect.any(String),
      originChatSlug: chat.slug,
      createdVia: 'chat',
      activeShareCount: 0,
      takenDown: false,
    })

    const byKind = await list(createEvent({ query: { kind: 'mermaid' } }))

    expect(byKind.items.map((item: { id: string }) => item.id))
      .toEqual([diagram.artifactId])

    const escaped = await list(createEvent({ query: { query: '100%' } }))
    const wildcard = await list(createEvent({ query: { query: '%' } }))

    expect(escaped.total).toBe(1)
    expect(wildcard.total).toBe(1)

    await expect(list(createEvent({ query: { kind: 'exe' } })))
      .rejects.toMatchObject({ status: 400 })
  })

  it('returns the detail with versions and no content', async () => {
    const { quiz } = await seedArtifacts()
    const detail = await handlers.detail()

    const result = await detail(createEvent({
      params: { id: quiz.artifactId },
    }))

    expect(result).toMatchObject({
      id: quiz.artifactId,
      totalBytes: 18,
      versions: [
        { version: 1, sizeBytes: 9, createdBy: 'model' },
        { version: 2, sizeBytes: 9, createdBy: 'model' },
      ],
    })
    expect(JSON.stringify(result)).not.toContain('<p>')
  })

  it('returns version content with a private no-store header', async () => {
    const { quiz } = await seedArtifacts()
    const version = await handlers.version()
    const event = createEvent({
      params: { id: quiz.artifactId, version: '1' },
    })

    await expect(version(event)).resolves.toMatchObject({
      version: 1,
      content: '<p>v1</p>',
    })
    expect(event.res.headers.get('Cache-Control'))
      .toBe('private, no-store')
  })

  it('answers 404 for another user on every route', async () => {
    const { foreign } = await seedArtifacts()

    await expect((await handlers.detail())(createEvent({
      params: { id: foreign.artifactId },
    }))).rejects.toMatchObject({ status: 404 })
    await expect((await handlers.version())(createEvent({
      params: { id: foreign.artifactId, version: '1' },
    }))).rejects.toMatchObject({ status: 404 })
    await expect((await handlers.bulkDelete())(createEvent({
      body: { ids: [foreign.artifactId] },
    }))).rejects.toMatchObject({ status: 404 })
    expect(mocks.storage.objects.size).toBe(4)
  })

  it('answers 404 on every route when the artifacts flag is off', async () => {
    const { quiz } = await seedArtifacts()

    mocks.featureActive = false

    for (const [name, event] of [
      ['list', createEvent()],
      ['detail', createEvent({ params: { id: quiz.artifactId } })],
      ['version', createEvent({ params: { id: quiz.artifactId, version: '1' } })],
      ['bulkDelete', createEvent({ body: { ids: [quiz.artifactId] } })],
    ] as const) {
      await expect(handlers[name]().then((handler) => {
        return handler(event)
      })).rejects.toMatchObject({ status: 404 })
    }

    expect(mocks.requireFeature).toHaveBeenCalledWith(
      expect.anything(),
      'artifacts',
    )
  })

  it('answers 401 without a session', async () => {
    mocks.sessionUserId = 0

    await expect((await handlers.list())(createEvent()))
      .rejects.toMatchObject({ status: 401 })
    expect(mocks.requireFeature).not.toHaveBeenCalled()
  })

  it('bulk deletes owned artifacts and their objects', async () => {
    const { quiz, diagram, foreign } = await seedArtifacts()
    const bulkDelete = await handlers.bulkDelete()

    await expect(bulkDelete(createEvent({
      body: { ids: [quiz.artifactId, foreign.artifactId] },
    }))).resolves.toEqual({
      deletedIds: [quiz.artifactId],
      heldIds: [],
    })
    expect(mocks.storage.objects.size).toBe(2)

    await expect(bulkDelete(createEvent({ body: { ids: [] } })))
      .rejects.toMatchObject({ status: 400 })
    await expect(bulkDelete(createEvent({
      body: { ids: Array.from({ length: 51 }, () => diagram.artifactId) },
    }))).rejects.toMatchObject({ status: 400 })
  })
})
