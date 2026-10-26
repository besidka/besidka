import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNotCrossSiteRequest } from '~~/server/utils/cross-site-guard'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { MEMORY_RATE_LIMITS } from '~~/server/utils/memory/rate-limit'
import { createMemoryTestDb } from '../../setup/helpers/memory-db'
import { createFakeKnowledgeKv } from '../../setup/helpers/knowledge-api'

vi.mock('evlog', () => ({
  createError: (input: {
    message: string
    status?: number
    why?: string
    fix?: string
  }) => {
    const exception = new Error(input.message)

    Object.assign(exception, input)

    return exception
  },
  useLogger: () => ({ set: vi.fn() }),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({ set: vi.fn() }),
}))

const USER_ID = 1
const OTHER_USER_ID = 2
const WRITE_LIMIT = MEMORY_RATE_LIMITS.write.max

type Handler = (event: unknown) => Promise<unknown>

interface RouteCase {
  name: string
  path: string
  event: () => Record<string, unknown>
}

function requestEvent(
  overrides: { body?: unknown, params?: Record<string, string> } = {},
) {
  return {
    body: overrides.body,
    context: overrides.params ? { params: overrides.params } : {},
    headers: {},
    res: { headers: new Headers() },
  }
}

const ROUTES: RouteCase[] = [
  {
    name: 'entry create',
    path: '../../../server/api/v1/memory/entries/index.post',
    event: () => requestEvent({ body: {} }),
  },
  {
    name: 'entry patch',
    path: '../../../server/api/v1/memory/entries/[id]/index.patch',
    event: () => requestEvent({
      body: { title: 42 },
      params: { id: encodePublicId(999) },
    }),
  },
  {
    name: 'entry delete',
    path: '../../../server/api/v1/memory/entries/[id]/index.delete',
    event: () => requestEvent({ params: { id: encodePublicId(999) } }),
  },
  {
    name: 'reset',
    path: '../../../server/api/v1/memory/entries/reset.post',
    event: () => requestEvent({ body: { scope: 'nope' } }),
  },
  {
    name: 'delete extracted',
    path: '../../../server/api/v1/memory/entries/delete-extracted.post',
    event: () => requestEvent(),
  },
  {
    name: 'import',
    path: '../../../server/api/v1/memory/import.post',
    event: () => requestEvent({ body: {} }),
  },
  {
    name: 'extract-now',
    path: '../../../server/api/v1/memory/extract-now.post',
    event: () => requestEvent({ body: {} }),
  },
  {
    name: 'backfill start',
    path: '../../../server/api/v1/memory/backfill/index.post',
    event: () => requestEvent({ body: { restart: 'yes' } }),
  },
]

async function loadHandler(path: string): Promise<Handler> {
  const module = await import(/* @vite-ignore */ path)

  return module.default
}

async function settle(handler: Handler, event: unknown) {
  try {
    return { result: await handler(event), exception: null }
  } catch (exception) {
    return { result: null, exception: exception as { status?: number } }
  }
}

describe('memory write rate limit', () => {
  let testDb: ReturnType<typeof createMemoryTestDb>
  let kv: ReturnType<typeof createFakeKnowledgeKv>
  let sessionUserId: number

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-26T10:00:00Z'))
    testDb = createMemoryTestDb()
    kv = createFakeKnowledgeKv()
    sessionUserId = USER_ID

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('assertNotCrossSiteRequest', assertNotCrossSiteRequest)
    vi.stubGlobal(
      'getRequestHeader',
      (event: { headers?: Record<string, string> }, name: string) => {
        return event.headers?.[name.toLowerCase()]
      },
    )
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('useUserSession', async () => {
      return { user: { id: String(sessionUserId) } }
    })
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal(
      'readValidatedBody',
      async (event: { body?: unknown }, parser: (body: unknown) => unknown) => {
        return parser(event.body)
      },
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    testDb.close()
  })

  it.each(ROUTES)('answers the $name request after 60 per minute with 429',
    async ({ path, event }) => {
      const handler = await loadHandler(path)

      for (let count = 0; count < WRITE_LIMIT; count++) {
        const { exception } = await settle(handler, event())

        expect(exception?.status).not.toBe(429)
      }

      const limitedEvent = event()
      const { exception } = await settle(handler, limitedEvent)

      expect(exception).toMatchObject({
        status: 429,
        message: 'Too many requests',
      })
      expect(Number(limitedEvent.res.headers.get('retry-after')))
        .toBeGreaterThan(0)
    })

  it('shares one bucket across every memory write route', async () => {
    const handlers = await Promise.all(ROUTES.map(async (route) => {
      return { handler: await loadHandler(route.path), event: route.event }
    }))

    for (let count = 0; count < WRITE_LIMIT; count++) {
      const { handler, event } = handlers[count % handlers.length]!

      await settle(handler, event())
    }

    for (const { handler, event } of handlers) {
      const { exception } = await settle(handler, event())

      expect(exception?.status).toBe(429)
    }
  })

  it.each([
    ['write', 60],
    ['instruct-preview', 6],
    ['instruct-apply', 30],
  ] as const)('limits the %s bucket to %i per minute on its own counter',
    async (bucket, max) => {
      const { enforceMemoryRateLimit } = await import(
        '~~/server/utils/memory/rate-limit'
      )

      for (let count = 0; count < max; count++) {
        await enforceMemoryRateLimit(bucket, USER_ID)
      }

      await expect(enforceMemoryRateLimit(bucket, USER_ID)).rejects
        .toMatchObject({ status: 429 })

      for (const other of ['write', 'instruct-preview', 'instruct-apply']) {
        if (other === bucket) {
          continue
        }

        await expect(enforceMemoryRateLimit(
          other as typeof bucket,
          USER_ID,
        )).resolves.toBeUndefined()
      }
    })

  it('counts each user separately and frees up after the window',
    async () => {
      const handler = await loadHandler(ROUTES[0]!.path)

      for (let count = 0; count < WRITE_LIMIT; count++) {
        await settle(handler, ROUTES[0]!.event())
      }

      expect((await settle(handler, ROUTES[0]!.event())).exception?.status)
        .toBe(429)

      sessionUserId = OTHER_USER_ID

      expect((await settle(handler, ROUTES[0]!.event())).exception?.status)
        .toBe(400)

      sessionUserId = USER_ID
      vi.setSystemTime(new Date('2026-10-26T10:01:01Z'))

      expect((await settle(handler, ROUTES[0]!.event())).exception?.status)
        .toBe(400)
      expect([...kv.values.keys()].sort()).toEqual([
        `memory-rate-limit:write:${USER_ID}`,
        `memory-rate-limit:write:${OTHER_USER_ID}`,
      ])
    })
})
