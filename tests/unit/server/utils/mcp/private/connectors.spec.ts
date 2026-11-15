import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONNECTORS_MCP_DISABLED_MAX } from '#shared/utils/connectors-policy'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../../setup/helpers/memory-extraction-db'

const mocks = vi.hoisted(() => {
  return {
    enabledFlags: new Set<string>(),
    revokeCredentialsBatch: vi.fn(),
    logger: { set: vi.fn() },
  }
})

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

vi.mock('~~/server/utils/features/evaluate', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/features/evaluate')
  >()

  return {
    ...original,
    getFeatureEvaluationConfig: () => ({}),
    loadFeatureRules: async () => ({}),
    loadUserFeatureState: async () => null,
    evaluateFeature: async (flag: string) => {
      return { value: mocks.enabledFlags.has(flag) }
    },
    isFeatureActive: (_flag: string, resolution: { value: boolean }) => {
      return resolution.value
    },
  }
})

vi.mock('~~/server/utils/connectors/revoke', () => {
  return { revokeCredentialsBatch: mocks.revokeCredentialsBatch }
})

const {
  createConnector,
  listConnectorToolSettings,
  recordConnectorToolCall,
  saveConnectorCredentials,
  updateConnector,
  upsertConnectorToolSettings,
  CONNECTOR_BASELINE_MARKER_SETTING,
} = await import('~~/server/utils/connectors/store')
const {
  addMcpConnector,
  deleteMcpConnectors,
  getMcpConnector,
  listMcpConnectors,
  updateMcpConnectorTools,
} = await import('~~/server/utils/mcp/private/connectors')

const SECRET_URL = 'https://mcp.example.com/mcp?key=top-secret-key'
const ACCESS_TOKEN = 'access-token-value'
const REFRESH_TOKEN = 'refresh-token-value'
const HEADER_VALUE = 'Bearer header-secret-value'
const SITE_URL = 'https://besidka.com'

function toolSetting(
  toolName: string,
  overrides: Partial<{
    serverReadOnly: boolean
    enabled: boolean
    approval: 'ask' | 'always'
    approvedDefinitionHash: string | null
  }> = {},
) {
  return {
    toolName,
    definitionHash: `hash-${toolName}`,
    serverReadOnly: false,
    enabled: true,
    approval: 'ask' as const,
    ...overrides,
  }
}

