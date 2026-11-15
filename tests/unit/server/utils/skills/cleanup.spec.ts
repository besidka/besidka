import { eq, getTableColumns, getTableName, is } from 'drizzle-orm'
import { SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedProject,
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

const {
  cleanupSkillsForDeletedChats,
  deleteUserSkill,
  purgeUserSkills,
} = await import(
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

  it('keeps nullable provenance columns on skill_versions', () => {
    const columns = getTableColumns(schema.skillVersions)

    for (const name of [
      'sourceKind',
      'sourceUrl',
      'sourceRef',
      'sourcePath',
      'sourceVersion',
    ] as const) {
      expect(columns[name].notNull).toBe(false)
      expect(columns[name].hasDefault).toBe(false)
    }
  })

  it.each(SKILLS_TABLES.map((table) => {
    return [getTableName(table), table] as const
  }))('%s carries user_id and no foreign key', (_name, table) => {
    expect(getTableColumns(table)).toHaveProperty('userId')

    const foreignKeys = getTableConfig(table).foreignKeys

    expect(foreignKeys).toHaveLength(0)
  })
})

describe('project_skills table', () => {
  it('carries user_id and no foreign key', () => {
    expect(getTableColumns(schema.projectSkills)).toHaveProperty('userId')
    expect(getTableConfig(schema.projectSkills).foreignKeys).toHaveLength(0)
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

  describe('deleteUserSkill', () => {
    it('drops the storage stats cache of the user', async () => {
      const skillId = await seedFullSkill(userId)

      await deleteUserSkill(testDb.db, {
        userId,
        skillId,
        logger: mocks.logger,
      }, bucket)

      expect(mocks.invalidateStorageCache)
        .toHaveBeenCalledWith(userId, mocks.logger)
    })

    it('deletes the project pins of the skill and no other pin', async () => {
      const skillId = await seedFullSkill(userId)
      const otherSkillId = await seedFullSkill(userId)
      const projectId = await seedProject(testDb.db, userId)

      await testDb.db.insert(schema.projectSkills).values([
        { projectId, skillId, userId, level: 'always', position: 0 },
        {
          projectId,
          skillId: otherSkillId,
          userId,
          level: 'prefer',
          position: 1,
        },
      ])

      const result = await deleteUserSkill(testDb.db, {
        userId,
        skillId,
        logger: mocks.logger,
      }, bucket)
      const pins = await testDb.db.select().from(schema.projectSkills)

      expect(result.projectSkillsDeleted).toBe(1)
      expect(pins.map(pin => pin.skillId)).toEqual([otherSkillId])
    })

    it('keeps the cache when the skill is not the caller\'s', async () => {
      const skillId = await seedFullSkill(otherUserId)

      await deleteUserSkill(testDb.db, {
        userId,
        skillId,
        logger: mocks.logger,
      }, bucket)

      expect(mocks.invalidateStorageCache).not.toHaveBeenCalled()
    })
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
      await testDb.db.insert(schema.projectSkills).values({
        projectId: await seedProject(testDb.db, owner),
        skillId,
        userId: owner,
        level: 'always',
        position: 0,
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
        providerCopiesDeleted: 0,
        providerCopiesFailed: 0,
        skillsDeleted: 1,
        skillVersionsDeleted: 1,
        skillFilesDeleted: 2,
        skillChatSettingsDeleted: 1,
        projectSkillsDeleted: 1,
        skillObjectsDeleted: 2,
        skillStagingObjectsDeleted: 1,
      })

      for (const table of [...SKILLS_TABLES, schema.projectSkills]) {
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

  describe('provider copies', () => {
    function stubProvider(status = 204) {
      const calls: string[] = []
      const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
        calls.push(`${init?.method} ${String(url)}`)

        return init?.method === 'GET'
          ? new Response(JSON.stringify({ data: [] }), { status: 200 })
          : new Response(null, { status })
      })

      vi.stubGlobal('fetch', fetcher)
      vi.stubGlobal('useDecryptText', async (value: string) => value)

      return calls
    }

    async function seedAnthropicKey(owner: number) {
      await testDb.db.insert(schema.keys).values({
        userId: owner,
        provider: 'anthropic',
        apiKey: 'sk-ant-test',
      })
    }

    async function seedUploadedSkill(owner: number) {
      const skillId = await seedFullSkill(owner)

      await testDb.db.update(schema.skills)
        .set({
          allowScripts: true,
          providerSkillId: 'skill_01',
          providerSkillVersion: '1:1759178010',
          providerUploadedName: 'a-skill',
        })
        .where(eq(schema.skills.id, skillId))

      return skillId
    }

    it('deletes the Anthropic copy when the skill is deleted', async () => {
      await seedAnthropicKey(userId)

      const calls = stubProvider()
      const skillId = await seedUploadedSkill(userId)
      const result = await deleteUserSkill(testDb.db, {
        userId,
        skillId,
        logger: mocks.logger,
      }, bucket)

      expect(result.providerCopy).toBe('deleted')
      expect(calls).toContain(
        'DELETE https://api.anthropic.com/v1/skills/skill_01',
      )
      expect(await countRows(schema.skills)).toBe(0)
    })

    it('still deletes the skill and reports a failed provider delete', async () => {
      await seedAnthropicKey(userId)
      stubProvider(500)

      const skillId = await seedUploadedSkill(userId)
      const result = await deleteUserSkill(testDb.db, {
        userId,
        skillId,
        logger: mocks.logger,
      }, bucket)

      expect(result.skillDeleted).toBe(true)
      expect(result.providerCopy).toBe('failed')
    })

    it('makes no provider request for a skill that was never uploaded', async () => {
      const calls = stubProvider()
      const skillId = await seedFullSkill(userId)
      const result = await deleteUserSkill(testDb.db, {
        userId,
        skillId,
        logger: mocks.logger,
      }, bucket)

      expect(result.providerCopy).toBe('none')
      expect(calls).toEqual([])
    })

    it('deletes the copies of the account before its rows go', async () => {
      await seedAnthropicKey(userId)

      const calls = stubProvider()

      await seedUploadedSkill(userId)

      const result = await purgeUserSkills(
        testDb.db,
        userId,
        mocks.logger,
        bucket,
      )

      expect(result).toMatchObject({
        providerCopiesDeleted: 1,
        providerCopiesFailed: 0,
        skillsDeleted: 1,
      })
      expect(calls).toContain(
        'DELETE https://api.anthropic.com/v1/skills/skill_01',
      )
      expect(await countRows(schema.skills)).toBe(0)
    })

    it('does not stop the purge when a copy cannot be deleted', async () => {
      stubProvider()
      await seedUploadedSkill(userId)

      const result = await purgeUserSkills(
        testDb.db,
        userId,
        mocks.logger,
        bucket,
      )

      expect(result).toMatchObject({
        providerCopiesFailed: 1,
        skillsDeleted: 1,
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
