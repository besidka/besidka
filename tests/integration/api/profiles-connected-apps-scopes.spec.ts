import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'
import { SCOPE_ADDITION_REFUSAL } from '~~/server/utils/oauth/narrow-consent-scopes'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
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
}))

interface BuiltQuery {
  toSQL: () => { sql: string, params: unknown[] }
}

interface ExecutedUpdate {
  values: Record<string, unknown>
  query: BuiltQuery
}

const FULL_CONSENT = [
  'openid',
  'profile',
  'offline_access',
  'chats:read',
  'chats:write',
  'memory:read',
  'data:delete',
]

const READ_UPDATED_AT = new Date('2026-10-30T10:00:00.000Z')

function createDb(
  consents: Array<{ id: number, scopes: unknown, updatedAt?: Date }>,
  options: { updatedRows?: Array<Array<{ id: number }>> } = {},
) {
  const updatedRows = [...(options.updatedRows ?? [])]
  const db = drizzle({} as never)
  const updates: ExecutedUpdate[] = []
  const realUpdate = db.update.bind(db)

  Object.assign(db, {
    select: () => ({
      from: () => ({
        where: async () => consents.map((consent) => {
          return { updatedAt: READ_UPDATED_AT, ...consent }
        }),
      }),
    }),
    update: (table: Parameters<typeof realUpdate>[0]) => {
      const builder = realUpdate(table)
      const realSet = builder.set.bind(builder)

      return {
        set: (values: Parameters<typeof realSet>[0]) => {
          const setBuilder = realSet(values)
          const realWhere = setBuilder.where.bind(setBuilder)

          return {
            where: (condition: Parameters<typeof realWhere>[0]) => {
              const query = realWhere(condition)

              updates.push({
                values: values as Record<string, unknown>,
                query: query as unknown as BuiltQuery,
              })

              return {
                returning: async () => {
                  return updatedRows.shift() ?? [{ id: 9 }]
                },
              }
            },
          }
        },
      }
    },
  })

  return { db, updates }
}

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/profiles/connected-apps/[clientId]/scopes.patch'
  )

  return module.default
}

function patchEvent(clientId: string, body: unknown) {
  return { context: {}, params: { clientId }, body } as any
}

