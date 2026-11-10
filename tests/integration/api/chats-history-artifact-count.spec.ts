import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'

const mocks = vi.hoisted(() => ({
  logger: { set: vi.fn() },
  artifactsActive: true,
  sessionUserId: 0,
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

vi.mock('~~/server/utils/features/context', () => ({
  evaluateFeatureForEvent: vi.fn(async () => ({
    active: mocks.artifactsActive,
  })),
}))

async function getHistoryHandler() {
  const module = await import('../../../server/api/v1/chats/history/index.get')

  return module.default as (event: unknown) => Promise<any>
}

function createEvent(query: Record<string, string> = {}) {
  return { context: {}, query }
}

describe('chat history artifact count', () => {
  let testDb: MemoryExtractionTestDb
  let ownerId: number
  let strangerId: number

  async function seedArtifact(
    userId: number,
    originChatId: string | null,
    values: Partial<typeof schema.artifacts.$inferInsert> = {},
  ) {
    await testDb.db.insert(schema.artifacts).values({
      userId,
      originChatId: originChatId as string,
      kind: 'html',
      title: 'Artifact',
      currentVersion: 1,
      totalBytes: 10,
      createdVia: 'chat',
      ...values,
    })
  }

  beforeEach(async () => {
    vi.resetModules()
    testDb = createMemoryExtractionTestDb()
    mocks.artifactsActive = true
    ownerId = await seedUser(testDb.db, null)
    strangerId = await seedUser(testDb.db, null)
    mocks.sessionUserId = ownerId

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)
    vi.stubGlobal('useUserSession', async () => {
      return { user: { id: String(mocks.sessionUserId) } }
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw new Error('Unauthorized')
    })
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('counts only live artifacts created in each chat', async () => {
    const twoArtifacts = await seedChat(testDb.db, ownerId, {
      title: 'Two artifacts',
    })
    const oneArtifact = await seedChat(testDb.db, ownerId, {
      title: 'One artifact',
    })
    await seedChat(testDb.db, ownerId, { title: 'No artifacts' })

    await seedArtifact(ownerId, twoArtifacts.id)
    await seedArtifact(ownerId, twoArtifacts.id)
    await seedArtifact(ownerId, twoArtifacts.id, {
      takedownAt: new Date(),
    })
    await seedArtifact(ownerId, twoArtifacts.id, { currentVersion: 0 })
    await seedArtifact(ownerId, oneArtifact.id)
    await seedArtifact(ownerId, null)

    const handler = await getHistoryHandler()
    const response = await handler(createEvent())
    const countsByTitle = Object.fromEntries(
      response.chats.map((chat: { title: string, artifactCount: number }) => {
        return [chat.title, chat.artifactCount]
      }),
    )

    expect(countsByTitle).toEqual({
      'Two artifacts': 2,
      'One artifact': 1,
      'No artifacts': 0,
    })
  })

  it('never counts artifacts owned by other users', async () => {
    const chat = await seedChat(testDb.db, ownerId, { title: 'Mine' })

    await seedArtifact(ownerId, chat.id)
    await seedArtifact(strangerId, chat.id)
    await seedArtifact(strangerId, chat.id)

    const handler = await getHistoryHandler()
    const response = await handler(createEvent())

    expect(response.chats[0].artifactCount).toBe(1)

    mocks.sessionUserId = strangerId

    const strangerResponse = await handler(createEvent())

    expect(strangerResponse.chats).toEqual([])

    const strangerChat = await seedChat(testDb.db, strangerId, {
      title: 'Theirs',
    })

    await seedArtifact(strangerId, strangerChat.id)
    await seedArtifact(strangerId, strangerChat.id)

    const strangerWithChat = await handler(createEvent())

    expect(strangerWithChat.chats[0].artifactCount).toBe(2)

    mocks.sessionUserId = ownerId

    const ownerAgain = await handler(createEvent())

    expect(ownerAgain.chats[0].artifactCount).toBe(1)
  })

  it('counts on pinned chats and on title search results', async () => {
    const pinnedChat = await seedChat(testDb.db, ownerId, {
      title: 'Roadmap pinned',
      pinnedAt: new Date(),
    })
    const searchChat = await seedChat(testDb.db, ownerId, {
      title: 'Roadmap plain',
    })

    await seedArtifact(ownerId, pinnedChat.id)
    await seedArtifact(ownerId, searchChat.id)
    await seedArtifact(ownerId, searchChat.id)

    const handler = await getHistoryHandler()
    const listing = await handler(createEvent())

    expect(listing.pinned[0].artifactCount).toBe(1)
    expect(listing.chats[0].artifactCount).toBe(2)

    const search = await handler(createEvent({
      search: 'Roadmap',
      searchIn: 'title',
    }))

    expect(search.pinned[0].artifactCount).toBe(1)
    expect(search.chats[0].artifactCount).toBe(2)
  })

  it('counts on cursor-paginated pages', async () => {
    const first = await seedChat(testDb.db, ownerId, {
      title: 'Newer',
      activityAt: new Date('2026-10-02T00:00:00.000Z'),
    })
    const second = await seedChat(testDb.db, ownerId, {
      title: 'Older',
      activityAt: new Date('2026-10-01T00:00:00.000Z'),
    })

    await seedArtifact(ownerId, first.id)
    await seedArtifact(ownerId, second.id)
    await seedArtifact(ownerId, second.id)

    const handler = await getHistoryHandler()
    const firstPage = await handler(createEvent({ limit: '1' }))

    expect(firstPage.chats[0].artifactCount).toBe(1)
    expect(firstPage.nextCursor).not.toBeNull()

    const secondPage = await handler(createEvent({
      limit: '1',
      cursor: firstPage.nextCursor,
    }))

    expect(secondPage.chats[0].title).toBe('Older')
    expect(secondPage.chats[0].artifactCount).toBe(2)
  })

  it('omits the count when the user has no artifacts access', async () => {
    const chat = await seedChat(testDb.db, ownerId, { title: 'Hidden' })

    await seedArtifact(ownerId, chat.id)

    mocks.artifactsActive = false

    const handler = await getHistoryHandler()
    const response = await handler(createEvent())

    expect(response.chats).toHaveLength(1)
    expect(response.chats[0]).not.toHaveProperty('artifactCount')
  })
})
