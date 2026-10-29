import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'

interface BuiltQuery {
  toSQL: () => { sql: string, params: unknown[] }
}

function createDb(rows: Array<Record<string, unknown>>) {
  const db = drizzle({} as never)
  const executed: BuiltQuery[] = []
  const realSelect = db.select.bind(db)

  Object.assign(db, {
    select: (...args: Parameters<typeof realSelect>) => {
      const builder = realSelect(...args)
      const realFrom = builder.from.bind(builder)

      return Object.assign(builder, {
        from: (...fromArgs: Parameters<typeof realFrom>) => {
          const query = realFrom(...fromArgs)
          const realLimit = query.limit.bind(query)

          return Object.assign(query, {
            limit: (...limitArgs: Parameters<typeof realLimit>) => {
              const limited = realLimit(...limitArgs)

              executed.push(limited)

              return Promise.resolve(rows)
            },
          })
        },
      })
    },
  })

  return { db, executed }
}

function consentRow(overrides: Record<string, unknown> = {}) {
  return {
    consentId: 1,
    clientId: 'client-1',
    scopes: ['openid', 'chats:read'],
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-02T00:00:00.000Z'),
    name: 'Claude',
    uri: 'https://claude.ai',
    lastUsedAt: 1761696000,
    ...overrides,
  }
}

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/profiles/connected-apps/index.get'
  )

  return module.default
}

describe('connected apps list API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
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

    await expect(handler({} as any)).rejects.toMatchObject({ status: 401 })
  })

  it('scopes the consents and the last activity to the user', async () => {
    const { db, executed } = createDb([])

    vi.stubGlobal('useDb', () => db)

    const handler = await getHandler()

    await handler({} as any)

    const { sql, params } = executed[0]!.toSQL()

    expect(sql).toContain('from "oauth_consents"')
    expect(sql).toContain('inner join "oauth_clients"')
    expect(sql).toMatch(
      /max\("created_at"\) as "last_used_at" from "oauth_refresh_tokens"/,
    )
    expect(sql).toContain('left join')
    expect(sql).toMatch(/where "oauth_refresh_tokens"\."user_id" = \?/)
    expect(sql).toMatch(/where "oauth_consents"\."user_id" = \?/)
    expect(sql).not.toContain('"icon"')
    expect(params).toEqual([5, 5, 100])
  })

  it('maps rows without exposing tokens or logos', async () => {
    const { db } = createDb([consentRow()])

    vi.stubGlobal('useDb', () => db)

    const handler = await getHandler()
    const response = await handler({} as any)

    expect(response).toEqual([{
      clientId: 'client-1',
      name: 'Claude',
      uri: 'https://claude.ai',
      scopes: ['openid', 'chats:read'],
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      updatedAt: new Date('2026-10-02T00:00:00.000Z'),
      lastUsedAt: new Date(1761696000 * 1000),
    }])
  })

  it('handles a missing name, malformed scopes and no activity', async () => {
    const { db } = createDb([consentRow({
      name: null,
      scopes: 'chats:read',
      lastUsedAt: null,
    })])

    vi.stubGlobal('useDb', () => db)

    const handler = await getHandler()
    const [row] = await handler({} as any) as Array<Record<string, unknown>>

    expect(row).toMatchObject({
      name: 'Unnamed app',
      scopes: [],
      lastUsedAt: null,
    })
  })
})
