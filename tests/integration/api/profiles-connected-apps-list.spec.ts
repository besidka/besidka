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

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'client-1',
    name: 'Claude',
    uri: 'https://claude.ai',
    consentScopes: ['openid', 'chats:read'],
    consentCreatedAt: new Date('2026-10-01T00:00:00.000Z'),
    consentUpdatedAt: new Date('2026-10-02T00:00:00.000Z'),
    liveSince: null,
    liveScopes: null,
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

  it('lists clients with a consent or a live refresh token of the user',
    async () => {
      const { db, executed } = createDb([])

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await handler({} as any)

      const { sql, params } = executed[0]!.toSQL()

      expect(sql).toContain('from "oauth_clients"')
      expect(sql).toContain(
        'left join "oauth_consents" on (("oauth_consents"."client_id" = "oauth_clients"."client_id") and ("oauth_consents"."user_id" = ?))',
      )
      expect(sql).toContain('"oauth_refresh_tokens"."revoked" is null')
      expect(sql).toContain('"oauth_refresh_tokens"."expires_at" > ?')
      expect(sql).toContain(
        '(("oauth_consents"."id" is not null)) or (("live_grants"."client_id" is not null))',
      )
      expect(sql).toMatch(
        /max\("created_at"\) as "last_used_at" from "oauth_refresh_tokens"/,
      )
      expect(sql).not.toContain('"icon"')
      expect(params.filter((param) => {
        return param === 5
      })).toHaveLength(3)
      expect(params.at(-1)).toBe(100)
    })

  it('maps rows without exposing tokens or logos', async () => {
    const { db } = createDb([grantRow()])

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

  it('shows a live grant whose consent row is gone with its token scopes',
    async () => {
      const { db } = createDb([grantRow({
        consentScopes: null,
        consentCreatedAt: null,
        consentUpdatedAt: null,
        liveSince: 1761696000,
        liveScopes: ['openid', 'memory:read'],
      })])

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()
      const [row] = await handler({} as any) as Array<Record<string, unknown>>

      expect(row).toMatchObject({
        clientId: 'client-1',
        scopes: ['openid', 'memory:read'],
        createdAt: new Date(1761696000 * 1000),
        updatedAt: new Date(1761696000 * 1000),
      })
    })

  it('handles a missing name, malformed scopes and no activity', async () => {
    const { db } = createDb([grantRow({
      name: null,
      consentScopes: 'chats:read',
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
