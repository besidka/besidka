import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import { createMemoryBlobStore } from '../../../../setup/helpers/artifacts-store'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const { listChatArtifactIds } = await import(
  '~~/server/utils/artifacts/chat-artifacts'
)
const { createArtifact } = await import('~~/server/utils/artifacts/store')

describe('listChatArtifactIds', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let chatId: string
  const storage = createMemoryBlobStore()

  async function seed(
    title: string,
    owner = userId,
    originChatId: string | undefined = undefined,
  ) {
    const created = await createArtifact({
      db: testDb.db,
      storage,
      userId: owner,
      kind: 'markdown',
      title,
      content: 'body',
      originChatId,
      createdVia: 'chat',
      createdBy: 'model',
    })

    return created.artifactId
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    chatId = (await seedChat(testDb.db, userId)).id
  })

  afterEach(() => {
    testDb.close()
  })

  it('lists the artifacts created in the chat', async () => {
    const own = await seed('Own', userId, chatId)

    await seed('Elsewhere')

    await expect(listChatArtifactIds({
      db: testDb.db,
      userId,
      chatId,
    })).resolves.toEqual([own])
  })

  it('adds the artifacts the user attached to this chat', async () => {
    const own = await seed('Own', userId, chatId)
    const attached = await seed('Library page')

    const ids = await listChatArtifactIds({
      db: testDb.db,
      userId,
      chatId,
      attachedArtifactIds: [attached],
    })

    expect(ids).toHaveLength(2)
    expect(ids).toEqual(expect.arrayContaining([own, attached]))
  })

  it('never adds another user\'s artifact, garbage or an unknown id',
    async () => {
      const otherUserId = await seedUser(testDb.db, null)
      const foreign = await seed('Foreign', otherUserId)

      await expect(listChatArtifactIds({
        db: testDb.db,
        userId,
        chatId,
        attachedArtifactIds: [foreign, 'garbage'],
      })).resolves.toEqual([])
    })
})
