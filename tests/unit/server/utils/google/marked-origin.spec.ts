import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import {
  chatHoldsGoogleData,
  chatMarkedOriginExtras,
} from '~~/server/utils/tool-approval/google'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedMessage,
  seedProject,
  seedUser,
  textPart,
} from '~~/tests/setup/helpers/memory-extraction-db'
import type { MemoryExtractionTestDb } from '~~/tests/setup/helpers/memory-extraction-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

describe('chatMarkedOriginExtras in the chat query of the send route', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
  })

  afterEach(() => {
    testDb.close()
  })

  async function loadChat(slug: string) {
    return await testDb.db.query.chats.findFirst({
      where: { slug, userId },
      columns: {
        id: true,
        projectId: true,
        branchedFromShareSlug: true,
        googleDataAt: true,
      },
      extras: chatMarkedOriginExtras(),
      with: {
        project: {
          columns: {
            id: true,
            name: true,
            instructions: true,
            memory: true,
            memoryStatus: true,
            memoryMigratedAt: true,
            useAccountMemory: true,
          },
        },
        messages: {
          columns: {
            id: true,
            publicId: true,
            role: true,
            parts: true,
            tools: true,
            reasoning: true,
            usage: true,
            createdAt: true,
          },
          orderBy: { id: 'asc' },
        },
      },
    })
  }

  async function insertArtifact(
    originChatId: string,
    googleDerivedAt: Date | null,
  ) {
    await testDb.db.insert(schema.artifacts).values({
      userId,
      originChatId,
      kind: 'html',
      title: 'Plan',
      currentVersion: 1,
      totalBytes: 10,
      createdVia: 'chat',
      googleDerivedAt,
    })
  }

  async function insertDocument(
    originChatId: string,
    googleDerivedAt: Date | null,
  ) {
    await testDb.db.insert(schema.documents).values({
      userId,
      originChatId,
      format: 'pdf',
      status: 'ready',
      createdVia: 'chat',
      googleDerivedAt,
    })
  }

  it('reads false for a chat with unmarked artifacts and documents, and '
    + 'keeps the project and the messages', async () => {
    const projectId = await seedProject(testDb.db, userId)
    const { id, slug } = await seedChat(testDb.db, userId, { projectId })

    await seedMessage(
      testDb.db,
      id,
      'user',
      [textPart('Hello')],
      new Date(1_000),
    )
    await insertArtifact(id, null)
    await insertDocument(id, null)

    const chat = await loadChat(slug)

    expect(Number(chat?.holdsMarkedOrigin)).toBe(0)
    expect(chat?.project?.id).toBe(projectId)
    expect(chat?.messages).toHaveLength(1)
    expect(chatHoldsGoogleData({
      googleDataAt: chat?.googleDataAt,
      messages: chat?.messages,
      holdsMarkedOrigin: chat?.holdsMarkedOrigin,
    })).toBe(false)
  })

  it('reads true for a marked artifact of the chat and not for another '
    + 'chat', async () => {
    const marked = await seedChat(testDb.db, userId)
    const other = await seedChat(testDb.db, userId)

    await insertArtifact(marked.id, new Date(1_000))

    const chat = await loadChat(marked.slug)

    expect(Number(chat?.holdsMarkedOrigin)).toBe(1)
    expect(chat?.googleDataAt).toBeNull()
    expect(chatHoldsGoogleData({
      googleDataAt: chat?.googleDataAt,
      messages: chat?.messages,
      holdsMarkedOrigin: chat?.holdsMarkedOrigin,
    })).toBe(true)
    expect(Number((await loadChat(other.slug))?.holdsMarkedOrigin)).toBe(0)
  })

  it('reads true for a marked document of the chat, with no message at all',
    async () => {
      const { id, slug } = await seedChat(testDb.db, userId)

      await insertDocument(id, new Date(1_000))

      const chat = await loadChat(slug)

      expect(Number(chat?.holdsMarkedOrigin)).toBe(1)
      expect(chat?.messages).toEqual([])
    })

  it('adds no query: the extra is part of the chat query', () => {
    const query = testDb.db.query.chats.findFirst({
      where: { slug: 'x' },
      columns: { id: true },
      extras: chatMarkedOriginExtras(),
    }).toSQL()

    expect(query.sql).toContain('exists')
    expect(query.sql).toContain('"artifacts"')
    expect(query.sql).toContain('"documents"')
  })
})

describe('chatHoldsGoogleData with a marked origin', () => {
  it('holds Google data for a marked origin without a flag or a part', () => {
    expect(chatHoldsGoogleData({ holdsMarkedOrigin: 1, messages: [] }))
      .toBe(true)
    expect(chatHoldsGoogleData({ holdsMarkedOrigin: 0, messages: [] }))
      .toBe(false)
    expect(chatHoldsGoogleData({ messages: [] })).toBe(false)
  })
})
