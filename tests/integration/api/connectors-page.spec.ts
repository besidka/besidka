import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONNECTOR_CONSENT_VERSION } from '#shared/utils/connectors-policy'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
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
import type { FakeConnectorKv } from '../../setup/helpers/connectors-oauth'

const ORIGIN = 'https://besidka.com'

const mocks = vi.hoisted(() => ({
  flags: new Set<string>(['connectors']),
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

interface ToolFixture {
  name: string
  description?: string
  annotations?: Record<string, boolean>
}

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

function definitionsOf(tools: ToolFixture[]) {
  return tools.map((tool) => {
    return {
      name: tool.name,
      description: tool.description ?? `${tool.name} description`,
      inputSchema: { type: 'object', properties: {} },
      annotations: tool.annotations ?? {},
    }
  })
}

describe('Connectors page routes', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let sessionUserId: number
  let kv: FakeConnectorKv

  const listPath = '~~/server/api/v1/connectors/index.get'
  const toolsPath = '~~/server/api/v1/connectors/[id]/tools/list.post'
  const settingsPath = '~~/server/api/v1/connectors/[id]/tools/settings.post'
  const reviewPath = '~~/server/api/v1/connectors/[id]/tools/review.post'

  async function addConnector(
    slug: string,
    patch: Record<string, unknown> = {},
    extra: Record<string, unknown> = {},
  ) {
    const { createConnector, updateConnector } = await import(
      '~~/server/utils/connectors/store'
    )
    const connector = await createConnector(testDb.db, {
      userId,
      title: slug,
      url: `https://mcp.${slug}.example.com/mcp?key=top-secret`,
      slugBase: slug,
      createdVia: 'app',
      ...extra,
    })

    await updateConnector(testDb.db, userId, connector.id, {
      authType: 'none',
      status: 'ready',
      consentOrigin: connector.origin,
      consentVersion: CONNECTOR_CONSENT_VERSION,
      consentedAt: new Date(),
      ...patch,
    })

    return connector.id
  }

  async function serveTools(connectorId: string, tools: ToolFixture[]) {
    const { connectorToolsCacheKey } = await import(
      '~~/server/utils/connectors/tool-cache'
    )

    kv.values.set(
      connectorToolsCacheKey(connectorId, 'none'),
      JSON.stringify({ definitions: definitionsOf(tools) }),
    )
  }

  async function settingsOf(connectorId: string) {
    const { readConnectorToolBaseline } = await import(
      '~~/server/utils/connectors/store'
    )

    return await readConnectorToolBaseline(testDb.db, userId, connectorId)
  }

  function call(path: string, partial: Partial<SkillsRouteEvent> = {}) {
    return handler(path).then((run) => {
      return run(createSkillsRouteEvent({
        ...partial,
        headers: {
          'origin': ORIGIN,
          'sec-fetch-site': 'same-origin',
          ...partial.headers,
        },
      }))
    })
  }

  function listTools(connectorId: string) {
    return call(toolsPath, { params: { id: connectorId } })
  }

  function review(
    connectorId: string,
    reviewToken: string,
    decision: 'accept' | 'keep-disabled' = 'accept',
  ) {
    return call(reviewPath, {
      params: { id: connectorId },
      body: { decision, reviewToken },
    })
  }

  beforeEach(async () => {
    mocks.flags = new Set(['connectors'])
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db)
    sessionUserId = userId
    kv = createFakeConnectorKv()
    vi.stubGlobal('useDb', () => testDb.db)
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
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('GET /api/v1/connectors', () => {
    it('adds consent, notes, the adding app and tool counts, and never '
      + 'the address, a token or a hash', async () => {
      await testDb.db.insert(schema.oauthClients).values({
        clientId: 'client-claude',
        name: 'Claude',
        redirectUris: [],
      })

      const viaMcp = await addConnector('linear', {
        consentedAt: null,
        consentOrigin: null,
        consentVersion: null,
        lastError: {
          code: 'CONNECTOR_SCOPE_DEGRADED',
          message: 'The service granted fewer permissions than requested',
        },
      }, { createdVia: 'mcp', createdByClientId: 'client-claude' })
      const reviewed = await addConnector('notion')

      await serveTools(reviewed, [{ name: 'search' }, { name: 'create' }])

      const listed = await listTools(reviewed)

      await review(reviewed, listed.reviewToken)

      const result = await call(listPath)
      const byId = new Map(result.connectors.map((item: any) => {
        return [item.id, item]
      }))

      expect(byId.get(viaMcp)).toMatchObject({
        createdVia: 'mcp',
        addedByApp: 'Claude',
        consent: { state: 'missing' },
        note: { code: 'CONNECTOR_SCOPE_DEGRADED' },
        tools: { isBaselined: false, total: 0 },
      })
      expect(byId.get(reviewed)).toMatchObject({
        addedByApp: null,
        consent: { state: 'current' },
        tools: { isBaselined: true, total: 2, enabled: 2, alwaysAllowed: 0 },
      })

      const serialized = JSON.stringify(result)

      expect(serialized).not.toContain('top-secret')
      expect(serialized).not.toContain('url')
      expect(serialized).not.toMatch(/[a-f0-9]{64}/)
    })

    it('reports a withdrawn and an outdated consent', async () => {
      const withdrawn = await addConnector('withdrawn', {
        consentWithdrawnAt: new Date(Date.now() + 1000),
      })
      const outdated = await addConnector('outdated', {
        consentVersion: '2020-01-a',
      })
      const result = await call(listPath)
      const states = Object.fromEntries(result.connectors.map((item: any) => {
        return [item.id, item.consent.state]
      }))

      expect(states[withdrawn]).toBe('withdrawn')
      expect(states[outdated]).toBe('outdated')
    })
  })

  describe('POST /api/v1/connectors with a directory entry', () => {
    const createPath = '~~/server/api/v1/connectors/index.post'

    async function addEntry(id: string, status: string) {
      await testDb.db.insert(schema.mcpRegistryServers).values({
        id,
        name: id.split('@')[0]!,
        title: 'Tracker',
        description: 'Tracks issues',
        remoteUrl: 'https://mcp.tracker.example/mcp',
        remoteType: 'streamable-http',
        headerNames: [],
        status,
        registryUpdatedAt: new Date(),
        syncedAt: new Date(),
      })
    }

    it('adds the entry\'s own address as a registry connector', async () => {
      await addEntry('io.example/tracker@1.0.0', 'active')

      const result = await call(createPath, {
        body: {
          registryId: 'io.example/tracker@1.0.0',
          url: 'https://evil.example/mcp',
        },
      })

      expect(result.connector).toMatchObject({
        title: 'Tracker',
        origin: 'https://mcp.tracker.example',
        createdVia: 'registry',
        status: 'needs-auth',
        enabled: false,
      })
    })

    it('refuses an unknown or inactive entry', async () => {
      await addEntry('io.example/old@1.0.0', 'deprecated')

      for (const registryId of ['io.example/old@1.0.0', 'missing@1']) {
        expect((await failureOf(call(createPath, {
          body: { registryId },
        }))).status).toBe(400)
      }
    })
  })

  describe('POST /api/v1/connectors/[id]/tools/list', () => {
    it('answers unavailable without a request for a connector that is not '
      + 'connected, and when the consent is missing', async () => {
      const notConnected = await addConnector('pending', {
        status: 'needs-auth',
        authType: null,
      })
      const noConsent = await addConnector('noconsent', { consentedAt: null })

      expect(await listTools(notConnected)).toMatchObject({
        state: 'unavailable',
        code: 'CONNECTOR_NOT_READY',
      })
      expect(await listTools(noConsent)).toMatchObject({
        state: 'unavailable',
        code: 'CONNECTOR_CONSENT_REQUIRED',
        message: 'Consent is required for this connector',
      })
    })

    it('lists every tool as new before the first review, with the server\'s '
      + 'labels', async () => {
      const connectorId = await addConnector('linear')

      await serveTools(connectorId, [
        { name: 'search', annotations: { readOnlyHint: true } },
        { name: 'update_issue' },
        { name: 'wipe', annotations: { destructiveHint: true } },
        { name: 'delete_issue', annotations: { readOnlyHint: true } },
      ])

      const listed = await listTools(connectorId)

      expect(listed.state).toBe('ok')
      expect(listed.isBaselined).toBe(false)
      expect(listed.reviewToken).toMatch(/^[a-f0-9]{64}$/)
      expect(listed.counts).toMatchObject({
        total: 4,
        enabled: 0,
        pending: 4,
        perMessageLimit: 40,
      })
      expect(Object.fromEntries(listed.tools.map((tool: any) => {
        return [tool.name, [tool.change, tool.readOnly, tool.alwaysAsk]]
      }))).toEqual({
        search: ['new', true, false],
        update_issue: ['new', false, false],
        wipe: ['new', false, true],
        delete_issue: ['new', true, true],
      })
      expect(JSON.stringify(listed)).not.toContain('top-secret')
    })

    it('is a guarded write behind the flag', async () => {
      const connectorId = await addConnector('linear')

      expect((await failureOf(call(toolsPath, {
        params: { id: connectorId },
        headers: { origin: 'https://evil.example' },
      }))).status).toBe(403)

      mocks.flags.clear()

      expect((await failureOf(listTools(connectorId))).status).toBe(404)
    })

    it('does not show another account\'s connector', async () => {
      const connectorId = await addConnector('linear')

      sessionUserId = await seedUser(testDb.db)

      expect((await failureOf(listTools(connectorId))).status).toBe(404)
    })
  })

  describe('POST /api/v1/connectors/[id]/tools/review', () => {
    it('takes the first baseline, then hides changes until they are '
      + 'accepted', async () => {
      const { updateConnector } = await import(
        '~~/server/utils/connectors/store'
      )
      const connectorId = await addConnector('linear')

      await serveTools(connectorId, [
        { name: 'search' },
        { name: 'update_issue' },
        { name: 'old_tool' },
      ])
      await review(connectorId, (await listTools(connectorId)).reviewToken)

      const first = await settingsOf(connectorId)

      expect(first.isBaselined).toBe(true)
      expect(first.settings.map(row => [row.toolName, row.enabled]))
        .toEqual([['old_tool', true], ['search', true], ['update_issue', true]])

      for (const row of first.settings) {
        await testDb.db.update(schema.connectorToolSettings).set({
          approval: 'always',
          approvedDefinitionHash: row.definitionHash,
          enabled: row.toolName !== 'update_issue',
        }).where(eq(schema.connectorToolSettings.id, row.id))
      }
      await updateConnector(testDb.db, userId, connectorId, {
        status: 'drifted',
      })
      await serveTools(connectorId, [
        { name: 'search' },
        { name: 'update_issue', description: 'Now also deletes things' },
        { name: 'new_tool' },
      ])

      const drifted = await listTools(connectorId)

      expect(drifted.isBaselined).toBe(true)
      expect(drifted.removed).toEqual(['old_tool'])
      expect(Object.fromEntries(drifted.tools.map((tool: any) => {
        return [tool.name, tool.change]
      }))).toEqual({
        search: 'none',
        update_issue: 'changed',
        new_tool: 'added',
      })
      expect(drifted.tools.find((tool: any) => tool.name === 'search'))
        .toMatchObject({ alwaysAllowed: true })
      expect(drifted.tools.find((tool: any) => tool.name === 'update_issue'))
        .toMatchObject({ description: 'Now also deletes things' })

      await review(connectorId, drifted.reviewToken)

      const accepted = await settingsOf(connectorId)
      const rows = Object.fromEntries(accepted.settings.map((row) => {
        return [row.toolName, row]
      }))

      expect(Object.keys(rows).sort()).toEqual([
        'new_tool',
        'search',
        'update_issue',
      ])
      expect(rows.new_tool).toMatchObject({ enabled: true, approval: 'ask' })
      expect(rows.update_issue).toMatchObject({
        enabled: false,
        approval: 'ask',
        approvedDefinitionHash: null,
      })
      expect(rows.search).toMatchObject({ approval: 'always' })

      const after = await listTools(connectorId)

      expect(after.counts.pending).toBe(0)

      const listed = await call(listPath)

      expect(listed.connectors[0].status).toBe('ready')
    })

    it('stores added tools off with Keep disabled', async () => {
      const connectorId = await addConnector('linear')

      await serveTools(connectorId, [{ name: 'search' }])
      await review(connectorId, (await listTools(connectorId)).reviewToken)
      await serveTools(connectorId, [{ name: 'search' }, { name: 'post' }])
      await review(
        connectorId,
        (await listTools(connectorId)).reviewToken,
        'keep-disabled',
      )

      const { settings } = await settingsOf(connectorId)

      expect(settings.map(row => [row.toolName, row.enabled]))
        .toEqual([['post', false], ['search', true]])
    })

    it('refuses a review of a list that changed since it was shown',
      async () => {
        const connectorId = await addConnector('linear')

        await serveTools(connectorId, [{ name: 'search' }])

        const shown = await listTools(connectorId)

        await serveTools(connectorId, [{ name: 'search' }, { name: 'sneaky' }])

        expect((await failureOf(review(connectorId, shown.reviewToken))).code)
          .toBe('CONNECTOR_TOOLS_REVIEW_STALE')
        expect((await settingsOf(connectorId)).isBaselined).toBe(false)
        expect((await failureOf(review(connectorId, 'not-a-token'))).status)
          .toBe(400)
      })
  })

  describe('POST /api/v1/connectors/[id]/tools/settings', () => {
    it('turns reviewed tools on and off and removes Always allow without '
      + 'accepting a new definition', async () => {
      const connectorId = await addConnector('linear')

      await serveTools(connectorId, [{ name: 'search' }, { name: 'post' }])
      await review(connectorId, (await listTools(connectorId)).reviewToken)

      const before = await settingsOf(connectorId)
      const postHash = before.settings
        .find(row => row.toolName === 'post')!.definitionHash

      await testDb.db.update(schema.connectorToolSettings).set({
        approval: 'always',
        approvedDefinitionHash: postHash,
      })

      const result = await call(settingsPath, {
        params: { id: connectorId },
        body: {
          tools: [
            { name: 'search', enabled: false },
            { name: 'post', approval: 'ask' },
          ],
        },
      })

      expect(result.updated.sort()).toEqual(['post', 'search'])

      const rows = Object.fromEntries((await settingsOf(connectorId)).settings
        .map(row => [row.toolName, row]))

      expect(rows.search).toMatchObject({ enabled: false, approval: 'always' })
      expect(rows.post).toMatchObject({
        enabled: true,
        approval: 'ask',
        approvedDefinitionHash: null,
        definitionHash: postHash,
      })
    })

    it('never grants Always allow and refuses unknown tools', async () => {
      const connectorId = await addConnector('linear')

      await serveTools(connectorId, [{ name: 'search' }])
      await review(connectorId, (await listTools(connectorId)).reviewToken)

      expect((await failureOf(call(settingsPath, {
        params: { id: connectorId },
        body: { tools: [{ name: 'search', approval: 'always' }] },
      }))).status).toBe(400)
      expect((await failureOf(call(settingsPath, {
        params: { id: connectorId },
        body: { tools: [{ name: 'missing', enabled: true }] },
      }))).code).toBe('CONNECTOR_TOOL_NOT_FOUND')
      expect((await failureOf(call(settingsPath, {
        params: { id: connectorId },
        body: { tools: [{ name: '', enabled: true }] },
      }))).status).toBe(400)
    })

    it('does not change another account\'s tools', async () => {
      const connectorId = await addConnector('linear')

      await serveTools(connectorId, [{ name: 'search' }])
      await review(connectorId, (await listTools(connectorId)).reviewToken)

      sessionUserId = await seedUser(testDb.db)

      expect((await failureOf(call(settingsPath, {
        params: { id: connectorId },
        body: { tools: [{ name: 'search', enabled: false }] },
      }))).status).toBe(404)
    })
  })
})
