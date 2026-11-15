import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONNECTOR_CONSENT_VERSION } from '#shared/utils/connectors-policy'
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
  PNG_BYTES,
  createFakeIconKv,
} from '../../setup/helpers/connector-icon-kv'
import type { FakeIconKv } from '../../setup/helpers/connector-icon-kv'
import { fakeDecrypt, fakeEncrypt } from '../../setup/helpers/connectors-oauth'

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

const iconPath = '~~/server/api/v1/connectors/[id]/icon.get'
const disconnectPath = '~~/server/api/v1/connectors/[id]/disconnect.post'
const withdrawPath = '~~/server/api/v1/connectors/[id]/consent/withdraw.post'

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, code?: string }
  }

  throw new Error('Expected a rejection')
}

describe('GET /api/v1/connectors/[id]/icon', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let sessionUserId: number
  let kv: FakeIconKv
  const fetchMock = vi.fn()

  async function addConnector(
    patch: Record<string, unknown> = {},
    owner: number = userId,
  ) {
    const { createConnector, updateConnector } = await import(
      '~~/server/utils/connectors/store'
    )
    const connector = await createConnector(testDb.db, {
      userId: owner,
      title: 'Notion',
      url: 'https://mcp.notion.com/mcp?key=top-secret',
      slugBase: 'notion',
      createdVia: 'app',
    })

    await updateConnector(testDb.db, owner, connector.id, {
      consentOrigin: connector.origin,
      consentVersion: CONNECTOR_CONSENT_VERSION,
      consentedAt: new Date(),
      status: 'ready',
      enabled: true,
      ...patch,
    })

    return connector.id
  }

  async function request(connectorId: string): Promise<Response> {
    const handler = (await import(iconPath)).default as (
      event: SkillsRouteEvent,
    ) => Promise<Response>

    return await handler(createSkillsRouteEvent({
      params: { id: connectorId },
    }))
  }

  beforeEach(async () => {
    mocks.flags = new Set(['connectors'])
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    sessionUserId = userId
    kv = createFakeIconKv()
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => new Response(PNG_BYTES))
    vi.stubGlobal('fetch', fetchMock)
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

  it('serves the favicon of the host to the owner with safe headers', async () => {
    const response = await request(await addConnector())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control'))
      .toBe('private, max-age=86400')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cross-origin-resource-policy'))
      .toBe('same-origin')
    expect(response.headers.get('content-security-policy'))
      .toBe('default-src \'none\'; sandbox')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('https://mcp.notion.com/favicon.ico')
  })

  it('asks the network once and then serves the kept copy', async () => {
    const connectorId = await addConnector()

    await request(connectorId)
    const second = await request(connectorId)

    expect(second.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('answers 404 to another user, without any request to the server', async () => {
    const connectorId = await addConnector()

    sessionUserId = await seedUser(testDb.db, null)

    expect((await failureOf(request(connectorId))).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown or malformed id', async () => {
    expect((await failureOf(request('missing'))).status).toBe(404)
    expect((await failureOf(request('../etc'))).status).toBe(404)
  })

  it('answers 401 without a session and 404 with the flag off', async () => {
    const connectorId = await addConnector()

    mocks.flags.clear()

    expect((await failureOf(request(connectorId))).status).toBe(404)

    mocks.flags.add('connectors')
    vi.stubGlobal('useUserSession', async () => null)

    expect((await failureOf(request(connectorId))).status).toBe(401)
  })

  it('does not fetch for a connector without current consent or not connected', async () => {
    const withdrawn = await addConnector({
      consentWithdrawnAt: new Date(Date.now() + 1000),
    })
    const needsAuth = await addConnector({ status: 'needs-auth' })
    const unconsented = await addConnector({ consentedAt: null })

    for (const connectorId of [withdrawn, needsAuth, unconsented]) {
      const response = await request(connectorId)

      expect(response.status).toBe(404)
      expect(response.headers.get('cache-control')).toBe('private, max-age=3600')
    }

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers a short 404 while another request is fetching', async () => {
    const connectorId = await addConnector()

    await kv.put(`connectors:icon-lock:${connectorId}`, '1', {
      expirationTtl: 60,
    })

    const response = await request(connectorId)

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('private, max-age=5')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('limits the icon route to 120 requests a minute per user', async () => {
    const connectorId = await addConnector()

    for (let index = 0; index < 120; index += 1) {
      expect((await request(connectorId)).status).toBe(200)
    }

    const exception = await failureOf(request(connectorId))

    expect(exception.status).toBe(429)
  })

  describe('cleanup', () => {
    async function seedIconKeys(connectorId: string) {
      await kv.put(`connectors:icon:${connectorId}`, 'x')
      await kv.put(`connectors:icon-sources:${connectorId}`, 'x')
    }

    async function callWrite(path: string, connectorId: string) {
      const handler = (await import(path)).default as (
        event: SkillsRouteEvent,
      ) => Promise<unknown>

      return await handler(createSkillsRouteEvent({
        params: { id: connectorId },
        headers: { 'origin': 'https://besidka.com', 'sec-fetch-site': 'same-origin' },
      }))
    }

    it('drops the icon caches when the connector is disconnected', async () => {
      const connectorId = await addConnector()

      await seedIconKeys(connectorId)
      await callWrite(disconnectPath, connectorId)

      expect([...kv.entries.keys()].filter((key) => {
        return key.startsWith('connectors:icon')
      })).toEqual([])
    })

    it('drops the icon caches when the consent is withdrawn', async () => {
      const connectorId = await addConnector()

      await seedIconKeys(connectorId)
      await callWrite(withdrawPath, connectorId)

      expect([...kv.entries.keys()].filter((key) => {
        return key.startsWith('connectors:icon')
      })).toEqual([])
    })
  })

  it('answers a cacheable 404 when the host has no usable icon', async () => {
    fetchMock.mockImplementation(async () => {
      return new Response('<html></html>', { status: 200 })
    })

    const connectorId = await addConnector()
    const response = await request(connectorId)

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('private, max-age=3600')

    const callsAfterFirst = fetchMock.mock.calls.length

    await request(connectorId)

    expect(fetchMock).toHaveBeenCalledTimes(callsAfterFirst)
  })
})
