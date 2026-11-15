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
  CONNECTOR_BASELINE_MARKER_SETTING,
  CONNECTOR_BASELINE_MARKER_TOOL_NAME,
  createConnector,
  deleteConnector,
  deleteConnectorCredentials,
  getConnector,
  listConnectorChatSettings,
  listConnectorToolSettings,
  listConnectors,
  readConnectorCredentials,
  readConnectorToolBaseline,
  readConnectorUrl,
  recordConnectorToolCall,
  saveConnectorCredentials,
  settleConnectorToolCall,
  updateConnector,
  upsertConnectorChatSettings,
  upsertConnectorToolSettings,
} = await import('~~/server/utils/connectors/store')

const SECRET_URL = 'https://mcp.example.com/mcp?key=top-secret-key'

function fakeEncrypt(plain: string): string {
  return `enc:${Buffer.from(plain).toString('base64')}`
}

function fakeDecrypt(cipher: string): string {
  return Buffer.from(cipher.slice('enc:'.length), 'base64').toString()
}

describe('connectors store', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let otherUserId: number

  async function addConnector(owner: number, slugBase = 'example') {
    return await createConnector(testDb.db, {
      userId: owner,
      title: 'Example',
      url: SECRET_URL,
      slugBase,
      createdVia: 'app',
    })
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    otherUserId = await seedUser(testDb.db, null)
    vi.stubGlobal('useEncryptText', vi.fn(async (plain: string) => {
      return fakeEncrypt(plain)
    }))
    vi.stubGlobal('useDecryptText', vi.fn(async (cipher: string) => {
      return fakeDecrypt(cipher)
    }))
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('createConnector', () => {
    it('creates a disabled connector that needs sign-in', async () => {
      const connector = await addConnector(userId)

      expect(connector).toEqual(expect.objectContaining({
        userId,
        slug: 'example',
        title: 'Example',
        origin: 'https://mcp.example.com',
        transport: 'streamable-http',
        authType: null,
        status: 'needs-auth',
        enabled: false,
        presetId: null,
        createdVia: 'app',
        createdByClientId: null,
        consentedAt: null,
      }))
      expect(connector).not.toHaveProperty('urlEncrypted')
    })

    it('stores the full URL encrypted and the origin in the clear', async () => {
      const connector = await addConnector(userId)
      const [row] = await testDb.db.select().from(schema.connectors)

      expect(row!.urlEncrypted).not.toContain('top-secret-key')
      expect(row!.origin).toBe('https://mcp.example.com')
      expect(
        await readConnectorUrl(testDb.db, userId, connector.id),
      ).toBe(SECRET_URL)
    })

    it('allocates a slug for a base that sanitization changes', async () => {
      const first = await addConnector(userId, 'a.b')
      const second = await addConnector(userId, 'a.b')

      expect([first.slug, second.slug]).toEqual(['a-b', 'a-b-2'])
    })

    it('numbers a taken slug per user', async () => {
      const first = await addConnector(userId)
      const second = await addConnector(userId)
      const third = await addConnector(userId)
      const otherUsers = await addConnector(otherUserId)

      expect([first.slug, second.slug, third.slug])
        .toEqual(['example', 'example-2', 'example-3'])
      expect(otherUsers.slug).toBe('example')
    })

    it('derives the origin from the URL and ignores a caller origin', async () => {
      const connector = await createConnector(testDb.db, {
        userId,
        title: 'Spoof',
        url: 'https://mcp.example.com:8443/mcp?key=x',
        slugBase: 'spoof',
        createdVia: 'app',
        origin: 'https://mcp.notion.com',
      } as unknown as Parameters<typeof createConnector>[1])

      expect(connector.origin).toBe('https://mcp.example.com:8443')
    })

    it('refuses a URL that does not parse', async () => {
      await expect(createConnector(testDb.db, {
        userId,
        title: 'Bad',
        url: 'not a url',
        slugBase: 'bad',
        createdVia: 'app',
      })).rejects.toThrow()
      expect(await testDb.db.select().from(schema.connectors)).toHaveLength(0)
    })

    it('stops at 20 connectors per user and frees a slot on delete', async () => {
      for (let index = 0; index < 20; index++) {
        await addConnector(userId, `server-${index}`)
      }

      await expect(addConnector(userId, 'one-too-many')).rejects.toThrow(
        'Connector limit reached',
      )
      expect(await listConnectors(testDb.db, userId)).toHaveLength(20)
      expect(await addConnector(otherUserId)).toEqual(
        expect.objectContaining({ userId: otherUserId }),
      )

      const [first] = await listConnectors(testDb.db, userId)

      await deleteConnector(testDb.db, userId, first!.id)

      expect(await addConnector(userId, 'fits-now')).toEqual(
        expect.objectContaining({ slug: 'fits-now' }),
      )
    })

    it('inserts and enforces the cap in one batch', async () => {
      const batch = vi.spyOn(testDb.db, 'batch')

      await addConnector(userId)

      expect(batch).toHaveBeenCalledTimes(1)
      expect(batch.mock.calls[0]![0]).toHaveLength(2)
    })

    it('records who added an MCP connector', async () => {
      const connector = await createConnector(testDb.db, {
        userId,
        title: 'Added by agent',
        url: SECRET_URL,
        slugBase: 'example',
        createdVia: 'mcp',
        createdByClientId: 'client-1',
        presetId: 'linear',
      })

      expect(connector.createdVia).toBe('mcp')
      expect(connector.createdByClientId).toBe('client-1')
      expect(connector.enabled).toBe(false)
    })

    it('cuts a title to 80 characters', async () => {
      const connector = await createConnector(testDb.db, {
        userId,
        title: 'a'.repeat(120),
        url: SECRET_URL,
        slugBase: 'example',
        createdVia: 'app',
      })

      expect(connector.title).toHaveLength(80)
    })

    it('enforces slug uniqueness per user in the database', async () => {
      await addConnector(userId)

      await expect(
        testDb.db.insert(schema.connectors).values({
          userId,
          slug: 'example',
          title: 'Duplicate',
          origin: 'https://mcp.example.com',
          urlEncrypted: 'x',
          transport: 'streamable-http',
          status: 'needs-auth',
          enabled: false,
          createdVia: 'app',
        }),
      ).rejects.toThrow()
    })
  })

  describe('reading and updating', () => {
    it('lists only the connectors of the user', async () => {
      await addConnector(userId)
      await addConnector(otherUserId)

      const connectors = await listConnectors(testDb.db, userId)

      expect(connectors).toHaveLength(1)
      expect(connectors[0]).not.toHaveProperty('urlEncrypted')
    })

    it('does not return or update a connector of another user', async () => {
      const connector = await addConnector(otherUserId)

      expect(await getConnector(testDb.db, userId, connector.id)).toBeNull()
      expect(await readConnectorUrl(testDb.db, userId, connector.id))
        .toBeNull()
      expect(await updateConnector(
        testDb.db,
        userId,
        connector.id,
        { enabled: true },
      )).toBeNull()
    })

    it('ignores keys outside the patch whitelist', async () => {
      const connector = await addConnector(userId)
      const updated = await updateConnector(testDb.db, userId, connector.id, {
        title: 'Renamed',
        userId: otherUserId,
        slug: 'hijack',
        urlEncrypted: 'evil',
        id: 999,
        origin: 'https://evil.example',
        createdVia: 'mcp',
        presetId: 'github',
      } as unknown as Parameters<typeof updateConnector>[3])
      const [row] = await testDb.db.select().from(schema.connectors)

      expect(updated?.title).toBe('Renamed')
      expect(row).toEqual(expect.objectContaining({
        userId,
        slug: 'example',
        origin: 'https://mcp.example.com',
        createdVia: 'app',
        presetId: null,
      }))
      expect(row!.urlEncrypted).not.toBe('evil')
      expect(updated?.id).toBe(connector.id)
    })

    it('returns the connector unchanged for an empty patch', async () => {
      const connector = await addConnector(userId)
      const unchanged = await updateConnector(
        testDb.db,
        userId,
        connector.id,
        { userId: otherUserId } as unknown as Parameters<
          typeof updateConnector
        >[3],
      )

      expect(unchanged?.id).toBe(connector.id)
      expect(unchanged?.userId).toBe(userId)
    })

    it('updates consent and status fields', async () => {
      const connector = await addConnector(userId)
      const consentedAt = new Date('2026-11-14T10:00:00.000Z')
      const updated = await updateConnector(testDb.db, userId, connector.id, {
        authType: 'oauth',
        status: 'ready',
        consentOrigin: 'https://mcp.example.com',
        consentVersion: 'v1',
        consentedAt,
      })

      expect(updated).toEqual(expect.objectContaining({
        authType: 'oauth',
        status: 'ready',
        consentOrigin: 'https://mcp.example.com',
        consentVersion: 'v1',
        consentedAt,
      }))
    })
  })

  describe('credentials', () => {
    it('encrypts every secret column and round trips them', async () => {
      const connector = await addConnector(userId)

      await saveConnectorCredentials(testDb.db, {
        userId,
        connectorId: connector.id,
        issuer: 'https://auth.example.com',
        clientRegistration: {
          clientId: 'client-1',
          registrationKind: 'dcr',
          clientSecret: 'client-secret',
        },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        scope: 'read',
        expiresAt: new Date('2026-11-15T00:00:00.000Z'),
      })

      const [row] = await testDb.db.select()
        .from(schema.connectorCredentials)

      for (const stored of [
        row!.accessToken,
        row!.refreshToken,
        row!.clientRegistration,
      ]) {
        expect(stored).toMatch(/^enc:/)
      }

      expect(row!.clientRegistration).not.toContain('client-secret')

      const credentials = await readConnectorCredentials(
        testDb.db,
        userId,
        connector.id,
      )

      expect(credentials).toEqual(expect.objectContaining({
        issuer: 'https://auth.example.com',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        headerValue: null,
        scope: 'read',
        clientRegistration: {
          clientId: 'client-1',
          registrationKind: 'dcr',
          clientSecret: 'client-secret',
        },
      }))
    })

    it('stores a header credential encrypted under the empty issuer', async () => {
      const connector = await addConnector(userId)

      await saveConnectorCredentials(testDb.db, {
        userId,
        connectorId: connector.id,
        issuer: '',
        headerName: 'Authorization',
        headerValue: 'Bearer pat-123',
      })

      const [row] = await testDb.db.select()
        .from(schema.connectorCredentials)

      expect(row!.headerName).toBe('Authorization')
      expect(row!.headerValue).not.toContain('pat-123')
      expect(
        (await readConnectorCredentials(testDb.db, userId, connector.id))
          ?.headerValue,
      ).toBe('Bearer pat-123')
    })

    it('replaces the row for the same connector and issuer', async () => {
      const connector = await addConnector(userId)
      const input = {
        userId,
        connectorId: connector.id,
        issuer: 'https://auth.example.com',
      }

      await saveConnectorCredentials(testDb.db, {
        ...input,
        accessToken: 'first',
      })
      await saveConnectorCredentials(testDb.db, {
        ...input,
        accessToken: 'second',
      })

      const rows = await testDb.db.select()
        .from(schema.connectorCredentials)

      expect(rows).toHaveLength(1)
      expect(
        (await readConnectorCredentials(testDb.db, userId, connector.id))
          ?.accessToken,
      ).toBe('second')
    })

    it('deletes only the credentials of one connector', async () => {
      const connector = await addConnector(userId)
      const other = await addConnector(userId, 'other')

      for (const target of [connector, other]) {
        await saveConnectorCredentials(testDb.db, {
          userId,
          connectorId: target.id,
          issuer: '',
          headerName: 'X-Key',
          headerValue: 'value',
        })
      }

      expect(
        await deleteConnectorCredentials(testDb.db, userId, connector.id),
      ).toBe(1)
      expect(
        await readConnectorCredentials(testDb.db, userId, connector.id),
      ).toBeNull()
      expect(
        await readConnectorCredentials(testDb.db, userId, other.id),
      ).not.toBeNull()
    })
  })

  describe('ownership of writes', () => {
    it('refuses credentials for a connector of another user', async () => {
      const foreign = await addConnector(otherUserId)

      await saveConnectorCredentials(testDb.db, {
        userId: otherUserId,
        connectorId: foreign.id,
        issuer: '',
        headerName: 'X-Key',
        headerValue: 'victim-secret',
      })

      await expect(saveConnectorCredentials(testDb.db, {
        userId,
        connectorId: foreign.id,
        issuer: '',
        headerName: 'X-Key',
        headerValue: 'attacker-value',
      })).rejects.toThrow('Connector not found')

      const [row] = await testDb.db.select()
        .from(schema.connectorCredentials)

      expect(row!.userId).toBe(otherUserId)
      expect(
        (await readConnectorCredentials(testDb.db, otherUserId, foreign.id))
          ?.headerValue,
      ).toBe('victim-secret')
    })

    it('refuses tool settings for a connector of another user', async () => {
      const foreign = await addConnector(otherUserId)
      const tool = {
        toolName: 'search',
        definitionHash: 'victim-hash',
        serverReadOnly: true,
        enabled: true,
        approval: 'ask' as const,
      }

      await upsertConnectorToolSettings(
        testDb.db,
        otherUserId,
        foreign.id,
        [tool],
      )

      await expect(upsertConnectorToolSettings(
        testDb.db,
        userId,
        foreign.id,
        [{ ...tool, definitionHash: 'attacker-hash', approval: 'always' }],
      )).rejects.toThrow('Connector not found')

      const [row] = await testDb.db.select()
        .from(schema.connectorToolSettings)

      expect(row).toEqual(expect.objectContaining({
        userId: otherUserId,
        definitionHash: 'victim-hash',
        approval: 'ask',
      }))
    })

    it('keeps the baseline marker out of tool listings and still counts '
      + 'it as a baseline', async () => {
      const connector = await addConnector(userId)

      expect(await readConnectorToolBaseline(
        testDb.db,
        userId,
        connector.id,
      )).toEqual({ isBaselined: false, settings: [] })

      await upsertConnectorToolSettings(
        testDb.db,
        userId,
        connector.id,
        [CONNECTOR_BASELINE_MARKER_SETTING],
      )

      expect(CONNECTOR_BASELINE_MARKER_TOOL_NAME).toBe('')
      expect(await listConnectorToolSettings(
        testDb.db,
        userId,
        connector.id,
      )).toEqual([])
      expect(await readConnectorToolBaseline(
        testDb.db,
        userId,
        connector.id,
      )).toEqual({ isBaselined: true, settings: [] })

      const result = await deleteConnector(testDb.db, userId, connector.id)

      expect(result.toolSettingsDeleted).toBe(1)
    })

    it('refuses chat settings for a connector of another user', async () => {
      const foreign = await addConnector(otherUserId)
      const chat = await seedChat(testDb.db, otherUserId)

      await upsertConnectorChatSettings(testDb.db, {
        userId: otherUserId,
        chatPublicId: chat.id,
        connectorId: foreign.id,
        enabled: true,
        alwaysAllowTools: { search: 'victim-hash' },
      })

      await expect(upsertConnectorChatSettings(testDb.db, {
        userId,
        chatPublicId: chat.id,
        connectorId: foreign.id,
        enabled: false,
        alwaysAllowTools: { create: 'attacker-hash' },
      })).rejects.toThrow('Connector not found')

      const [row] = await testDb.db.select()
        .from(schema.connectorChatSettings)

      expect(row).toEqual(expect.objectContaining({
        userId: otherUserId,
        enabled: true,
        alwaysAllowTools: { search: 'victim-hash' },
      }))
    })

    it('never rewrites the owner of an existing row on conflict', async () => {
      const connector = await addConnector(userId)
      const input = {
        userId,
        connectorId: connector.id,
        issuer: '',
        headerName: 'X-Key',
      }

      await saveConnectorCredentials(testDb.db, { ...input, headerValue: 'a' })
      await saveConnectorCredentials(testDb.db, { ...input, headerValue: 'b' })

      const rows = await testDb.db.select()
        .from(schema.connectorCredentials)

      expect(rows).toHaveLength(1)
      expect(rows[0]!.userId).toBe(userId)
    })

    it('rejects an unknown connector id', async () => {
      await expect(saveConnectorCredentials(testDb.db, {
        userId,
        connectorId: 'skl999',
        issuer: '',
      })).rejects.toThrow('Connector not found')
    })
  })

  describe('tool and chat settings', () => {
    it('upserts tool settings by connector and tool name', async () => {
      const connector = await addConnector(userId)
      const tool = {
        toolName: 'search',
        definitionHash: 'hash-1',
        serverReadOnly: true,
        enabled: true,
        approval: 'ask' as const,
      }

      await upsertConnectorToolSettings(
        testDb.db,
        userId,
        connector.id,
        [tool, { ...tool, toolName: 'create' }],
      )
      await upsertConnectorToolSettings(
        testDb.db,
        userId,
        connector.id,
        [{
          ...tool,
          definitionHash: 'hash-2',
          approval: 'always',
          approvedDefinitionHash: 'hash-2',
        }],
      )

      const settings = await listConnectorToolSettings(
        testDb.db,
        userId,
        connector.id,
      )

      expect(settings.map(row => row.toolName)).toEqual(['create', 'search'])
      expect(settings[1]).toEqual(expect.objectContaining({
        definitionHash: 'hash-2',
        approval: 'always',
        approvedDefinitionHash: 'hash-2',
      }))
    })

    it('upserts per-chat settings by chat and connector', async () => {
      const connector = await addConnector(userId)
      const chat = await seedChat(testDb.db, userId)
      const input = {
        userId,
        chatPublicId: chat.id,
        connectorId: connector.id,
      }

      await upsertConnectorChatSettings(testDb.db, {
        ...input,
        enabled: true,
        alwaysAllowTools: {},
      })
      await upsertConnectorChatSettings(testDb.db, {
        ...input,
        enabled: true,
        alwaysAllowTools: { search: 'hash-1' },
      })

      const settings = await listConnectorChatSettings(
        testDb.db,
        userId,
        chat.id,
      )

      expect(settings).toHaveLength(1)
      expect(settings[0]!.alwaysAllowTools).toEqual({ search: 'hash-1' })
    })
  })

  describe('deleteConnector', () => {
    it('removes the connector and its rows but keeps the audit trail', async () => {
      const connector = await addConnector(userId)
      const survivor = await addConnector(userId, 'survivor')
      const chat = await seedChat(testDb.db, userId)

      await saveConnectorCredentials(testDb.db, {
        userId,
        connectorId: connector.id,
        issuer: '',
        headerName: 'X-Key',
        headerValue: 'value',
      })
      await upsertConnectorToolSettings(testDb.db, userId, connector.id, [{
        toolName: 'search',
        definitionHash: 'h',
        serverReadOnly: false,
        enabled: true,
        approval: 'ask',
      }])
      await upsertConnectorChatSettings(testDb.db, {
        userId,
        chatPublicId: chat.id,
        connectorId: connector.id,
        enabled: true,
        alwaysAllowTools: {},
      })
      await recordConnectorToolCall(testDb.db, {
        userId,
        connectorId: connector.id,
        connectorHost: 'mcp.example.com',
        toolName: 'search',
        argsHmac: 'hmac',
        resultBytes: 10,
        outcome: 'ok',
        approval: 'once',
        path: 'worker',
        durationMs: 5,
      })

      const result = await deleteConnector(testDb.db, userId, connector.id)

      expect(result).toEqual({
        connectorDeleted: true,
        credentialsDeleted: 1,
        toolSettingsDeleted: 1,
        chatSettingsDeleted: 1,
      })
      expect(await getConnector(testDb.db, userId, connector.id)).toBeNull()
      expect(await getConnector(testDb.db, userId, survivor.id))
        .not.toBeNull()
      expect(await testDb.db.select().from(schema.connectorToolCalls))
        .toHaveLength(1)
    })

    it('logs the connector id and the counts for the restore runbook', async () => {
      const connector = await addConnector(userId)
      const logger = { set: vi.fn() }

      await deleteConnector(testDb.db, userId, connector.id, logger)

      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          connectors: {
            cleanup: {
              connectorDelete: {
                connectorId: connector.id,
                connectorDeleted: true,
                credentialsDeleted: 0,
                toolSettingsDeleted: 0,
                chatSettingsDeleted: 0,
              },
            },
          },
        },
      })
    })

    it('logs nothing for a connector of another user', async () => {
      const connector = await addConnector(otherUserId)
      const logger = { set: vi.fn() }

      await deleteConnector(testDb.db, userId, connector.id, logger)

      expect(logger.set).not.toHaveBeenCalled()
    })

    it('does nothing for a connector of another user', async () => {
      const connector = await addConnector(otherUserId)
      const result = await deleteConnector(testDb.db, userId, connector.id)

      expect(result.connectorDeleted).toBe(false)
      expect(await getConnector(testDb.db, otherUserId, connector.id))
        .not.toBeNull()
    })
  })

  describe('audit rows', () => {
    it('settles a pending call in place', async () => {
      const connector = await addConnector(userId)
      const callId = await recordConnectorToolCall(testDb.db, {
        userId,
        connectorId: connector.id,
        connectorHost: 'mcp.example.com',
        toolName: 'create',
        argsHmac: 'hmac',
        resultBytes: 0,
        outcome: 'pending',
        approval: 'denied',
        path: 'worker',
        durationMs: 0,
      })

      await settleConnectorToolCall(testDb.db, userId, callId, {
        outcome: 'ok',
        approval: 'once',
        resultBytes: 128,
        durationMs: 42,
      })

      const rows = await testDb.db.select().from(schema.connectorToolCalls)

      expect(rows).toHaveLength(1)
      expect(rows[0]).toEqual(expect.objectContaining({
        outcome: 'ok',
        approval: 'once',
        resultBytes: 128,
        durationMs: 42,
        chatPublicId: null,
      }))
    })
  })
})