describe('private MCP connector tools', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let otherUserId: number

  function context(owner = userId) {
    return {
      db: testDb.db,
      kv: {} as never,
      userId: owner,
      clientId: 'client-abc',
      logger: mocks.logger,
      siteUrl: SITE_URL,
    }
  }

  async function seedConnector(
    owner = userId,
    overrides: Partial<{ createdVia: 'app' | 'mcp', slugBase: string }> = {},
  ) {
    return await createConnector(testDb.db, {
      userId: owner,
      title: 'Example',
      url: SECRET_URL,
      slugBase: overrides.slugBase ?? 'example',
      createdVia: overrides.createdVia ?? 'app',
    })
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    otherUserId = await seedUser(testDb.db, null)
    mocks.enabledFlags.clear()
    mocks.enabledFlags.add('connectors')
    mocks.logger.set.mockReset()
    mocks.revokeCredentialsBatch.mockReset()
    mocks.revokeCredentialsBatch.mockResolvedValue({
      attempted: false,
      revoked: 0,
    })
    vi.stubGlobal('useEncryptText', vi.fn(async (plain: string) => {
      return `enc:${plain}`
    }))
    vi.stubGlobal('useDecryptText', vi.fn(async (cipher: string) => {
      return cipher.slice('enc:'.length)
    }))
    vi.stubGlobal('useKV', () => {
      return {
        delete: vi.fn(async () => {}),
        get: vi.fn(async () => null),
        put: vi.fn(async () => {}),
      }
    })
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('feature gate', () => {
    it('answers every tool with the same generic 404 when connectors are off',
      async () => {
        mocks.enabledFlags.clear()

        const connector = await seedConnector()
        const calls = [
          listMcpConnectors(context(), {}),
          getMcpConnector(context(), { id: connector.id }),
          addMcpConnector(context(), { url: 'https://mcp.example.org/mcp' }),
          updateMcpConnectorTools(context(), {
            id: connector.id,
            tools: [{ name: 'search', enabled: false }],
          }),
          deleteMcpConnectors(context(), { ids: [connector.id] }),
        ]

        for (const call of calls) {
          await expect(call).rejects.toMatchObject({
            status: 404,
            why: 'feature_unavailable',
            message: 'Connectors are not available for this account.',
          })
        }

        const rows = await testDb.db.select().from(schema.connectors)

        expect(rows).toHaveLength(1)
      })
  })

  describe('list_connectors', () => {
    it('lists only the caller\'s connectors with an explicit field set',
      async () => {
        const mine = await seedConnector()

        await seedConnector(otherUserId, { slugBase: 'other' })
        await upsertConnectorToolSettings(testDb.db, userId, mine.id, [
          toolSetting('search'),
          toolSetting('create', { enabled: false }),
          CONNECTOR_BASELINE_MARKER_SETTING,
        ])
        await saveConnectorCredentials(testDb.db, {
          userId,
          connectorId: mine.id,
          issuer: 'https://auth.example.com',
          accessToken: ACCESS_TOKEN,
          refreshToken: REFRESH_TOKEN,
          headerName: 'Authorization',
          headerValue: HEADER_VALUE,
        })

        const result = await listMcpConnectors(context(), {})

        expect(result.nextCursor).toBeNull()
        expect(result.connectors).toHaveLength(1)
        expect(Object.keys(result.connectors[0]!).sort()).toEqual([
          'createdVia',
          'drifted',
          'enabled',
          'enabledToolCount',
          'host',
          'id',
          'status',
          'title',
          'toolCount',
          'updatedAt',
        ])
        expect(result.connectors[0]).toMatchObject({
          id: mine.id,
          title: 'Example',
          host: 'mcp.example.com',
          status: 'needs-auth',
          enabled: false,
          toolCount: 2,
          enabledToolCount: 1,
          drifted: false,
          createdVia: 'app',
        })

        const serialized = JSON.stringify(result)

        for (const secret of [
          'top-secret-key',
          '/mcp',
          ACCESS_TOKEN,
          REFRESH_TOKEN,
          HEADER_VALUE,
          'auth.example.com',
        ]) {
          expect(serialized, secret).not.toContain(secret)
        }
      })

    it('pages with a cursor and rejects a cursor it did not issue',
      async () => {
        await seedConnector(userId, { slugBase: 'first' })
        await seedConnector(userId, { slugBase: 'second' })
        await seedConnector(userId, { slugBase: 'third' })

        const firstPage = await listMcpConnectors(context(), { limit: 2 })

        expect(firstPage.connectors).toHaveLength(2)
        expect(firstPage.nextCursor).not.toBeNull()

        const secondPage = await listMcpConnectors(context(), {
          limit: 2,
          cursor: firstPage.nextCursor!,
        })

        expect(secondPage.connectors).toHaveLength(1)
        expect(secondPage.nextCursor).toBeNull()

        await expect(
          listMcpConnectors(context(), { cursor: 'not-base64!' }),
        ).rejects.toMatchObject({ status: 400 })
        await expect(
          listMcpConnectors(context(), { cursor: btoa('chats:1') }),
        ).rejects.toMatchObject({ status: 400 })
      })
  })

  describe('get_connector', () => {
    it('returns the tools and recent usage, never credentials', async () => {
      const connector = await seedConnector()

      await upsertConnectorToolSettings(testDb.db, userId, connector.id, [
        toolSetting('search', { serverReadOnly: true }),
        toolSetting('create', { enabled: false }),
        CONNECTOR_BASELINE_MARKER_SETTING,
      ])
      await saveConnectorCredentials(testDb.db, {
        userId,
        connectorId: connector.id,
        issuer: 'https://auth.example.com',
        accessToken: ACCESS_TOKEN,
        refreshToken: REFRESH_TOKEN,
      })

      for (const outcome of ['ok', 'error'] as const) {
        await recordConnectorToolCall(testDb.db, {
          userId,
          connectorId: connector.id,
          connectorHost: 'mcp.example.com',
          toolName: 'search',
          argsHmac: 'hmac-value',
          resultBytes: 10,
          outcome,
          approval: 'not-applicable',
          path: 'worker',
          durationMs: 5,
        })
      }

      const result = await getMcpConnector(context(), { id: connector.id })

      expect(result.tools).toEqual([
        {
          name: 'create',
          enabled: false,
          approval: 'ask',
          serverReadOnly: false,
        },
        {
          name: 'search',
          enabled: true,
          approval: 'ask',
          serverReadOnly: true,
        },
      ])
      expect(result.usage).toEqual({ callsLast30d: 2 })
      expect(result.toolCount).toBe(2)
      expect(result.enabledToolCount).toBe(1)

      const serialized = JSON.stringify(result)

      for (const secret of [
        'top-secret-key',
        ACCESS_TOKEN,
        REFRESH_TOKEN,
        'hmac-value',
        'hash-search',
      ]) {
        expect(serialized, secret).not.toContain(secret)
      }
    })

    it('answers the same 404 for an unknown id and for another user\'s',
      async () => {
        const foreign = await seedConnector(otherUserId)

        const foreignResult = getMcpConnector(context(), { id: foreign.id })
        const unknownResult = getMcpConnector(context(), { id: 'skl9999' })
        const malformedResult = getMcpConnector(context(), { id: '../x' })

        for (const call of [foreignResult, unknownResult, malformedResult]) {
          await expect(call).rejects.toMatchObject({
            status: 404,
            message: expect.stringContaining('Connector not found'),
          })
        }
      })
  })

  describe('add_connector', () => {
    it('creates a disabled, signed-out connector recorded as added over MCP',
      async () => {
        const fetchSpy = vi.fn()

        vi.stubGlobal('fetch', fetchSpy)

        const result = await addMcpConnector(context(), {
          url: SECRET_URL,
          title: '  Linear  ',
        })

        expect(result).toMatchObject({
          title: 'Linear',
          host: 'mcp.example.com',
          status: 'needs-auth',
          enabled: false,
          manageUrl: 'https://besidka.com/profile/connectors',
        })
        expect(JSON.stringify(result)).not.toContain('top-secret-key')
        expect(fetchSpy).not.toHaveBeenCalled()

        const [row] = await testDb.db.select().from(schema.connectors)

        expect(row).toMatchObject({
          userId,
          enabled: false,
          status: 'needs-auth',
          authType: null,
          createdVia: 'mcp',
          createdByClientId: 'client-abc',
          consentedAt: null,
        })

        const credentials = await testDb.db
          .select()
          .from(schema.connectorCredentials)

        expect(credentials).toHaveLength(0)
      })

    it('records a preset added over MCP as mcp, not preset', async () => {
      const result = await addMcpConnector(context(), {
        presetId: 'github',
      })
      const [row] = await testDb.db.select().from(schema.connectors)

      expect(result.enabled).toBe(false)
      expect(row).toMatchObject({
        createdVia: 'mcp',
        createdByClientId: 'client-abc',
        presetId: 'github',
      })
    })

    it('refuses addresses that are not public https URLs', async () => {
      for (const url of [
        'https://10.0.0.1/mcp',
        'http://mcp.example.com/mcp',
        'https://localhost/mcp',
        'https://user:pass@mcp.example.com/mcp',
        'not a url',
      ]) {
        await expect(
          addMcpConnector(context(), { url }),
          url,
        ).rejects.toMatchObject({
          status: 400,
          message: expect.stringContaining('This address is not allowed'),
        })
      }

      await expect(addMcpConnector(context(), {})).rejects.toMatchObject({
        status: 400,
      })
      await expect(
        addMcpConnector(context(), { presetId: 'no-such-preset' }),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('Unknown preset'),
      })

      const rows = await testDb.db.select().from(schema.connectors)

      expect(rows).toHaveLength(0)
    })

    it('holds MCP-added connectors that are still off to the cap, and '
      + 'frees a slot when one is switched on', async () => {
      const addedIds: string[] = []

      for (let index = 0; index < CONNECTORS_MCP_DISABLED_MAX; index++) {
        const added = await addMcpConnector(context(), {
          url: `https://mcp${index}.example.com/mcp`,
        })

        addedIds.push(added.id)
      }

      await expect(
        addMcpConnector(context(), { url: 'https://extra.example.com/mcp' }),
      ).rejects.toMatchObject({
        status: 409,
        code: 'CONNECTOR_MCP_LIMIT_REACHED',
        message: expect.stringContaining('still switched off'),
      })

      expect(await testDb.db.select().from(schema.connectors))
        .toHaveLength(CONNECTORS_MCP_DISABLED_MAX)

      const otherUserResult = await addMcpConnector(context(otherUserId), {
        url: 'https://other.example.com/mcp',
      })

      expect(otherUserResult.enabled).toBe(false)

      await updateConnector(testDb.db, userId, addedIds[0]!, {
        enabled: true,
      })

      const afterEnable = await addMcpConnector(context(), {
        url: 'https://extra.example.com/mcp',
      })

      expect(afterEnable.enabled).toBe(false)
    })
  })

  describe('update_connector_tools', () => {
    async function seedWithTools() {
      const connector = await seedConnector()

      await upsertConnectorToolSettings(testDb.db, userId, connector.id, [
        toolSetting('search', { serverReadOnly: true }),
        toolSetting('create', {
          approval: 'always',
          approvedDefinitionHash: 'hash-create',
        }),
        toolSetting('delete'),
        CONNECTOR_BASELINE_MARKER_SETTING,
      ])

      return connector
    }

    it('turns tools off and back to ask, and ends an Always allow grant',
      async () => {
        const connector = await seedWithTools()
        const result = await updateMcpConnectorTools(context(), {
          id: connector.id,
          tools: [
            { name: 'delete', enabled: false },
            { name: 'create', approval: 'ask' },
          ],
        })

        expect(result.tools).toEqual([
          {
            name: 'create',
            enabled: true,
            approval: 'ask',
            serverReadOnly: false,
          },
          {
            name: 'delete',
            enabled: false,
            approval: 'ask',
            serverReadOnly: false,
          },
          {
            name: 'search',
            enabled: true,
            approval: 'ask',
            serverReadOnly: true,
          },
        ])

        const stored = await listConnectorToolSettings(
          testDb.db,
          userId,
          connector.id,
        )
        const create = stored.find((row) => {
          return row.toolName === 'create'
        })

        expect(create?.approvedDefinitionHash).toBeNull()
        expect(create?.definitionHash).toBe('hash-create')
      })

    it('never switches the connector on or inserts a tool', async () => {
      const connector = await seedWithTools()

      await updateMcpConnectorTools(context(), {
        id: connector.id,
        tools: [{ name: 'search', enabled: false }],
      })

      const [row] = await testDb.db.select().from(schema.connectors)
      const settings = await listConnectorToolSettings(
        testDb.db,
        userId,
        connector.id,
      )

      expect(row?.enabled).toBe(false)
      expect(settings).toHaveLength(3)
    })

    it('refuses to turn a tool on or to grant Always allow, even if the '
      + 'schema is bypassed', async () => {
      const connector = await seedWithTools()
      const forbidden = [
        { name: 'search', enabled: true },
        { name: 'delete', approval: 'always' },
        { name: 'delete', enabled: true, approval: 'always' },
      ]

      for (const change of forbidden) {
        await expect(updateMcpConnectorTools(context(), {
          id: connector.id,
          tools: [change as never],
        }), JSON.stringify(change)).rejects.toMatchObject({
          status: 400,
          message: expect.stringContaining('only possible in the Besidka app'),
        })
      }

      await expect(updateMcpConnectorTools(context(), {
        id: connector.id,
        tools: [{ name: 'search' }],
      })).rejects.toMatchObject({ status: 400 })

      const settings = await listConnectorToolSettings(
        testDb.db,
        userId,
        connector.id,
      )

      expect(settings.every((row) => {
        return row.approval === 'always' ? row.toolName === 'create' : true
      })).toBe(true)
      expect(settings.find((row) => {
        return row.toolName === 'delete'
      })?.approval).toBe('ask')
    })

    it('changes nothing when one tool name is unknown or is the baseline '
      + 'marker', async () => {
      const connector = await seedWithTools()

      for (const unknown of ['missing', '']) {
        await expect(updateMcpConnectorTools(context(), {
          id: connector.id,
          tools: [
            { name: 'search', enabled: false },
            { name: unknown, enabled: false },
          ],
        }), unknown).rejects.toMatchObject({
          status: 400,
          message: expect.stringContaining('Nothing was changed'),
        })
      }

      const settings = await listConnectorToolSettings(
        testDb.db,
        userId,
        connector.id,
      )

      expect(settings.every((row) => {
        return row.enabled
      })).toBe(true)
    })

    it('rejects a tool listed twice', async () => {
      const connector = await seedWithTools()

      await expect(updateMcpConnectorTools(context(), {
        id: connector.id,
        tools: [
          { name: 'search', enabled: false },
          { name: 'search', approval: 'ask' },
        ],
      })).rejects.toMatchObject({ status: 400 })
    })

    it('never touches another user\'s connector', async () => {
      const foreign = await seedConnector(otherUserId)

      await upsertConnectorToolSettings(
        testDb.db,
        otherUserId,
        foreign.id,
        [toolSetting('search')],
      )

      await expect(updateMcpConnectorTools(context(), {
        id: foreign.id,
        tools: [{ name: 'search', enabled: false }],
      })).rejects.toMatchObject({ status: 404 })

      const settings = await listConnectorToolSettings(
        testDb.db,
        otherUserId,
        foreign.id,
      )

      expect(settings[0]?.enabled).toBe(true)
    })
  })

  describe('delete_connectors', () => {
    it('revokes credentials, removes the rows and reports ids that are not '
      + 'the caller\'s, keeping the audit rows', async () => {
      const mine = await seedConnector()
      const foreign = await seedConnector(otherUserId, { slugBase: 'other' })

      await upsertConnectorToolSettings(testDb.db, userId, mine.id, [
        toolSetting('search'),
      ])
      await saveConnectorCredentials(testDb.db, {
        userId,
        connectorId: mine.id,
        issuer: 'https://auth.example.com',
        accessToken: ACCESS_TOKEN,
      })
      await recordConnectorToolCall(testDb.db, {
        userId,
        connectorId: mine.id,
        connectorHost: 'mcp.example.com',
        toolName: 'search',
        argsHmac: 'hmac-value',
        resultBytes: 10,
        outcome: 'ok',
        approval: 'not-applicable',
        path: 'worker',
        durationMs: 5,
      })

      const result = await deleteMcpConnectors(context(), {
        ids: [mine.id, foreign.id, 'skl9999', mine.id],
      })

      expect(result.deleted).toEqual([mine.id])
      expect(result.notFound.sort()).toEqual([foreign.id, 'skl9999'].sort())
      expect(mocks.revokeCredentialsBatch).toHaveBeenCalledTimes(1)
      expect(mocks.revokeCredentialsBatch.mock.calls[0]![0]).toHaveLength(1)

      expect(await testDb.db.select().from(schema.connectors))
        .toHaveLength(1)
      expect(await testDb.db.select().from(schema.connectorCredentials))
        .toHaveLength(0)
      expect(await testDb.db.select().from(schema.connectorToolSettings))
        .toHaveLength(0)
      expect(await testDb.db.select().from(schema.connectorToolCalls))
        .toHaveLength(1)
    })

    it('reports an id that decodes to nothing as not found and goes on '
      + 'with the rest', async () => {
      const mine = await seedConnector()
      const result = await deleteMcpConnectors(context(), {
        ids: ['abc', mine.id],
      })

      expect(result.deleted).toEqual([mine.id])
      expect(result.notFound).toEqual(['abc'])
    })

    it('logs the withdrawn consent with hosts only', async () => {
      const connector = await seedConnector()

      await updateConnector(testDb.db, userId, connector.id, {
        consentedAt: new Date(),
        consentOrigin: 'https://mcp.example.com',
      })

      await deleteMcpConnectors(context(), { ids: [connector.id] })

      expect(mocks.logger.set).toHaveBeenCalledWith({
        attributes: {
          legalConsent: {
            action: 'connector-withdrawn',
            reason: 'deleted',
            hosts: ['mcp.example.com'],
          },
        },
      })
    })
  })
})
