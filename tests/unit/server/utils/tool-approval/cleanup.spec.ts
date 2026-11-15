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

const {
  putToolApproval,
  putToolApprovalResult,
  putToolApprovalTurn,
  toolApprovalChatKey,
  toolApprovalKey,
  toolApprovalResultKey,
  toolApprovalTurnKey,
} = await import('~~/server/utils/tool-approval/kv')

function createFakeKv() {
  const values = new Map<string, string>()

  return {
    values,
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, value)
    }),
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    delete: vi.fn(async (key: string) => {
      values.delete(key)
    }),
  }
}

type FakeKv = ReturnType<typeof createFakeKv>

const MESSAGE_ID = '01JABCDEFGHJKMNPQRSTVWXYZ0'

async function seedKvRecords(
  kv: FakeKv,
  owner: { userId: number, chatPublicId: string },
  approvalId: string,
) {
  await putToolApproval(kv as never, approvalId, {
    version: 1,
    userId: owner.userId,
    chatPublicId: owner.chatPublicId,
    messagePublicId: MESSAGE_ID,
    toolCallId: 'call_1',
    family: 'native',
    access: 'write',
    toolName: 'create_artifact',
    connectorId: null,
    definitionHash: null,
    input: { title: 'Plan' },
    signature: 'sig',
    reason: 'default',
    rememberOptions: ['once'],
    summary: 'Create',
    auditCallId: null,
    snapshot: {
      model: 'claude-haiku-4-5',
      gateway: null,
      reasoning: 'off',
      toolNames: [],
      connectorIds: [],
    },
  })
  await putToolApprovalTurn(kv as never, `${MESSAGE_ID}-${approvalId}`.slice(0, 64), {
    version: 1,
    userId: owner.userId,
    chatPublicId: owner.chatPublicId,
    messagePublicId: `${MESSAGE_ID}-${approvalId}`.slice(0, 64),
    pendingApprovalIds: [approvalId],
    state: { taint: [], readSources: [], counters: {
      rounds: 0,
      steps: 0,
      connectorCalls: 0,
      builtInCalls: 0,
    } },
  })
  await putToolApprovalResult(kv as never, approvalId, {
    version: 1,
    userId: owner.userId,
    chatPublicId: owner.chatPublicId,
    messagePublicId: MESSAGE_ID,
    toolCallId: 'call_1',
    isError: false,
    output: 'ok',
    recordedAt: 1,
  })
}

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
  let kv: FakeKv

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
    kv = createFakeKv()
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

      const result = await purgeUserToolApprovals(
        testDb.db,
        userId,
        logger,
        kv as never,
      )

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

      await purgeUserToolApprovals(testDb.db, userId, logger, kv as never)

      expect(deletedTables.sort()).toEqual(exportedTableNames)
    })

    it('logs the counts by table without ids or tool names', async () => {
      await seedToolApprovalData(userId)
      await purgeUserToolApprovals(testDb.db, userId, logger, kv as never)

      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          toolApprovals: {
            cleanup: {
              purge: {
                besidkaToolPermissionsDeleted: 1,
                besidkaChatSettingsDeleted: 1,
                toolApprovalClaimsDeleted: 1,
                kvKeysDeleted: 0,
              },
            },
          },
        },
      })
    })

    it('rethrows so the account deletion stays retryable', async () => {
      const failingDb = {
        select: () => {
          throw new Error('d1 down')
        },
        delete: () => {
          throw new Error('d1 down')
        },
      }

      await expect(purgeUserToolApprovals(
        failingDb as never,
        1,
        logger,
        kv as never,
      )).rejects.toThrow('d1 down')
    })

    it('rethrows a D1 delete failure after the chats were listed', async () => {
      const failingDb = {
        select: testDb.db.select.bind(testDb.db),
        delete: () => {
          throw new Error('d1 delete down')
        },
      }

      await expect(purgeUserToolApprovals(
        failingDb as never,
        userId,
        logger,
        kv as never,
      )).rejects.toThrow('d1 delete down')
    })

    it('deletes the approval keys of every chat the user owns', async () => {
      const first = await seedChat(testDb.db, userId)
      const second = await seedChat(testDb.db, userId)
      const others = await seedChat(testDb.db, otherUserId)

      await seedKvRecords(kv, { userId, chatPublicId: first.id }, 'approval_first')
      await seedKvRecords(kv, { userId, chatPublicId: second.id }, 'approval_second')
      await seedKvRecords(
        kv,
        { userId: otherUserId, chatPublicId: others.id },
        'approval_other',
      )

      await purgeUserToolApprovals(testDb.db, userId, logger, kv as never)

      expect([...kv.values.keys()].sort()).toEqual([
        toolApprovalChatKey(others.id),
        toolApprovalKey('approval_other'),
        toolApprovalResultKey('approval_other'),
        toolApprovalTurnKey(`${MESSAGE_ID}-approval_other`.slice(0, 64)),
      ].sort())
      expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
        attributes: {
          toolApprovals: {
            cleanup: {
              purge: expect.objectContaining({ kvKeysDeleted: 6 }),
            },
          },
        },
      }))
    })

    it('rethrows a KV failure so the account deletion stays retryable', async () => {
      const chat = await seedChat(testDb.db, userId)

      await seedKvRecords(kv, { userId, chatPublicId: chat.id }, 'approval_first')
      kv.delete.mockRejectedValueOnce(new Error('kv down'))

      await expect(purgeUserToolApprovals(
        testDb.db,
        userId,
        logger,
        kv as never,
      )).rejects.toThrow('kv down')
    })

    it('reads no more than 200 chat indexes', async () => {
      for (let index = 0; index < 205; index++) {
        await seedChat(testDb.db, userId)
      }

      await purgeUserToolApprovals(testDb.db, userId, logger, kv as never)

      expect(kv.get).toHaveBeenCalledTimes(200)
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
        kv: kv as never,
      })
      const settings = await testDb.db.select()
        .from(schema.besidkaChatSettings)
      const claims = await testDb.db.select().from(schema.toolApprovalClaims)

      expect(result).toEqual({ rowsDeleted: 2, kvKeysDeleted: 0 })
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
        kv: kv as never,
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
        kv: kv as never,
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
        kv: kv as never,
      })

      expect(result.rowsDeleted).toBe(6)
    })

    it('does nothing for an empty list', async () => {
      await seedToolApprovalData(userId)

      expect(await cleanupToolApprovalsForDeletedChats(testDb.db, {
        userId,
        chatIds: [],
        logger,
        kv: kv as never,
      })).toEqual({ rowsDeleted: 0, kvKeysDeleted: 0 })
      expect(logger.set).not.toHaveBeenCalled()
      expect(kv.get).not.toHaveBeenCalled()
    })

    it('never throws and logs the error when the delete fails', async () => {
      const failingDb = {
        delete: () => {
          throw new Error('d1 down')
        },
      }

      const result = await cleanupToolApprovalsForDeletedChats(
        failingDb as never,
        { userId: 1, chatIds: ['skl1'], logger, kv: kv as never },
      )

      expect(result).toEqual({ rowsDeleted: 0, kvKeysDeleted: 0 })
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

    it('deletes the approval keys the chat index lists', async () => {
      const deleted = await seedToolApprovalData(userId)
      const kept = await seedToolApprovalData(userId, 'update_chat')

      await seedKvRecords(
        kv,
        { userId, chatPublicId: deleted.chatId },
        'approval_deleted',
      )
      await seedKvRecords(
        kv,
        { userId, chatPublicId: kept.chatId },
        'approval_kept',
      )

      const result = await cleanupToolApprovalsForDeletedChats(testDb.db, {
        userId,
        chatIds: [deleted.chatId],
        logger,
        kv: kv as never,
      })

      expect(result.kvKeysDeleted).toBe(3)
      expect([...kv.values.keys()].sort()).toEqual([
        toolApprovalChatKey(kept.chatId),
        toolApprovalKey('approval_kept'),
        toolApprovalResultKey('approval_kept'),
        toolApprovalTurnKey(`${MESSAGE_ID}-approval_kept`.slice(0, 64)),
      ].sort())
    })

    it('still deletes the KV keys when the D1 delete fails', async () => {
      const chat = await seedChat(testDb.db, userId)

      await seedKvRecords(kv, { userId, chatPublicId: chat.id }, 'approval_one')

      const failingDb = {
        delete: () => {
          throw new Error('d1 down')
        },
      }
      const result = await cleanupToolApprovalsForDeletedChats(
        failingDb as never,
        { userId, chatIds: [chat.id], logger, kv: kv as never },
      )

      expect(result.kvKeysDeleted).toBe(3)
      expect(kv.values.size).toBe(0)
    })

    it('still deletes the D1 rows and never throws when KV fails', async () => {
      const deleted = await seedToolApprovalData(userId)

      kv.get.mockRejectedValue(new Error('kv down'))

      const result = await cleanupToolApprovalsForDeletedChats(testDb.db, {
        userId,
        chatIds: [deleted.chatId],
        logger,
        kv: kv as never,
      })

      expect(result).toEqual({ rowsDeleted: 2, kvKeysDeleted: 0 })
      expect(await testDb.db.select().from(schema.toolApprovalClaims))
        .toHaveLength(0)
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          toolApprovals: {
            cleanup: {
              chatDelete: expect.objectContaining({ error: 'kv down' }),
            },
          },
        },
      })
    })

    it('skips a chat id that cannot name a KV key', async () => {
      await cleanupToolApprovalsForDeletedChats(testDb.db, {
        userId,
        chatIds: ['bad:id'],
        logger,
        kv: kv as never,
      })

      expect(kv.get).not.toHaveBeenCalled()
    })
  })
})
