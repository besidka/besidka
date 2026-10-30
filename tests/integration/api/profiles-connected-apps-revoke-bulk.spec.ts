import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  eventLog: vi.fn(),
  enforceMemoryRateLimit: vi.fn(),
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({ set: mocks.loggerSet }),
}))

vi.mock('~~/server/utils/memory/rate-limit', () => ({
  enforceMemoryRateLimit: mocks.enforceMemoryRateLimit,
}))

vi.mock('evlog', () => ({
  createError: (input: { message?: string, status?: number }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
  log: { info: mocks.eventLog },
}))

type DeletedRows = [
  Array<{ id: number }>,
  Array<{ scopes: unknown }>,
  Array<{ scopes: unknown }>,
]

interface BuiltQuery {
  toSQL: () => { sql: string, params: unknown[] }
}

function createDb(results: DeletedRows[]) {
  const db = drizzle({} as never)
  const queue = [...results]
  const batch = vi.fn(async (_queries: BuiltQuery[]) => {
    return queue.shift() ?? [[], [], []]
  })

  Object.assign(db, { batch })

  return { db, batch }
}

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/profiles/connected-apps/revoke/bulk.post'
  )

  return module.default
}

function bulkEvent(body: unknown) {
  return { context: {}, body } as any
}

describe('connected apps bulk revoke API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('assertNotCrossSiteRequest', vi.fn())
    vi.stubGlobal(
      'readValidatedBody',
      async (event: { body: unknown }, parser: (body: unknown) => unknown) => {
        return parser(event.body)
      },
    )
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '5' },
      session: { token: 'session-token' },
    }))
  })

  it('returns 401 without a session', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))
    vi.stubGlobal('useDb', () => createDb([]).db)

    const handler = await getHandler()

    await expect(handler(bulkEvent({ clientIds: ['a'] })))
      .rejects.toMatchObject({ status: 401 })
  })

  it('rejects an empty list, a list over 20 and a non-list', async () => {
    vi.stubGlobal('useDb', () => createDb([]).db)

    const handler = await getHandler()
    const tooMany = Array.from({ length: 21 }, (_value, index) => {
      return `client-${index}`
    })

    await expect(handler(bulkEvent({ clientIds: [] })))
      .rejects.toMatchObject({ status: 400 })
    await expect(handler(bulkEvent({ clientIds: tooMany })))
      .rejects.toMatchObject({ status: 400 })
    await expect(handler(bulkEvent({ clientIds: 'client-1' })))
      .rejects.toMatchObject({ status: 400 })
    await expect(handler(bulkEvent({ clientIds: [''] })))
      .rejects.toMatchObject({ status: 400 })
  })

  it('revokes each client in its own batch, scoped to the user', async () => {
    const { db, batch } = createDb([
      [[{ id: 1 }], [{ scopes: ['openid'] }], [{ scopes: ['openid'] }]],
      [[], [], [{ scopes: JSON.stringify(['openid', 'chats:read']) }]],
    ])

    vi.stubGlobal('useDb', () => db)

    const handler = await getHandler()
    const response = await handler(bulkEvent({
      clientIds: ['client-1', 'client-2', 'client-1'],
    }))

    expect(response).toEqual({
      revokedClientIds: ['client-1', 'client-2'],
      notFoundClientIds: [],
    })
    expect(batch).toHaveBeenCalledTimes(2)
    expect(batch.mock.calls.map((call) => {
      return call[0].map((query) => {
        return query.toSQL().params
      })
    })).toEqual([
      [[5, 'client-1'], [5, 'client-1'], [5, 'client-1']],
      [[5, 'client-2'], [5, 'client-2'], [5, 'client-2']],
    ])
  })

  it('reports clients without a grant and keeps going', async () => {
    const { db } = createDb([
      [[], [], []],
      [[], [{ scopes: ['openid'] }], []],
    ])

    vi.stubGlobal('useDb', () => db)

    const handler = await getHandler()
    const response = await handler(bulkEvent({
      clientIds: ['gone', 'client-2'],
    }))

    expect(response).toEqual({
      revokedClientIds: ['client-2'],
      notFoundClientIds: ['gone'],
    })
  })

  it('logs one legal consent event per revoked client with parsed scopes',
    async () => {
      const { db } = createDb([
        [[], [], [{ scopes: JSON.stringify(JSON.stringify(['openid'])) }]],
        [[], [], [{ scopes: ['openid', 'memory:write'] }]],
      ])

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await handler(bulkEvent({ clientIds: ['client-1', 'client-2'] }))

      expect(mocks.eventLog).toHaveBeenCalledTimes(2)
      expect(mocks.eventLog).toHaveBeenCalledWith({
        action: 'oauth_revoked',
        userId: 5,
        attributes: {
          legalConsent: {
            action: 'oauth_revoked',
            oauthClientId: 'client-1',
            scopes: ['openid'],
          },
        },
      })
      expect(mocks.eventLog).toHaveBeenCalledWith({
        action: 'oauth_revoked',
        userId: 5,
        attributes: {
          legalConsent: {
            action: 'oauth_revoked',
            oauthClientId: 'client-2',
            scopes: ['openid', 'memory:write'],
          },
        },
      })
      expect(mocks.loggerSet).toHaveBeenCalledWith({
        userId: 5,
        attributes: {
          connectedApps: { bulkRevokeRequested: 2, bulkRevoked: 2 },
        },
      })
      expect(JSON.stringify(mocks.eventLog.mock.calls))
        .not.toContain('session-token')
    })

  it('stops at a failed delete and reports how far it got', async () => {
    const { db, batch } = createDb([
      [[{ id: 1 }], [], []],
    ])

    batch.mockResolvedValueOnce([[{ id: 1 }], [], []])
    batch.mockRejectedValueOnce(new Error('d1 unavailable'))
    vi.stubGlobal('useDb', () => db)

    const handler = await getHandler()

    await expect(handler(bulkEvent({
      clientIds: ['client-1', 'client-2', 'client-3'],
    }))).rejects.toMatchObject({
      status: 500,
      why: expect.stringContaining('1 of 3 apps were disconnected'),
    })
    expect(batch).toHaveBeenCalledTimes(2)
  })

  it('rate limits the bulk revoke per user', async () => {
    mocks.enforceMemoryRateLimit.mockRejectedValueOnce(
      Object.assign(new Error('Too many'), { status: 429 }),
    )
    vi.stubGlobal('useDb', () => createDb([]).db)

    const handler = await getHandler()

    await expect(handler(bulkEvent({ clientIds: ['client-1'] })))
      .rejects.toMatchObject({ status: 429 })
  })
})
