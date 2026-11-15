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

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const {
  cleanupConnectorsForDeletedChats,
  purgeUserConnectors,
} = await import('~~/server/utils/connectors/cleanup')
const { encodePublicId } = await import('~~/server/utils/custom-db-types')

const REGISTRY_TABLE_NAME = 'mcp_registry_servers'

const exportedConnectorTables = Object.values(schema).filter((value) => {
  return is(value, SQLiteTable) && (
    getTableName(value).startsWith('connector')
    || getTableName(value) === REGISTRY_TABLE_NAME
  )
}) as SQLiteTable[]

const userTables = exportedConnectorTables.filter((table) => {
  return 'userId' in getTableColumns(table)
})

describe('connector tables', () => {
  it('exports the five user tables and the registry mirror', () => {
    expect(exportedConnectorTables.map(getTableName).sort()).toEqual([
      'connector_chat_settings',
      'connector_credentials',
      'connector_tool_calls',
      'connector_tool_settings',
      'connectors',
      REGISTRY_TABLE_NAME,
    ])
  })

  it.each(exportedConnectorTables.map((table) => {
    return [getTableName(table), table] as const
  }))('%s has no foreign key', (_name, table) => {
    expect(getTableConfig(table).foreignKeys).toHaveLength(0)
  })

  it('keeps defaults out of SQL', () => {
    for (const table of exportedConnectorTables) {
      for (const column of Object.values(getTableColumns(table))) {
        expect(column.default).toBeUndefined()
      }
    }
  })

  it('keeps user data out of the registry mirror', () => {
    expect(getTableColumns(schema.mcpRegistryServers))
      .not.toHaveProperty('userId')
  })
})

