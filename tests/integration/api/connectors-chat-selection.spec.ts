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

describe('connector chat selection routes', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let chat: { id: string, slug: string }
  let sessionUserId: number

  async function addConnector(
    slug: string,
    owner: number = userId,
    patch: Record<string, unknown> = { status: 'ready', enabled: true },
  ) {
    const { createConnector, updateConnector } = await import(
      '~~/server/utils/connectors/store'
    )
    const connector = await createConnector(testDb.db, {
      userId: owner,
      title: slug,
      url: `https://mcp.${slug}.example.com/mcp?key=top-secret`,
      slugBase: slug,
      createdVia: 'app',
    })

    await updateConnector(testDb.db, owner, connector.id, {
      consentOrigin: connector.origin,
      consentVersion: CONNECTOR_CONSENT_VERSION,
      ...patch,
    })

    return connector.id
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

  const listPath = '~~/server/api/v1/connectors/index.get'
  const getPath = '~~/server/api/v1/chats/[slug]/connectors/index.get'
  const putPath = '~~/server/api/v1/chats/[slug]/connectors/index.put'

  beforeEach(async () => {
    mocks.flags = new Set(['connectors'])
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
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('GET /api/v1/connectors', () => {
    it('lists the account\'s connectors as safe summaries', async () => {
      await addConnector('linear')
      await addConnector('foreign', await seedUser(testDb.db, null))

      const result = await call(listPath)

      expect(result.connectors).toHaveLength(1)
      expect(result.connectors[0]).toMatchObject({
        slug: 'linear',
        host: 'mcp.linear.example.com',
        status: 'ready',
        enabled: true,
      })
      expect(JSON.stringify(result)).not.toContain('top-secret')
      expect(JSON.stringify(result)).not.toContain('url')
    })

    it('is hidden behind the connectors flag and a session', async () => {
      mocks.flags.clear()

      expect((await failureOf(call(listPath))).status).toBe(404)

      mocks.flags.add('connectors')
      vi.stubGlobal('useUserSession', async () => null)

      expect((await failureOf(call(listPath))).status).toBe(401)
    })
  })

  describe('PUT and GET /api/v1/chats/[slug]/connectors', () => {
    it('stores the choice per chat and reads it back', async () => {
      const first = await addConnector('first')
      const second = await addConnector('second')

      expect(await call(getPath, { params: { slug: chat.slug } }))
        .toEqual({ connectorIds: [] })

      const saved = await call(putPath, {
        params: { slug: chat.slug },
        body: { connectorIds: [first, second] },
      })

      expect(saved.connectorIds).toEqual([first, second])
      expect((await call(getPath, { params: { slug: chat.slug } }))
        .connectorIds.sort()).toEqual([first, second].sort())

      await call(putPath, {
        params: { slug: chat.slug },
        body: { connectorIds: [second] },
      })

      expect((await call(getPath, { params: { slug: chat.slug } }))
        .connectorIds).toEqual([second])
    })

    it('omits a stored connector that was turned off or needs sign-in, '
      + 'and returns it once it is selectable again', async () => {
      const { updateConnector } = await import(
        '~~/server/utils/connectors/store'
      )
      const kept = await addConnector('kept')
      const turnedOff = await addConnector('turned-off')
      const needsAuth = await addConnector('needs-auth')

      await call(putPath, {
        params: { slug: chat.slug },
        body: { connectorIds: [kept, turnedOff, needsAuth] },
      })
      await updateConnector(testDb.db, userId, turnedOff, { enabled: false })
      await updateConnector(testDb.db, userId, needsAuth, {
        status: 'needs-auth',
      })

      expect((await call(getPath, { params: { slug: chat.slug } }))
        .connectorIds).toEqual([kept])

      await updateConnector(testDb.db, userId, turnedOff, { enabled: true })

      expect((await call(getPath, { params: { slug: chat.slug } }))
        .connectorIds.sort()).toEqual([kept, turnedOff].sort())
    })

    it('refuses a sixth connector, an unknown id and a connector that is '
      + 'not ready', async () => {
      const ids: string[] = []

      for (const slug of ['a', 'b', 'c', 'd', 'e', 'f']) {
        ids.push(await addConnector(slug))
      }

      const notReady = await addConnector('pending', userId, {
        status: 'needs-auth',
        enabled: false,
      })

      expect((await failureOf(call(putPath, {
        params: { slug: chat.slug },
        body: { connectorIds: ids },
      }))).code).toBe('CONNECTORS_PER_CHAT_LIMIT')
      expect((await failureOf(call(putPath, {
        params: { slug: chat.slug },
        body: { connectorIds: ['unknown1'] },
      }))).code).toBe('CONNECTOR_NOT_FOUND')
      expect((await failureOf(call(putPath, {
        params: { slug: chat.slug },
        body: { connectorIds: [notReady] },
      }))).code).toBe('CONNECTOR_NOT_READY')
      expect((await call(getPath, { params: { slug: chat.slug } }))
        .connectorIds).toEqual([])
    })

    it('does not accept another account\'s connector or chat', async () => {
      const otherUser = await seedUser(testDb.db, null)
      const foreignConnector = await addConnector('foreign', otherUser)
      const foreignChat = await seedChat(testDb.db, otherUser)

      expect((await failureOf(call(putPath, {
        params: { slug: chat.slug },
        body: { connectorIds: [foreignConnector] },
      }))).code).toBe('CONNECTOR_NOT_FOUND')
      expect((await failureOf(call(getPath, {
        params: { slug: foreignChat.slug },
      }))).status).toBe(404)
      expect((await failureOf(call(putPath, {
        params: { slug: foreignChat.slug },
        body: { connectorIds: [] },
      }))).status).toBe(404)
    })

    it('guards the write against another origin and bad input', async () => {
      expect((await failureOf(call(putPath, {
        params: { slug: chat.slug },
        body: { connectorIds: [] },
        headers: { origin: 'https://evil.example' },
      }))).status).toBe(403)
      expect((await failureOf(call(putPath, {
        params: { slug: chat.slug },
        body: { connectorIds: 'all' },
      }))).status).toBe(400)
      expect((await failureOf(call(getPath, {
        params: { slug: 'not-a-ulid' },
      }))).status).toBe(400)
    })

    it('does not throttle picker toggles like connector changes, and '
      + 'still caps a flood at 60 a minute', async () => {
      const connectorId = await addConnector('linear')

      for (let toggle = 0; toggle < 60; toggle++) {
        await call(putPath, {
          params: { slug: chat.slug },
          body: { connectorIds: toggle % 2 === 0 ? [connectorId] : [] },
        })
      }

      expect((await failureOf(call(putPath, {
        params: { slug: chat.slug },
        body: { connectorIds: [] },
      }))).status).toBe(429)
    })

    it('is hidden behind the connectors flag', async () => {
      mocks.flags.clear()

      expect((await failureOf(call(getPath, {
        params: { slug: chat.slug },
      }))).status).toBe(404)
    })
  })
})
