import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { createFakeConnectorKv } from '../../setup/helpers/connectors-oauth'

const ORIGIN = 'https://besidka.com'

const mocks = vi.hoisted(() => ({
  flags: new Set<string>(['besidka-tools']),
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
    return exception as { status: number }
  }

  throw new Error('Expected a rejection')
}

const getPath = '~~/server/api/v1/besidka-tools/permissions/index.get'
const putPath = '~~/server/api/v1/besidka-tools/permissions/index.put'

describe('Besidka tool permission routes', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let sessionUserId: number

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

  function put(body: unknown, partial: Partial<SkillsRouteEvent> = {}) {
    return call(putPath, { body, ...partial })
  }

  function modeOf(result: { tools: Array<{ name: string, mode: string }> }) {
    return Object.fromEntries(
      result.tools.map(tool => [tool.name, tool.mode]),
    )
  }

  beforeEach(async () => {
    mocks.flags = new Set(['besidka-tools'])
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    sessionUserId = userId

    const kv = createFakeConnectorKv()

    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
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

  describe('GET', () => {
    it('lists the exposed tools with title, tier and mode "ask"', async () => {
      const result = await call(getPath)

      expect(result.tools.length).toBeGreaterThan(20)
      expect(result.tools[0]).toEqual({
        name: expect.any(String),
        title: expect.any(String),
        tier: 'read',
        mode: 'ask',
      })
      expect(new Set(result.tools.map((tool: { tier: string }) => tool.tier)))
        .toEqual(new Set(['read', 'write', 'ask-every-time']))
      expect(modeOf(result)).not.toHaveProperty('set_feature_access')
    })

    it('is hidden behind the flag and needs a session', async () => {
      mocks.flags.clear()

      expect((await failureOf(call(getPath))).status).toBe(404)

      mocks.flags.add('besidka-tools')
      vi.stubGlobal('useUserSession', async () => null)

      expect((await failureOf(call(getPath))).status).toBe(401)
    })
  })

  describe('PUT', () => {
    it('sets one tool and answers with the stored list', async () => {
      const result = await put({ tool: 'list_files', mode: 'allow' })

      expect(modeOf(result).list_files).toBe('allow')
      expect(modeOf(await call(getPath)).list_files).toBe('allow')
      expect(modeOf(await call(getPath)).get_project).toBe('ask')
    })

    it('sets a whole group', async () => {
      const result = await put({ tier: 'write', mode: 'blocked' })
      const writeTools = result.tools.filter((tool: { tier: string }) => {
        return tool.tier === 'write'
      })

      expect(writeTools.length).toBeGreaterThan(0)
      expect(writeTools.every((tool: { mode: string }) => {
        return tool.mode === 'blocked'
      })).toBe(true)
      expect(result.tools.filter((tool: { tier: string }) => {
        return tool.tier === 'read'
      }).every((tool: { mode: string }) => tool.mode === 'ask')).toBe(true)
    })

    it('lets the ask-every-time tier take every mode (owner decision, '
      + '2026-11-20)', async () => {
      const allowed = await put({ tool: 'delete_files', mode: 'allow' })

      expect(modeOf(allowed).delete_files).toBe('allow')

      const blocked = await put({ tier: 'ask-every-time', mode: 'blocked' })

      expect(modeOf(blocked).delete_files).toBe('blocked')
    })

    it('answers 400 for an unknown or excluded tool and a bad body', async () => {
      for (const body of [
        { tool: 'nope', mode: 'ask' },
        { tool: 'set_feature_access', mode: 'ask' },
        { tool: 'google__gmail_search', mode: 'blocked' },
        { tool: 'list_files', mode: 'maybe' },
        { tool: 'list_files', tier: 'read', mode: 'ask' },
        { tier: 'admin', mode: 'ask' },
        { mode: 'ask' },
        null,
      ]) {
        expect((await failureOf(put(body))).status).toBe(400)
      }
    })

    it('isolates users from each other', async () => {
      const otherUserId = await seedUser(testDb.db, null)

      await put({ tool: 'list_files', mode: 'blocked' })

      sessionUserId = otherUserId

      expect(modeOf(await call(getPath)).list_files).toBe('ask')

      await put({ tool: 'list_files', mode: 'allow' })

      sessionUserId = userId

      expect(modeOf(await call(getPath)).list_files).toBe('blocked')
    })

    it('is hidden behind the flag, needs a session and the same origin',
      async () => {
        mocks.flags.clear()

        expect((await failureOf(put({ tool: 'list_files', mode: 'ask' })))
          .status).toBe(404)

        mocks.flags.add('besidka-tools')

        expect((await failureOf(put(
          { tool: 'list_files', mode: 'ask' },
          { headers: { 'sec-fetch-site': 'cross-site' } },
        ))).status).toBe(403)
        expect((await failureOf(put(
          { tool: 'list_files', mode: 'ask' },
          { headers: { origin: 'https://evil.example.com' } },
        ))).status).toBe(403)

        vi.stubGlobal('useUserSession', async () => null)

        expect((await failureOf(put({ tool: 'list_files', mode: 'ask' })))
          .status).toBe(401)
      })

    it('limits writes to 60 a minute and fails closed without KV', async () => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await put({ tool: 'list_files', mode: 'ask' })
      }

      expect((await failureOf(put({ tool: 'list_files', mode: 'ask' })))
        .status).toBe(429)

      vi.stubGlobal('useKV', () => {
        throw new Error('KV down')
      })
      sessionUserId = await seedUser(testDb.db, null)

      expect((await failureOf(put({ tool: 'list_files', mode: 'ask' })))
        .status).toBe(429)
    })
  })

  describe('chat Besidka row', () => {
    const chatGetPath = '~~/server/api/v1/chats/[slug]/besidka-tools/index.get'
    const chatPutPath = '~~/server/api/v1/chats/[slug]/besidka-tools/index.put'

    it('is on by default and switches off and on for one chat', async () => {
      const chat = await seedChat(testDb.db, userId)
      const otherChat = await seedChat(testDb.db, userId)
      const params = { slug: chat.slug }

      expect(await call(chatGetPath, { params })).toEqual({ enabled: true })
      expect(await call(chatPutPath, { params, body: { enabled: false } }))
        .toEqual({ enabled: false })
      expect(await call(chatGetPath, { params })).toEqual({ enabled: false })
      expect(await call(chatGetPath, { params: { slug: otherChat.slug } }))
        .toEqual({ enabled: true })
      expect(await call(chatPutPath, { params, body: { enabled: true } }))
        .toEqual({ enabled: true })
    })

    it('is hidden behind the flag, refuses another user\'s chat and a bad '
      + 'body', async () => {
      const chat = await seedChat(testDb.db, userId)
      const params = { slug: chat.slug }

      expect((await failureOf(call(chatPutPath, {
        params,
        body: { enabled: 'yes' },
      }))).status).toBe(400)

      sessionUserId = await seedUser(testDb.db, null)

      expect((await failureOf(call(chatGetPath, { params }))).status)
        .toBe(404)
      expect((await failureOf(call(chatGetPath, {
        params: { slug: 'not-a-slug' },
      }))).status).toBe(404)

      mocks.flags.clear()

      expect((await failureOf(call(chatGetPath, { params }))).status)
        .toBe(404)
    })
  })
})
