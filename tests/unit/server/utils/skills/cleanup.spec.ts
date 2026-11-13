import { getTableColumns, getTableName, is } from 'drizzle-orm'
import { SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import {
  createFakeSkillBucket,
  putFakeBlob,
  seedSkill,
  seedSkillVersion,
  shaOf,
} from '../../../../setup/helpers/skills-db'
import type { FakeSkillBucket } from '../../../../setup/helpers/skills-db'

const mocks = vi.hoisted(() => ({
  invalidateStorageCache: vi.fn(async () => undefined),
  invalidateFileCache: vi.fn(async () => undefined),
  logger: { set: vi.fn() },
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: mocks.invalidateStorageCache,
}))

vi.mock('~~/server/utils/files/convert-files-for-ai', () => ({
  invalidateFileCache: mocks.invalidateFileCache,
}))

const { cleanupSkillsForDeletedChats, purgeUserSkills } = await import(
  '~~/server/utils/skills/cleanup'
)
const { deleteChat } = await import('~~/server/utils/chats/lifecycle')

const SKILLS_TABLES = [
  schema.skills,
  schema.skillVersions,
  schema.skillFiles,
  schema.skillChatSettings,
]

describe('skills tables', () => {
  it('lists every skills table the schema exports', () => {
    const exportedSkillsTables = Object.values(schema).filter((value) => {
      return is(value, SQLiteTable) && getTableName(value).startsWith('skill')
    })

    expect(new Set(exportedSkillsTables)).toEqual(new Set(SKILLS_TABLES))
  })

  it.each(SKILLS_TABLES.map((table) => {
    return [getTableName(table), table] as const
  }))('%s carries user_id and no foreign key', (_name, table) => {
    expect(getTableColumns(table)).toHaveProperty('userId')

    const foreignKeys = getTableConfig(table).foreignKeys

    expect(foreignKeys).toHaveLength(0)
  })
})

describe('skills deletion hooks', () => {
  let testDb: MemoryExtractionTestDb
  let bucket: FakeSkillBucket
  let userId: number
  let otherUserId: number

  async function countRows(table: typeof SKILLS_TABLES[number]) {
    const rows = await testDb.db.select().from(table)

    return rows.length
  }

  async function seedFullSkill(owner: number) {
    const skillId = await seedSkill(testDb.db, owner)

    await seedSkillVersion(testDb.db, {
      skillId,
      userId: owner,
      version: 1,
      files: [
        { path: 'SKILL.md', sha256: shaOf(`a${owner}`) },
        { path: 'references/b.md', sha256: shaOf(`b${owner}`) },
      ],
    })
    putFakeBlob(bucket, owner, skillId, shaOf(`a${owner}`))
    putFakeBlob(bucket, owner, skillId, shaOf(`b${owner}`))

    return skillId
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    testDb = createMemoryExtractionTestDb()
    bucket = createFakeSkillBucket()
    userId = await seedUser(testDb.db, null)
    otherUserId = await seedUser(testDb.db, null)
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useFileStorage', () => bucket)
    vi.stubGlobal('invalidateFileCache', mocks.invalidateFileCache)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('purgeUserSkills', () => {
    async function seedUserData(owner: number) {
      const skillId = await seedFullSkill(owner)
      const chat = await seedChat(testDb.db, owner)

      await testDb.db.insert(schema.skillChatSettings).values({
        userId: owner,
        chatPublicId: chat.id,
        skillId,
        enabled: true,
      })
      bucket.objects.set(`skills-staging/u${owner}/stage1/SKILL.md`, {
        bytes: new Uint8Array([1]),
        uploaded: new Date(),
      })
    }

    it('deletes the rows of every skills table for the user', async () => {
      await seedUserData(userId)
      await seedUserData(otherUserId)

      const result = await purgeUserSkills(
        testDb.db,
        userId,
        mocks.logger,
        bucket,
      )

      expect(result).toEqual({
        skillsDeleted: 1,
        skillVersionsDeleted: 1,
        skillFilesDeleted: 2,
        skillChatSettingsDeleted: 1,
        skillObjectsDeleted: 2,
        skillStagingObjectsDeleted: 1,
      })

      for (const table of SKILLS_TABLES) {
        const rows = await testDb.db.select().from(table)

        expect(rows.every((row) => {
          return (row as { userId: number }).userId === otherUserId
        })).toBe(true)
        expect(rows.length).toBeGreaterThan(0)
      }
    })

    it('deletes both R2 prefixes of the user and nothing else', async () => {
      await seedUserData(userId)
      await seedUserData(otherUserId)

      await purgeUserSkills(testDb.db, userId, mocks.logger, bucket)

      const remainingKeys = [...bucket.objects.keys()]

      expect(remainingKeys).toHaveLength(3)
      expect(remainingKeys.every((key) => {
        return key.includes(`/u${otherUserId}/`)
      })).toBe(true)
      expect(bucket.listCalls.map((call) => {
        return call.prefix
      })).toEqual([`user-skills/u${userId}/`, `skills-staging/u${userId}/`])
    })

    it('does not purge a user whose id is a prefix of another id', async () => {
      const ownerWithLongerId = 1 + (userId * 10)

      await seedFullSkill(ownerWithLongerId)

      const result = await purgeUserSkills(
        testDb.db,
        userId,
        mocks.logger,
        bucket,
      )

      expect(result.skillObjectsDeleted).toBe(0)
      expect(bucket.objects.size).toBe(2)
    })

    it('removes the rows before the objects and rethrows an R2 failure', async () => {
      await seedUserData(userId)
      bucket.list.mockRejectedValueOnce(new Error('r2 down'))

      await expect(
        purgeUserSkills(testDb.db, userId, mocks.logger, bucket),
      ).rejects.toThrow('r2 down')

      expect(await countRows(schema.skills)).toBe(0)
      expect(bucket.objects.size).toBe(3)

      const retried = await purgeUserSkills(
        testDb.db,
        userId,
        mocks.logger,
        bucket,
      )

      expect(retried.skillObjectsDeleted).toBe(2)
      expect(bucket.objects.size).toBe(0)
    })

    it('logs the counts', async () => {
      await seedUserData(userId)
      await purgeUserSkills(testDb.db, userId, mocks.logger, bucket)

      expect(mocks.logger.set).toHaveBeenCalledWith({
        attributes: {
          skills: {
            cleanup: {
              purge: expect.objectContaining({ skillsDeleted: 1 }),
            },
          },
        },
      })
    })
  })

  describe('cleanupSkillsForDeletedChats', () => {
    it('removes the per-chat settings of the deleted chats only', async () => {
      const skillId = await seedFullSkill(userId)
      const firstChat = await seedChat(testDb.db, userId)
      const secondChat = await seedChat(testDb.db, userId)
      const keptChat = await seedChat(testDb.db, userId)

      for (const chat of [firstChat, secondChat, keptChat]) {
        await testDb.db.insert(schema.skillChatSettings).values({
          userId,
          chatPublicId: chat.id,
          skillId,
          enabled: true,
        })
      }

      const result = await cleanupSkillsForDeletedChats(testDb.db, {
        userId,
        chatIds: [firstChat.id, secondChat.id],
        logger: mocks.logger,
      })
      const remaining = await testDb.db.select().from(schema.skillChatSettings)

      expect(result.rowsDeleted).toBe(2)
      expect(remaining.map((row) => {
        return row.chatPublicId
      })).toEqual([keptChat.id])
    })

    it('never touches the settings of another user', async () => {
      const skillId = await seedFullSkill(otherUserId)
      const chat = await seedChat(testDb.db, otherUserId)

      await testDb.db.insert(schema.skillChatSettings).values({
        userId: otherUserId,
        chatPublicId: chat.id,
        skillId,
        enabled: true,
      })

      const result = await cleanupSkillsForDeletedChats(testDb.db, {
        userId,
        chatIds: [chat.id],
        logger: mocks.logger,
      })

      expect(result.rowsDeleted).toBe(0)
      expect(await countRows(schema.skillChatSettings)).toBe(1)
    })

    it('chunks long id lists under the bound-parameter limit', async () => {
      const chatIds = Array.from({ length: 250 }, (_value, index) => {
        return `skl${index + 1000}`
      })

      const result = await cleanupSkillsForDeletedChats(testDb.db, {
        userId,
        chatIds,
        logger: mocks.logger,
      })

      expect(result.rowsDeleted).toBe(0)
    })

    it('swallows a database failure and logs it', async () => {
      const failingDb = {
        delete: () => {
          throw new Error('d1 down')
        },
      } as unknown as typeof testDb.db

      const result = await cleanupSkillsForDeletedChats(failingDb, {
        userId,
        chatIds: ['skl1'],
        logger: mocks.logger,
      })

      expect(result.rowsDeleted).toBe(0)
      expect(mocks.logger.set).toHaveBeenCalledWith({
        attributes: {
          skills: {
            cleanup: {
              chatDelete: { rowsDeleted: 0, error: 'd1 down' },
            },
          },
        },
      })
    })

    it('runs when a chat is deleted through the lifecycle', async () => {
      const skillId = await seedFullSkill(userId)
      const chat = await seedChat(testDb.db, userId)

      await testDb.db.insert(schema.skillChatSettings).values({
        userId,
        chatPublicId: chat.id,
        skillId,
        enabled: false,
      })

      await deleteChat(
        testDb.db,
        userId,
        { id: chat.id, projectId: null },
        mocks.logger,
      )

      expect(await countRows(schema.skillChatSettings)).toBe(0)
      expect(await countRows(schema.skills)).toBe(1)
    })
  })
})
