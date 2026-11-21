import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNotCrossSiteRequest } from '~~/server/utils/cross-site-guard'
import {
  generationStopKvKey,
  readGenerationLeaseState,
  serializeGenerationLease,
} from '~~/server/utils/chats/generation-lease'
import { generationInProgressKvKey } from '~~/server/utils/chats/generation-in-progress'
import { createFakeKnowledgeKv } from '../../setup/helpers/knowledge-api'
import type { FakeKnowledgeKv } from '../../setup/helpers/knowledge-api'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  params: { slug: '' } as Record<string, string>,
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({ set: mocks.loggerSet }),
}))

vi.mock('~~/server/utils/http/get-decoded-router-params', () => ({
  getDecodedRouterParams: () => mocks.params,
}))

async function loadHandler() {
  const module = await import('../../../server/api/v1/chats/[slug]/stop.post')

  return module.default
}

describe('POST /api/v1/chats/:slug/stop', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let kv: FakeKnowledgeKv

  beforeEach(async () => {
    vi.resetModules()
    mocks.loggerSet.mockReset()
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db)
    kv = createFakeKnowledgeKv()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('assertNotCrossSiteRequest', assertNotCrossSiteRequest)
    vi.stubGlobal(
      'getRequestHeader',
      (event: { headers?: Record<string, string> }, name: string) => {
        return event.headers?.[name.toLowerCase()]
      },
    )
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal(
      'readValidatedBody',
      async (event: { body: unknown }, parser: (body: unknown) => unknown) => {
        return parser(event.body)
      },
    )
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: String(userId) },
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.close()
  })

  async function call(
    slug: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    const handler = await loadHandler()

    mocks.params = { slug }

    return await handler({
      body,
      headers,
      res: { headers: new Headers() },
    } as never)
  }

  async function holdLease(chatId: string, messageId: string, runId: string) {
    await kv.put(
      generationInProgressKvKey(chatId, messageId),
      serializeGenerationLease({ runId, renewedAt: Date.now() }),
    )
  }

  it('stops the run, frees the message for a retry and logs the stop',
    async () => {
      const chat = await seedChat(testDb.db, userId)

      await holdLease(chat.id, 'user-msg-1', 'run-1')

      expect(await call(chat.slug, { messageId: 'user-msg-1' }))
        .toEqual({ stopped: true, runId: 'run-1' })
      expect(kv.values.has(generationInProgressKvKey(chat.id, 'user-msg-1')))
        .toBe(false)
      expect(kv.values.get(generationStopKvKey('run-1'))).toBe('1')
      expect(await readGenerationLeaseState(
        kv,
        generationInProgressKvKey(chat.id, 'user-msg-1'),
      )).toEqual({ state: 'free' })
      expect(mocks.loggerSet).toHaveBeenCalledWith(expect.objectContaining({
        attributes: {
          generationStop: { hadLease: true, runId: 'run-1' },
        },
      }))
    })

  it('answers stopped false when nothing generates', async () => {
    const chat = await seedChat(testDb.db, userId)

    expect(await call(chat.slug, { messageId: 'user-msg-1' }))
      .toEqual({ stopped: false, runId: null })
  })

  it('never touches another user\'s chat', async () => {
    const otherUserId = await seedUser(testDb.db)
    const chat = await seedChat(testDb.db, otherUserId)

    await holdLease(chat.id, 'user-msg-1', 'run-1')

    await expect(call(chat.slug, { messageId: 'user-msg-1' }))
      .rejects.toMatchObject({ status: 404 })
    expect(kv.values.has(generationInProgressKvKey(chat.id, 'user-msg-1')))
      .toBe(true)
    expect(kv.values.has(generationStopKvKey('run-1'))).toBe(false)
  })

  it('refuses a malformed body, slug and a cross-site request', async () => {
    const chat = await seedChat(testDb.db, userId)

    await expect(call(chat.slug, { messageId: 'bad id!' }))
      .rejects.toMatchObject({ status: 400 })
    await expect(call(chat.slug, { messageId: 'a', extra: true }))
      .rejects.toMatchObject({ status: 400 })
    await expect(call('not-a-ulid', { messageId: 'a' }))
      .rejects.toMatchObject({ status: 400 })
    await expect(call(chat.slug, { messageId: 'a' }, {
      'sec-fetch-site': 'cross-site',
    })).rejects.toMatchObject({ status: 403 })
  })

  it('limits stops to 30 a minute per user', async () => {
    const chat = await seedChat(testDb.db, userId)

    for (let index = 0; index < 30; index++) {
      await call(chat.slug, { messageId: 'user-msg-1' })
    }

    await expect(call(chat.slug, { messageId: 'user-msg-1' }))
      .rejects.toMatchObject({ status: 429 })
  })

  it('rejects a request without a session', async () => {
    const chat = await seedChat(testDb.db, userId)

    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    await expect(call(chat.slug, { messageId: 'user-msg-1' }))
      .rejects.toMatchObject({ status: 401 })
  })
})