describe('connector deletion hooks', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let otherUserId: number
  const logger = { set: vi.fn() }

  let slugSequence = 0

  async function seedConnectorData(owner: number) {
    slugSequence += 1

    const [connector] = await testDb.db.insert(schema.connectors).values({
      userId: owner,
      slug: `example-${slugSequence}`,
      title: 'Example',
      origin: 'https://mcp.example.com',
      urlEncrypted: 'cipher',
      transport: 'streamable-http',
      status: 'ready',
      enabled: true,
      createdVia: 'app',
    }).returning({ id: schema.connectors.id })
    const connectorId = encodePublicId(connector!.id)
    const chat = await seedChat(testDb.db, owner)

    await testDb.db.insert(schema.connectorCredentials).values({
      userId: owner,
      connectorId,
      issuer: '',
      headerName: 'X-Key',
      headerValue: 'cipher',
    })
    await testDb.db.insert(schema.connectorToolSettings).values({
      userId: owner,
      connectorId,
      toolName: 'search',
      definitionHash: 'hash',
      serverReadOnly: true,
      enabled: true,
      approval: 'ask',
    })
    await testDb.db.insert(schema.connectorChatSettings).values({
      userId: owner,
      chatPublicId: chat.id,
      connectorId,
      enabled: true,
      alwaysAllowTools: {},
    })
    await testDb.db.insert(schema.connectorToolCalls).values({
      userId: owner,
      connectorId,
      connectorHost: 'mcp.example.com',
      chatPublicId: chat.id,
      toolName: 'search',
      argsHmac: 'hmac',
      resultBytes: 1,
      outcome: 'ok',
      approval: 'not-applicable',
      path: 'worker',
      durationMs: 1,
    })

    return { connectorId, chatId: chat.id }
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

  describe('purgeUserConnectors', () => {
    it('deletes the rows of every user-keyed connector table', async () => {
      await seedConnectorData(userId)
      await seedConnectorData(otherUserId)

      const result = await purgeUserConnectors(testDb.db, userId, logger)

      expect(result).toEqual({
        connectorsDeleted: 1,
        connectorCredentialsDeleted: 1,
        connectorToolSettingsDeleted: 1,
        connectorChatSettingsDeleted: 1,
        connectorToolCallsDeleted: 1,
      })

      for (const table of userTables) {
        const rows = await testDb.db.select().from(table)

        expect(rows, getTableName(table)).toHaveLength(1)
        expect((rows[0] as { userId: number }).userId).toBe(otherUserId)
      }
    })

    it('deletes from exactly the connector tables that have a user_id', async () => {
      const deletedTables: string[] = []
      const originalDelete = testDb.db.delete.bind(testDb.db)

      vi.spyOn(testDb.db, 'delete').mockImplementation(((table: SQLiteTable) => {
        deletedTables.push(getTableName(table))

        return originalDelete(table)
      }) as typeof testDb.db.delete)

      await purgeUserConnectors(testDb.db, userId, logger)

      expect(deletedTables.sort()).toEqual(
        userTables.map(getTableName).sort(),
      )
    })

    it('covers every connector table that has a user_id column', async () => {
      await seedConnectorData(userId)

      await purgeUserConnectors(testDb.db, userId, logger)

      for (const table of userTables) {
        expect(await testDb.db.select().from(table), getTableName(table))
          .toHaveLength(0)
      }

      expect(userTables.map(getTableName).sort()).toEqual([
        'connector_chat_settings',
        'connector_credentials',
        'connector_tool_calls',
        'connector_tool_settings',
        'connectors',
      ])
    })

    it('deletes the icon caches of every purged connector, not others', async () => {
      const { createFakeIconKv } = await import(
        '../../../../setup/helpers/connector-icon-kv'
      )
      const kv = createFakeIconKv()

      vi.stubGlobal('useKV', () => kv)
      await seedConnectorData(userId)
      await seedConnectorData(otherUserId)

      const rows = await testDb.db.select({
        id: schema.connectors.id,
        owner: schema.connectors.userId,
      }).from(schema.connectors)

      for (const row of rows) {
        const id = encodePublicId(row.id)

        await kv.put(`connectors:icon:${id}`, 'x')
        await kv.put(`connectors:icon-sources:${id}`, 'x')
      }

      await purgeUserConnectors(testDb.db, userId, logger)
      vi.unstubAllGlobals()

      const remaining = rows
        .filter(row => row.owner === otherUserId)
        .flatMap((row) => {
          const id = encodePublicId(row.id)

          return [`connectors:icon:${id}`, `connectors:icon-sources:${id}`]
        })

      expect([...kv.entries.keys()].sort()).toEqual(remaining.sort())
    })

    it('still purges when the icon cache cannot be reached', async () => {
      vi.stubGlobal('useKV', () => {
        throw new Error('KV down')
      })
      await seedConnectorData(userId)

      const result = await purgeUserConnectors(testDb.db, userId, logger)

      vi.unstubAllGlobals()

      expect(result.connectorsDeleted).toBe(1)
    })

    it('removes the audit rows with the account', async () => {
      await seedConnectorData(userId)
      await testDb.db.delete(schema.connectors)

      await purgeUserConnectors(testDb.db, userId, logger)

      expect(await testDb.db.select().from(schema.connectorToolCalls))
        .toHaveLength(0)
    })

    it('logs the counts without any identifier of a connector', async () => {
      await seedConnectorData(userId)

      await purgeUserConnectors(testDb.db, userId, logger)

      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          connectors: {
            cleanup: {
              purge: expect.objectContaining({ connectorsDeleted: 1 }),
            },
          },
        },
      })
    })
  })

  describe('cleanupConnectorsForDeletedChats', () => {
    it('removes the per-chat settings of the deleted chats only', async () => {
      const first = await seedConnectorData(userId)
      const second = await seedConnectorData(userId)
      const foreign = await seedConnectorData(otherUserId)

      const result = await cleanupConnectorsForDeletedChats(testDb.db, {
        userId,
        chatIds: [first.chatId],
        logger,
      })

      expect(result).toEqual({ rowsDeleted: 1 })

      const remaining = await testDb.db.select()
        .from(schema.connectorChatSettings)

      expect(remaining.map(row => row.chatPublicId).sort()).toEqual(
        [second.chatId, foreign.chatId].sort(),
      )
      expect(await testDb.db.select().from(schema.connectors))
        .toHaveLength(3)
    })

    it('does not touch another user with the same chat id', async () => {
      const foreign = await seedConnectorData(otherUserId)

      const result = await cleanupConnectorsForDeletedChats(testDb.db, {
        userId,
        chatIds: [foreign.chatId],
        logger,
      })

      expect(result).toEqual({ rowsDeleted: 0 })
    })

    it('handles more chats than one statement can bind', async () => {
      const seeded = await seedConnectorData(userId)
      const chatIds = Array.from({ length: 200 }, (_value, index) => {
        return `unknown-${index}`
      })

      const result = await cleanupConnectorsForDeletedChats(testDb.db, {
        userId,
        chatIds: [...chatIds, seeded.chatId],
        logger,
      })

      expect(result.rowsDeleted).toBe(1)
    })

    it('never throws when the delete fails', async () => {
      const failingDb = {
        delete: () => {
          throw new Error('d1 down\nparams: secret')
        },
      } as unknown as typeof testDb.db

      const result = await cleanupConnectorsForDeletedChats(failingDb, {
        userId,
        chatIds: ['chat'],
        logger,
      })

      expect(result).toEqual({ rowsDeleted: 0 })
      expect(JSON.stringify(logger.set.mock.calls)).not.toContain('secret')
    })
  })
})
