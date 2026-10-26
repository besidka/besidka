import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedEntry,
  seedProject,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  params: { slug: '' } as Record<string, string>,
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({ set: mocks.loggerSet }),
}))

vi.mock('~~/server/utils/http/get-decoded-router-params', () => ({
  getDecodedRouterParams: () => mocks.params,
}))

async function loadHandler() {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/memory.patch'
  )

  return module.default
}

describe('PATCH /api/v1/chats/:slug/memory', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    vi.resetModules()
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, { memoryEnabled: true })

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal(
      'readValidatedBody',
      async (event: { body: unknown }, parser: (body: unknown) => unknown) => {
        return parser(event.body)
      },
    )
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: String(userId) },
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.close()
  })

  async function call(slug: string, body: unknown) {
    const handler = await loadHandler()

    mocks.params = { slug }

    return await handler({ body } as never)
  }

  async function readChatRow(chatId: string) {
    return await testDb.db.query.chats.findFirst({ where: { id: chatId } })
  }

  async function readEntry(entryId: string) {
    return await testDb.db.query.memoryEntries.findFirst({
      where: { id: entryId },
    })
  }

  it('rejects unauthenticated requests', async () => {
    const chat = await seedChat(testDb.db, userId)

    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    await expect(call(chat.slug, { excluded: true }))
      .rejects.toMatchObject({ status: 401 })
    expect((await readChatRow(chat.id))?.memoryExcluded).toBeNull()
  })

  it('rejects an invalid body', async () => {
    const chat = await seedChat(testDb.db, userId)

    await expect(call(chat.slug, {})).rejects.toMatchObject({ status: 400 })
    await expect(call(chat.slug, { excluded: 'yes' }))
      .rejects.toMatchObject({ status: 400 })
  })

  it('answers 404 for a foreign chat and leaves it untouched', async () => {
    const otherUserId = await seedUser(testDb.db, {})
    const foreignChat = await seedChat(testDb.db, otherUserId)
    const foreignEntry = await seedEntry(testDb.db, otherUserId, {
      sourceChatIds: [foreignChat.id],
    })

    await expect(call(foreignChat.slug, { excluded: true }))
      .rejects.toMatchObject({ status: 404 })
    expect((await readChatRow(foreignChat.id))?.memoryExcluded).toBeNull()
    expect(await readEntry(foreignEntry)).toBeDefined()
  })

  it('sets the flag without touching the activity time', async () => {
    const chat = await seedChat(testDb.db, userId)
    const before = await readChatRow(chat.id)

    await expect(call(chat.slug, { excluded: true }))
      .resolves.toEqual({ memoryExcluded: true })

    const after = await readChatRow(chat.id)

    expect(after?.memoryExcluded).toBe(true)
    expect(after?.activityAt.getTime()).toBe(before?.activityAt.getTime())
  })

  it('removes the chat from memory provenance when turned on', async () => {
    const chat = await seedChat(testDb.db, userId)
    const otherChat = await seedChat(testDb.db, userId)
    const onlyFromChat = await seedEntry(testDb.db, userId, {
      slug: 'only-from-chat',
      sourceChatIds: [chat.id],
    })
    const sharedWithOther = await seedEntry(testDb.db, userId, {
      slug: 'shared-with-other',
      sourceChatIds: [chat.id, otherChat.id],
    })
    const savedByUser = await seedEntry(testDb.db, userId, {
      slug: 'saved-by-user',
      origin: 'user',
      sourceChatIds: [chat.id],
    })

    await call(chat.slug, { excluded: true })

    expect(await readEntry(onlyFromChat)).toBeUndefined()
    expect((await readEntry(sharedWithOther))?.sourceChatIds)
      .toEqual([otherChat.id])
    expect((await readEntry(savedByUser))?.sourceChatIds).toEqual([])
  })

  it('marks the project memory stale for an excluded project chat',
    async () => {
      const projectId = await seedProject(testDb.db, userId, {
        memoryStatus: 'ready',
      })
      const chat = await seedChat(testDb.db, userId, { projectId })

      await call(chat.slug, { excluded: true })

      const project = await testDb.db.query.projects.findFirst({
        where: { id: projectId },
      })

      expect(project?.memoryStatus).toBe('stale')
    })

  it('clears the flag and keeps memory as it is when turned off',
    async () => {
      const chat = await seedChat(testDb.db, userId, { memoryExcluded: true })
      const entry = await seedEntry(testDb.db, userId, {
        sourceChatIds: [chat.id],
      })

      await expect(call(chat.slug, { excluded: false }))
        .resolves.toEqual({ memoryExcluded: false })
      expect((await readChatRow(chat.id))?.memoryExcluded).toBe(false)
      expect((await readEntry(entry))?.sourceChatIds).toEqual([chat.id])
    })
})
