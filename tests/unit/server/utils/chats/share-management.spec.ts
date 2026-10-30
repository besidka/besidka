import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '~~/server/db/schema'
import {
  buildActiveShareFilter,
  revokeChatShares,
} from '~~/server/utils/chats/share-management'

import {
  createMemoryExtractionTestDb,
  seedChat,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const dialect = drizzle(new Database(':memory:')).dialect

function createDb(deletedRowsPerCall: Array<Array<{ chatId: string }>>) {
  const updates: unknown[] = []
  let deleteCalls = 0

  const db = {
    delete: () => {
      return {
        where: () => {
          return {
            returning: async () => {
              const rows = deletedRowsPerCall[deleteCalls] ?? []

              deleteCalls += 1

              return rows.map((row, index) => {
                return { id: `share-${deleteCalls}-${index}`, ...row }
              })
            },
          }
        },
      }
    },
    select: () => {
      const selectChain: Record<string, unknown> = {}

      for (const method of ['from', 'where']) {
        selectChain[method] = () => selectChain
      }

      return selectChain
    },
    update: () => {
      return {
        set: (values: unknown) => {
          updates.push(values)

          return { where: async () => undefined }
        },
      }
    },
  }

  return {
    db: db as unknown as ReturnType<typeof useDb>,
    updates,
    getDeleteCalls: () => deleteCalls,
  }
}

describe('buildActiveShareFilter', () => {
  it('matches shares that are neither revoked nor expired', () => {
    const now = new Date('2026-10-30T10:00:00.000Z')
    const query = dialect.sqlToQuery(buildActiveShareFilter(now)!)

    expect(query.sql).toContain('"chat_shares"."revoked" = ?')
    expect(query.sql).toContain('"chat_shares"."expires_at" is null')
    expect(query.sql).toContain('"chat_shares"."expires_at" > ?')
  })
})

describe('revokeChatShares', () => {
  it('reports the chats that had a share and clears the shared flag',
    async () => {
      const { db, updates } = createDb([[
        { chatId: 'c1' },
        { chatId: 'c1' },
        { chatId: 'c3' },
      ]])

      const result = await revokeChatShares(db, 1, ['c1', 'c2', 'c3'])

      expect(result).toEqual({
        deletedCount: 3,
        revokedChatIds: ['c1', 'c3'],
      })
      expect(updates).toEqual([{ shared: false }])
    })

  it('does nothing for an empty list', async () => {
    const { db, getDeleteCalls } = createDb([])

    await expect(revokeChatShares(db, 1, [])).resolves.toEqual({
      deletedCount: 0,
      revokedChatIds: [],
    })
    expect(getDeleteCalls()).toBe(0)
  })

  it('chunks large lists under the bound parameter limit', async () => {
    const chatIds = Array.from({ length: 100 }, (_value, index) => {
      return `c${index}`
    })
    const { db, getDeleteCalls } = createDb([
      [{ chatId: 'c0' }],
      [{ chatId: 'c95' }],
    ])

    const result = await revokeChatShares(db, 1, chatIds)

    expect(getDeleteCalls()).toBe(2)
    expect(result).toEqual({
      deletedCount: 2,
      revokedChatIds: ['c0', 'c95'],
    })
  })
})

describe('revokeChatShares ownership', () => {
  let testDb: MemoryExtractionTestDb

  beforeEach(() => {
    testDb = createMemoryExtractionTestDb()
  })

  afterEach(() => {
    testDb.close()
  })

  async function seedSharedChat(userId: number) {
    const chat = await seedChat(testDb.db, userId, { shared: true })

    await testDb.db.insert(schema.chatShares).values({ chatId: chat.id })

    return chat
  }

  async function readShareCount(chatId: string) {
    const rows = await testDb.db.select({ id: schema.chatShares.id })
      .from(schema.chatShares)
      .where(eq(schema.chatShares.chatId, chatId))

    return rows.length
  }

  it('does not revoke the share of a chat owned by someone else',
    async () => {
      const ownerId = await seedUser(testDb.db, {})
      const callerId = await seedUser(testDb.db, {})
      const ownChat = await seedSharedChat(callerId)
      const foreignChat = await seedSharedChat(ownerId)

      const result = await revokeChatShares(
        testDb.db,
        callerId,
        [ownChat.id, foreignChat.id],
      )

      expect(result.revokedChatIds).toEqual([ownChat.id])
      expect(result.deletedCount).toBe(1)
      expect(await readShareCount(ownChat.id)).toBe(0)
      expect(await readShareCount(foreignChat.id)).toBe(1)
    })
})
