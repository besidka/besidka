import { getTableColumns, getTableName, is } from 'drizzle-orm'
import { SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import * as toolApprovalSchema from '~~/server/db/schemas/tool-approvals'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const {
  cleanupToolApprovalsForDeletedChats,
  purgeUserToolApprovals,
} = await import('~~/server/utils/tool-approval/cleanup')

const toolApprovalTables = Object.values(toolApprovalSchema).filter((value) => {
  return is(value, SQLiteTable)
}) as SQLiteTable[]

const exportedTableNames = toolApprovalTables.map(getTableName).sort()

describe('tool approval tables', () => {
  it('exports the three tables from the shared schema index', () => {
    expect(exportedTableNames).toEqual([
      'besidka_chat_settings',
      'besidka_tool_permissions',
      'tool_approval_claims',
    ])

    for (const table of toolApprovalTables) {
      expect(Object.values(schema)).toContain(table)
    }
  })

  it.each(toolApprovalTables.map((table) => {
    return [getTableName(table), table] as const
  }))('%s has no foreign key', (_name, table) => {
    expect(getTableConfig(table).foreignKeys).toHaveLength(0)
  })

  it('keeps defaults out of SQL', () => {
    for (const table of toolApprovalTables) {
      for (const column of Object.values(getTableColumns(table))) {
        expect(column.default).toBeUndefined()
      }
    }
  })

  it('has a user_id on every table, so the purge reaches each one', () => {
    for (const table of toolApprovalTables) {
      expect(getTableColumns(table), getTableName(table))
        .toHaveProperty('userId')
    }
  })
})

describe('tool approval deletion hooks', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let otherUserId: number
  const logger = { set: vi.fn() }

  async function seedToolApprovalData(owner: number, toolName = 'delete_chats') {
    const chat = await seedChat(testDb.db, owner)

    await testDb.db.insert(schema.besidkaToolPermissions).values({
      userId: owner,
      toolName,
      mode: 'allow',
    })
    await testDb.db.insert(schema.besidkaChatSettings).values({
      userId: owner,
      chatPublicId: chat.id,
      enabled: true,
      alwaysAllowTools: { [toolName]: 'hash' },
    })
    await testDb.db.insert(schema.toolApprovalClaims).values({
      approvalId: `approval_${owner}_${chat.id}`,
      userId: owner,
      chatPublicId: chat.id,
      messagePublicId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      status: 'claimed',
    })

    return { chatId: chat.id }
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    otherUserId = await seedUser(testDb.db, null)
  })

  afterEach(() => {
    testDb.close()
  })

  describe('purgeUserToolApprovals', () => {
    it('deletes the rows of every tool approval table for the user', async () => {
      await seedToolApprovalData(userId)
      await seedToolApprovalData(otherUserId)

      const result = await purgeUserToolApprovals(testDb.db, userId, logger)

      expect(result).toEqual({
        besidkaToolPermissionsDeleted: 1,
        besidkaChatSettingsDeleted: 1,
        toolApprovalClaimsDeleted: 1,
      })

      for (const table of toolApprovalTables) {
        const rows = await testDb.db.select().from(table)

        expect(rows, getTableName(table)).toHaveLength(1)
        expect((rows[0] as { userId: number }).userId).toBe(otherUserId)
      }
    })

    it('deletes from exactly the exported tool approval tables', async () => {
      const deletedTables: string[] = []
      const originalDelete = testDb.db.delete.bind(testDb.db)

      vi.spyOn(testDb.db, 'delete').mockImplementation(((table: SQLiteTable) => {
        deletedTables.push(getTableName(table))

        return originalDelete(table)
      }) as typeof testDb.db.delete)

      await purgeUserToolApprovals(testDb.db, userId, logger)

      expect(deletedTables.sort()).toEqual(exportedTableNames)
    })

    it('logs the counts by table without ids or tool names', async () => {
      await seedToolApprovalData(userId)
      await purgeUserToolApprovals(testDb.db, userId, logger)

      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          toolApprovals: {
            cleanup: {
              purge: {
                besidkaToolPermissionsDeleted: 1,
                besidkaChatSettingsDeleted: 1,
                toolApprovalClaimsDeleted: 1,
              },
            },
          },
        },
      })
    })

    it('rethrows so the account deletion stays retryable', async () => {
      const failingDb = {
        delete: () => {
          throw new Error('d1 down')
        },
      }

      await expect(purgeUserToolApprovals(failingDb as never, 1, logger))
        .rejects.toThrow('d1 down')
    })
  })

  describe('cleanupToolApprovalsForDeletedChats', () => {
    it('removes the chat settings and claims of the deleted chats only', async () => {
      const deleted = await seedToolApprovalData(userId)
      const kept = await seedToolApprovalData(userId, 'update_chat')
      const otherUsers = await seedToolApprovalData(otherUserId)

      const result = await cleanupToolApprovalsForDeletedChats(testDb.db, {
        userId,
        chatIds: [deleted.chatId],
        logger,
      })
      const settings = await testDb.db.select()
        .from(schema.besidkaChatSettings)
      const claims = await testDb.db.select().from(schema.toolApprovalClaims)

      expect(result).toEqual({ rowsDeleted: 2 })
      expect(settings.map(row => row.chatPublicId).sort())
        .toEqual([kept.chatId, otherUsers.chatId].sort())
      expect(claims.map(row => row.chatPublicId).sort())
        .toEqual([kept.chatId, otherUsers.chatId].sort())
    })

    it('leaves the user-wide tool permissions alone', async () => {
      const deleted = await seedToolApprovalData(userId)

      await cleanupToolApprovalsForDeletedChats(testDb.db, {
        userId,
        chatIds: [deleted.chatId],
        logger,
      })

      expect(await testDb.db.select().from(schema.besidkaToolPermissions))
        .toHaveLength(1)
    })

    it('does not delete another user’s rows for the same chat id', async () => {
      const mine = await seedToolApprovalData(userId)

      await cleanupToolApprovalsForDeletedChats(testDb.db, {
        userId: otherUserId,
        chatIds: [mine.chatId],
        logger,
      })

      expect(await testDb.db.select().from(schema.besidkaChatSettings))
        .toHaveLength(1)
    })

    it('handles more chat ids than one statement can bind', async () => {
      const seeded = []

      for (let index = 0; index < 3; index++) {
        seeded.push(await seedToolApprovalData(userId, `tool_${index}`))
      }

      const result = await cleanupToolApprovalsForDeletedChats(testDb.db, {
        userId,
        chatIds: [
          ...Array.from({ length: 100 }, (_value, index) => `skl9${index}`),
          ...seeded.map(item => item.chatId),
        ],
        logger,
      })

      expect(result.rowsDeleted).toBe(6)
    })

    it('does nothing for an empty list', async () => {
      await seedToolApprovalData(userId)

      expect(await cleanupToolApprovalsForDeletedChats(testDb.db, {
        userId,
        chatIds: [],
        logger,
      })).toEqual({ rowsDeleted: 0 })
      expect(logger.set).not.toHaveBeenCalled()
    })

    it('never throws and logs the error when the delete fails', async () => {
      const failingDb = {
        delete: () => {
          throw new Error('d1 down')
        },
      }

      const result = await cleanupToolApprovalsForDeletedChats(
        failingDb as never,
        { userId: 1, chatIds: ['skl1'], logger },
      )

      expect(result).toEqual({ rowsDeleted: 0 })
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          toolApprovals: {
            cleanup: {
              chatDelete: expect.objectContaining({ error: 'd1 down' }),
            },
          },
        },
      })
    })
  })
})