describe('connected apps scopes API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('assertNotCrossSiteRequest', vi.fn())
    vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
      return event.params
    })
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

    await expect(handler(patchEvent('client-1', { scopes: [] })))
      .rejects.toMatchObject({ status: 401 })
  })

  it('rejects a body that is not a scope list', async () => {
    vi.stubGlobal('useDb', () => createDb([]).db)

    const handler = await getHandler()

    await expect(handler(patchEvent('client-1', { scopes: 'chats:read' })))
      .rejects.toMatchObject({ status: 400 })
    await expect(handler(patchEvent('client-1', {})))
      .rejects.toMatchObject({ status: 400 })
  })

  it('rate limits the narrowing per user', async () => {
    mocks.enforceMemoryRateLimit.mockRejectedValueOnce(
      Object.assign(new Error('Too many'), { status: 429 }),
    )
    vi.stubGlobal('useDb', () => createDb([]).db)

    const handler = await getHandler()

    await expect(handler(patchEvent('client-1', { scopes: [] })))
      .rejects.toMatchObject({ status: 429 })
    expect(mocks.enforceMemoryRateLimit)
      .toHaveBeenCalledWith('legal-consent', 5, expect.anything())
  })

  it('returns 404 when the user has no consent for the app', async () => {
    vi.stubGlobal('useDb', () => createDb([]).db)

    const handler = await getHandler()

    await expect(handler(patchEvent('client-1', { scopes: [] })))
      .rejects.toMatchObject({ status: 404 })
  })

  it('removes the scopes that are not kept and writes a real array',
    async () => {
      const { db, updates } = createDb([{
        id: 9,
        scopes: JSON.stringify(JSON.stringify(FULL_CONSENT)),
      }])

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()
      const response = await handler(patchEvent('client-1', {
        scopes: ['chats:read', 'memory:read'],
      }))

      expect(response).toEqual({
        clientId: 'client-1',
        scopes: [
          'openid',
          'profile',
          'offline_access',
          'chats:read',
          'memory:read',
        ],
      })
      expect(updates).toHaveLength(1)
      expect(Array.isArray(updates[0]!.values.scopes)).toBe(true)
      expect(updates[0]!.values.scopes).toEqual([
        'openid',
        'profile',
        'offline_access',
        'chats:read',
        'memory:read',
      ])

      const { sql, params } = updates[0]!.query.toSQL()

      expect(sql).toContain('update "oauth_consents"')
      expect(sql).toContain('"id" = ?')
      expect(sql).toContain('"user_id" = ?')
      expect(sql).toContain('"updated_at" = ?')
      expect(params).toContain(9)
      expect(params).toContain(5)
      expect(params).toContain(READ_UPDATED_AT.getTime() / 1000)
      expect(mocks.loggerSet).toHaveBeenCalledWith({
        userId: 5,
        attributes: {
          legalConsent: {
            action: 'oauth_scopes_narrowed',
            oauthClientId: 'client-1',
            scopes: [
              'openid',
              'profile',
              'offline_access',
              'chats:read',
              'memory:read',
            ],
            removedScopes: ['chats:write', 'data:delete'],
          },
        },
      })
    })

  it('ignores identity scopes in the request and always keeps them',
    async () => {
      const { db, updates } = createDb([{ id: 9, scopes: FULL_CONSENT }])

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()
      const response = await handler(patchEvent('client-1', {
        scopes: ['openid', 'chats:read'],
      }))

      expect(response).toEqual({
        clientId: 'client-1',
        scopes: ['openid', 'profile', 'offline_access', 'chats:read'],
      })
      expect(updates).toHaveLength(1)
    })

  it('allows removing every resource scope while identity scopes stay',
    async () => {
      const { db, updates } = createDb([{ id: 9, scopes: FULL_CONSENT }])

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()
      const response = await handler(patchEvent('client-1', { scopes: [] }))

      expect(response).toEqual({
        clientId: 'client-1',
        scopes: ['openid', 'profile', 'offline_access'],
      })
      expect(updates[0]!.values.scopes).toEqual([
        'openid',
        'profile',
        'offline_access',
      ])
    })

  it('refuses to add a scope the consent does not hold', async () => {
    const { db, updates } = createDb([{
      id: 9,
      scopes: ['openid', 'chats:read'],
    }])

    vi.stubGlobal('useDb', () => db)

    const handler = await getHandler()

    await expect(handler(patchEvent('client-1', {
      scopes: ['chats:read', 'memory:write'],
    }))).rejects.toMatchObject({
      status: 400,
      message: SCOPE_ADDITION_REFUSAL,
    })
    expect(updates).toHaveLength(0)
  })

  it('refuses a scope Besidka does not define', async () => {
    const { db, updates } = createDb([{ id: 9, scopes: FULL_CONSENT }])

    vi.stubGlobal('useDb', () => db)

    const handler = await getHandler()

    await expect(handler(patchEvent('client-1', { scopes: ['admin'] })))
      .rejects.toMatchObject({ status: 400, message: 'Unknown permission' })
    expect(updates).toHaveLength(0)
  })

  it('refuses a request that would leave no scope at all', async () => {
    const { db, updates } = createDb([{
      id: 9,
      scopes: ['chats:read', 'memory:read'],
    }])

    vi.stubGlobal('useDb', () => db)

    const handler = await getHandler()

    await expect(handler(patchEvent('client-1', { scopes: [] })))
      .rejects.toMatchObject({ status: 400 })
    expect(updates).toHaveLength(0)
  })

  it('does not write or log when nothing is removed', async () => {
    const { db, updates } = createDb([{ id: 9, scopes: FULL_CONSENT }])

    vi.stubGlobal('useDb', () => db)

    const handler = await getHandler()
    const response = await handler(patchEvent('client-1', {
      scopes: ['chats:read', 'chats:write', 'memory:read', 'data:delete'],
    }))

    expect(response).toMatchObject({ clientId: 'client-1' })
    expect(updates).toHaveLength(0)
    expect(mocks.loggerSet).not.toHaveBeenCalled()
  })

  it('answers 409 and logs nothing when the approval changed after the read',
    async () => {
      const { db, updates } = createDb(
        [{ id: 9, scopes: FULL_CONSENT }],
        { updatedRows: [[]] },
      )

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await expect(handler(patchEvent('client-1', { scopes: [] })))
        .rejects.toMatchObject({
          status: 409,
          message:
            'These permissions changed in the meantime. Reload and try again.',
        })
      expect(updates).toHaveLength(1)
      expect(mocks.loggerSet).not.toHaveBeenCalled()
    })

  it('stops at the first approval that changed in the meantime', async () => {
    const { db, updates } = createDb(
      [
        { id: 9, scopes: FULL_CONSENT },
        { id: 10, scopes: FULL_CONSENT },
      ],
      { updatedRows: [[]] },
    )

    vi.stubGlobal('useDb', () => db)

    const handler = await getHandler()

    await expect(handler(patchEvent('client-1', { scopes: [] })))
      .rejects.toMatchObject({ status: 409 })
    expect(updates).toHaveLength(1)
  })

  it('surfaces a failed write as a 500', async () => {
    const { db } = createDb([{ id: 9, scopes: FULL_CONSENT }])

    Object.assign(db, {
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => {
              throw new Error('d1 unavailable')
            },
          }),
        }),
      }),
    })
    vi.stubGlobal('useDb', () => db)

    const handler = await getHandler()

    await expect(handler(patchEvent('client-1', { scopes: [] })))
      .rejects.toMatchObject({ status: 500 })
  })
})
