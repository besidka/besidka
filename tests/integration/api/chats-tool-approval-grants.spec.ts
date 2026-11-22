import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONNECTOR_CONSENT_VERSION } from '#shared/utils/connectors-policy'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import { createSkillsRouteEvent } from '../../setup/helpers/skills-route'
import type { SkillsRouteEvent } from '../../setup/helpers/skills-route'
import {
  createFakeConnectorKv,
  fakeDecrypt,
  fakeEncrypt,
} from '../../setup/helpers/connectors-oauth'

const ORIGIN = 'https://besidka.com'

const mocks = vi.hoisted(() => ({
  flags: new Set<string>(['connectors', 'tool-approvals']),
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

vi.mock('nuxt/server', async () => {
  const { connectorsNuxtServerMockFactory } = await import(
    '../../setup/helpers/connectors-oauth'
  )

  return await connectorsNuxtServerMockFactory()
})

vi.mock('~~/server/utils/features/guards', () => ({
  requireFeature: async (_event: unknown, flag: string) => {
    if (!mocks.flags.has(flag)) {
      throw Object.assign(new Error('Not found'), { status: 404 })
    }

    return { active: true }
  },
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({ set: vi.fn() }),
}))

vi.mock('~~/server/utils/request-public-origin', () => ({
  resolveRequestPublicOrigin: () => 'https://besidka.com',
}))

type Handler = (event: SkillsRouteEvent) => Promise<any>

async function handler(path: string): Promise<Handler> {
  return (await import(path)).default as Handler
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, code?: string }
  }

  throw new Error('Expected a rejection')
}

describe('chat tool approval grant routes', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let chat: { id: string, slug: string }
  let sessionUserId: number
  let connectorId: string

  const listPath = '~~/server/api/v1/chats/[slug]/tool-approvals/index.get'
  const resetPath = '~~/server/api/v1/chats/[slug]/tool-approvals/reset.post'
  const revokePath = '~~/server/api/v1/chats/[slug]/tool-approvals/revoke.post'

  function call(path: string, partial: Partial<SkillsRouteEvent> = {}) {
    return handler(path).then((run) => {
      return run(createSkillsRouteEvent({
        params: { slug: chat.slug },
        ...partial,
        headers: {
          'origin': ORIGIN,
          'sec-fetch-site': 'same-origin',
          ...partial.headers,
        },
      }))
    })
  }

  async function seedGrants() {
    const store = await import('~~/server/utils/connectors/store')
    const { buildExposedToolName } = await import(
      '~~/server/utils/connectors/tool-definitions'
    )
    const connector = await store.createConnector(testDb.db, {
      userId,
      title: 'Linear',
      url: 'https://mcp.linear.example.com/mcp',
      slugBase: 'linear',
      createdVia: 'app',
    })

    await store.updateConnector(testDb.db, userId, connector.id, {
      status: 'ready',
      enabled: true,
      consentOrigin: connector.origin,
      consentVersion: CONNECTOR_CONSENT_VERSION,
    })
    await store.upsertConnectorToolSettings(testDb.db, userId, connector.id, [
      {
        toolName: 'create_issue',
        definitionHash: 'a'.repeat(64),
        serverReadOnly: false,
        enabled: true,
        approval: 'always',
        approvedDefinitionHash: 'a'.repeat(64),
      },
      {
        toolName: 'update_issue',
        definitionHash: 'b'.repeat(64),
        serverReadOnly: false,
        enabled: true,
        approval: 'ask',
      },
    ])
    await store.upsertConnectorChatSettings(testDb.db, {
      userId,
      chatPublicId: chat.id,
      connectorId: connector.id,
      enabled: true,
      alwaysAllowTools: {
        [await buildExposedToolName(connector.slug, 'update_issue')]:
          'b'.repeat(64),
      },
    })

    return connector.id
  }

  beforeEach(async () => {
    mocks.flags = new Set(['connectors', 'tool-approvals'])
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    sessionUserId = userId
    chat = await seedChat(testDb.db, userId)
    vi.stubGlobal('useDb', () => testDb.db)
    const kv = createFakeConnectorKv()

    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useEncryptText', vi.fn(async (plain: string) => {
      return fakeEncrypt(plain)
    }))
    vi.stubGlobal('useDecryptText', vi.fn(async (cipher: string) => {
      return fakeDecrypt(cipher)
    }))
    vi.stubGlobal('useUserSession', async () => {
      return { user: { id: String(sessionUserId) } }
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    connectorId = await seedGrants()
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('lists the chat and always grants by name, never by hash', async () => {
    const result = await call(listPath)

    expect(result).toEqual({
      grants: [
        {
          scope: 'chat',
          connectorId,
          connectorTitle: 'Linear',
          toolName: 'update_issue',
        },
        {
          scope: 'always',
          connectorId,
          connectorTitle: 'Linear',
          toolName: 'create_issue',
        },
      ],
    })
    expect(JSON.stringify(result)).not.toContain('a'.repeat(64))
  })

  it('lists Google read and egress grants with plain labels, and Reset '
    + 'clears them', async () => {
    const store = await import('~~/server/utils/connectors/store')
    const { buildExposedToolName } = await import(
      '~~/server/utils/connectors/tool-definitions'
    )
    const { addBesidkaChatGrant } = await import(
      '~~/server/utils/besidka-tools/chat-settings'
    )
    const [connector] = await store.listConnectors(testDb.db, userId)
    const exposedName = await buildExposedToolName(
      connector!.slug,
      'update_issue',
    )

    await store.upsertConnectorChatSettings(testDb.db, {
      userId,
      chatPublicId: chat.id,
      connectorId,
      enabled: true,
      alwaysAllowTools: {
        [`google-egress:${exposedName}`]: 'b'.repeat(64),
      },
    })
    await addBesidkaChatGrant(testDb.db, userId, chat.id, {
      toolName: 'google__drive_search',
      definitionHash: 'c'.repeat(64),
    })

    const result = await call(listPath)

    expect(result.grants).toEqual(expect.arrayContaining([
      {
        scope: 'chat',
        connectorId,
        connectorTitle: 'Linear',
        toolName: 'update_issue',
        source: 'google-egress',
      },
      {
        scope: 'chat',
        connectorId: '',
        connectorTitle: 'Google',
        toolName: 'google__drive_search',
        source: 'google',
      },
    ]))
    expect(JSON.stringify(result)).not.toContain('c'.repeat(64))

    await call(resetPath)

    const sources = (await call(listPath)).grants.map((grant: {
      source?: string
    }) => grant.source)

    expect(sources).not.toContain('google')
    expect(sources).not.toContain('google-egress')
  })

  it('resets only the chat grants and keeps the connector on', async () => {
    expect(await call(resetPath)).toEqual({ ok: true })

    const result = await call(listPath)

    expect(result.grants.map((grant: { scope: string }) => grant.scope))
      .toEqual(['always'])

    const { listConnectorChatSettings } = await import(
      '~~/server/utils/connectors/store'
    )
    const [setting] = await listConnectorChatSettings(
      testDb.db,
      userId,
      chat.id,
    )

    expect(setting).toMatchObject({ enabled: true, alwaysAllowTools: {} })
  })

  it('revokes one always grant', async () => {
    expect(await call(revokePath, {
      body: { connectorId, toolName: 'create_issue' },
    })).toEqual({ ok: true })
    expect((await call(listPath)).grants.map((grant: {
      scope: string
    }) => grant.scope)).toEqual(['chat'])
    expect((await failureOf(call(revokePath, {
      body: { connectorId: 'missing', toolName: 'create_issue' },
    }))).status).toBe(404)
  })

  it('answers 404 for a chat of another user and keeps its grants',
    async () => {
      sessionUserId = await seedUser(testDb.db, null)

      expect((await failureOf(call(listPath))).status).toBe(404)
      expect((await failureOf(call(resetPath))).status).toBe(404)
      expect((await failureOf(call(revokePath, {
        body: { connectorId, toolName: 'create_issue' },
      }))).status).toBe(404)

      sessionUserId = userId

      expect((await call(listPath)).grants).toHaveLength(2)
    })

  it('refuses a cross-site write before touching the data', async () => {
    const crossSite = await failureOf(call(resetPath, {
      headers: { 'origin': 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    }))
    const noOrigin = await failureOf(call(revokePath, {
      headers: { origin: '' },
      body: { connectorId, toolName: 'create_issue' },
    }))

    expect(crossSite.status).toBe(403)
    expect(noOrigin.status).toBe(403)
    expect((await call(listPath)).grants).toHaveLength(2)
  })

  it('is hidden behind the tool-approvals flag and a session', async () => {
    mocks.flags.delete('tool-approvals')

    expect((await failureOf(call(listPath))).status).toBe(404)
    expect((await failureOf(call(resetPath))).status).toBe(404)

    mocks.flags.add('tool-approvals')
    vi.stubGlobal('useUserSession', async () => null)

    expect((await failureOf(call(listPath))).status).toBe(401)
  })
})
