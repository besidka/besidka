import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
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
  flags: new Set<string>(['google.drive']),
  logged: [] as unknown[],
}))

vi.mock('~~/server/utils/tool-approval/secret', () => ({
  useToolApprovalSecret: async () => 'test-tool-approval-secret',
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

vi.mock('~~/server/utils/features/context', () => ({
  evaluateFeatureForEvent: async (_event: unknown, flag: string) => {
    const isOn = mocks.flags.has(flag)

    return { value: isOn, active: isOn }
  },
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({
    set: (values: unknown) => {
      mocks.logged.push(values)
    },
  }),
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

const getPath = '~~/server/api/v1/chats/[slug]/google-tools/index.get'
const putPath = '~~/server/api/v1/chats/[slug]/google-tools/index.put'

describe('per-chat Google switch routes', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let otherUserId: number
  let slug: string
  let foreignSlug: string
  let chatPublicId: string
  let kv: ReturnType<typeof createFakeConnectorKv>

  function call(path: string, partial: Partial<SkillsRouteEvent> = {}) {
    return handler(path).then((run) => {
      return run(createSkillsRouteEvent({
        params: { slug },
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

  async function rows() {
    return await testDb.db.select().from(schema.besidkaChatSettings)
  }

  beforeEach(async () => {
    mocks.flags = new Set(['google.drive'])
    mocks.logged = []
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    otherUserId = await seedUser(testDb.db, null)

    const chat = await seedChat(testDb.db, userId)
    const foreignChat = await seedChat(testDb.db, otherUserId)

    slug = chat.slug
    chatPublicId = chat.id
    foreignSlug = foreignChat.slug
    kv = createFakeConnectorKv()

    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useUserSession', async () => {
      return { user: { id: String(userId) } }
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
    it('answers every service on for a chat with no stored choice',
      async () => {
        expect(await call(getPath)).toEqual({
          drive: true,
          gmail: true,
          calendar: true,
        })
      })

    it('answers the stored switches', async () => {
      await put({ service: 'gmail', enabled: false })

      expect(await call(getPath)).toEqual({
        drive: true,
        gmail: false,
        calendar: true,
      })
    })

    it('answers every service off for a corrupt stored value', async () => {
      await testDb.db.insert(schema.besidkaChatSettings).values({
        userId,
        chatPublicId,
        enabled: true,
        alwaysAllowTools: {},
        googleServicesOff: 'not json',
      })

      expect(await call(getPath)).toEqual({
        drive: false,
        gmail: false,
        calendar: false,
      })
    })

    it('answers 404 for a chat of another user', async () => {
      expect((await failureOf(call(getPath, { params: { slug: foreignSlug } })))
        .status).toBe(404)
    })

    it('answers 404 for a malformed slug', async () => {
      expect((await failureOf(call(getPath, { params: { slug: 'abc' } })))
        .status).toBe(404)
    })

    it('answers 404 when google.drive is not active for the user',
      async () => {
        mocks.flags.clear()

        expect((await failureOf(call(getPath))).status).toBe(404)
      })

    it('answers 401 without a session', async () => {
      vi.stubGlobal('useUserSession', async () => null)

      expect((await failureOf(call(getPath))).status).toBe(401)
    })

    it('refuses a cross-site read', async () => {
      expect((await failureOf(call(getPath, {
        headers: { 'sec-fetch-site': 'cross-site' },
      }))).status).toBe(403)
    })
  })

  describe('PUT', () => {
    it('switches one service off, keeps the others and stores it',
      async () => {
        expect(await put({ service: 'calendar', enabled: false })).toEqual({
          drive: true,
          gmail: true,
          calendar: false,
        })
        expect(await put({ service: 'drive', enabled: false })).toEqual({
          drive: false,
          gmail: true,
          calendar: false,
        })
        expect(await rows()).toHaveLength(1)
        expect(await put({ service: 'calendar', enabled: true })).toEqual({
          drive: false,
          gmail: true,
          calendar: true,
        })
      })

    it('keeps Besidka\'s switch and the chat\'s grants', async () => {
      await testDb.db.insert(schema.besidkaChatSettings).values({
        userId,
        chatPublicId,
        enabled: false,
        alwaysAllowTools: { google__gmail_search: 'a'.repeat(64) },
      })
      await put({ service: 'gmail', enabled: false })

      const [row] = await rows()

      expect(row).toMatchObject({
        enabled: false,
        alwaysAllowTools: { google__gmail_search: 'a'.repeat(64) },
        googleServicesOff: '["gmail"]',
      })
    })

    it('logs the service and the boolean only', async () => {
      await put({ service: 'gmail', enabled: false })

      expect(mocks.logged).toContainEqual({
        attributes: {
          google: { chatService: { service: 'gmail', enabled: false } },
        },
      })
      expect(JSON.stringify(mocks.logged)).not.toContain(slug)
      expect(JSON.stringify(mocks.logged)).not.toContain(chatPublicId)
    })

    it.each([
      ['an unknown service', { service: 'photos', enabled: true }],
      ['an extra field', { service: 'gmail', enabled: true, extra: 1 }],
      ['a missing flag', { service: 'gmail' }],
      ['a non-boolean flag', { service: 'gmail', enabled: 'no' }],
      ['an empty body', {}],
      ['a list', [{ service: 'gmail', enabled: true }]],
    ])('answers 400 for %s', async (_label, body) => {
      expect((await failureOf(put(body))).status).toBe(400)
      expect(await rows()).toEqual([])
    })

    it('answers 404 for a chat of another user and stores nothing',
      async () => {
        const failure = await failureOf(put(
          { service: 'gmail', enabled: false },
          { params: { slug: foreignSlug } },
        ))

        expect(failure.status).toBe(404)
        expect(await rows()).toEqual([])
      })

    it('checks the chat before the flag, then the flag', async () => {
      mocks.flags.clear()

      expect((await failureOf(put(
        { service: 'gmail', enabled: false },
        { params: { slug: foreignSlug } },
      ))).status).toBe(404)
      expect((await failureOf(put({ service: 'gmail', enabled: false })))
        .status).toBe(404)
      expect(await rows()).toEqual([])
    })

    it('answers 401 without a session', async () => {
      vi.stubGlobal('useUserSession', async () => null)

      expect((await failureOf(put({ service: 'gmail', enabled: false })))
        .status).toBe(401)
    })

    it('refuses a write without the same-origin headers before anything '
      + 'else', async () => {
      vi.stubGlobal('useUserSession', async () => null)

      const failure = await failureOf(put(
        { service: 'gmail', enabled: false },
        { headers: { 'origin': 'https://evil.example', 'sec-fetch-site': 'cross-site' } },
      ))

      expect(failure.status).toBe(403)
    })

    it('refuses a body over 256 bytes by its Content-Length', async () => {
      const failure = await failureOf(put(
        { service: 'gmail', enabled: false },
        { headers: { 'content-length': '257' } },
      ))

      expect(failure.status).toBe(413)
      expect(await rows()).toEqual([])
    })

    it('answers 429 when KV cannot count, and stores nothing', async () => {
      kv.get.mockRejectedValue(new Error('KV down'))

      const failure = await failureOf(put({
        service: 'gmail',
        enabled: false,
      }))

      expect(failure.status).toBe(429)
      expect(await rows()).toEqual([])
    })

    it('answers 429 after 60 changes in a minute', async () => {
      for (let change = 0; change < 60; change += 1) {
        await put({ service: 'gmail', enabled: change % 2 === 0 })
      }

      expect((await failureOf(put({ service: 'gmail', enabled: true })))
        .status).toBe(429)
    })

    it('counts each service on its own KV key, so two quick switches of '
      + 'different services never share one', async () => {
      await put({ service: 'gmail', enabled: false })
      await put({ service: 'drive', enabled: false })
      await put({ service: 'gmail', enabled: true })

      const keys = kv.put.mock.calls.map(([key]) => key)

      expect(keys).toEqual([
        `google-chat-service-rate-limit:${userId}:gmail`,
        `google-chat-service-rate-limit:${userId}:drive`,
        `google-chat-service-rate-limit:${userId}:gmail`,
      ])
    })

    it('limits each service on its own, not the user as a whole',
      async () => {
        for (let change = 0; change < 60; change += 1) {
          await put({ service: 'gmail', enabled: change % 2 === 0 })
        }

        expect(await put({ service: 'drive', enabled: false }))
          .toMatchObject({ drive: false })
        expect((await failureOf(put({ service: 'gmail', enabled: true })))
          .status).toBe(429)
      })

    it('does not count a read against the write limit', async () => {
      for (let read = 0; read < 70; read += 1) {
        await call(getPath)
      }

      expect(await put({ service: 'gmail', enabled: false })).toMatchObject({
        gmail: false,
      })
    })
  })
})
