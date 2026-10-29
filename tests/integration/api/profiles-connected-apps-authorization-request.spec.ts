import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyOAuthQueryParams: vi.fn(async () => true),
  clientRows: [] as Array<Record<string, unknown>>,
}))

vi.mock('@better-auth/oauth-provider', () => ({
  verifyOAuthQueryParams: mocks.verifyOAuthQueryParams,
}))

vi.mock('evlog', () => ({
  createError: (input: { message?: string, status?: number }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

const SECRET = 'auth-secret'
const FUTURE_EXP = 4102444800

function signedQuery(overrides: Record<string, string> = {}): string {
  return new URLSearchParams({
    client_id: 'client-1',
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    scope: 'openid offline_access chats:read memory:write',
    exp: String(FUTURE_EXP),
    sig: 'signature',
    ...overrides,
  }).toString()
}

function clientRow(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'client-1',
    name: 'Claude',
    uri: 'https://claude.ai',
    disabled: false,
    scopes: ['openid', 'chats:read'],
    ...overrides,
  }
}

function createDb() {
  const selectedColumns: Array<Record<string, unknown>> = []
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(async () => mocks.clientRows),
  }

  return {
    selectedColumns,
    db: {
      select: vi.fn((columns: Record<string, unknown>) => {
        selectedColumns.push(columns)

        return chain
      }),
    },
  }
}

function event(oauthQuery?: string) {
  return {
    context: {},
    query: oauthQuery === undefined ? {} : { oauth_query: oauthQuery },
  } as any
}

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/profiles/connected-apps/authorization-request.get'
  )

  return module.default
}

describe('connected apps authorization request API', () => {
  let database: ReturnType<typeof createDb>

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.verifyOAuthQueryParams.mockResolvedValue(true)
    mocks.clientRows = [clientRow()]
    database = createDb()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getValidatedQuery', async (
      input: { query: unknown },
      validate: (value: unknown) => unknown,
    ) => {
      return validate(input.query)
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '5' },
      session: { token: 'session-token' },
    }))
    vi.stubGlobal('useServerAuth', () => ({
      $context: Promise.resolve({ secret: SECRET }),
    }))
    vi.stubGlobal('useDb', () => database.db)
  })

  it('returns 401 without a session', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    const handler = await getHandler()

    await expect(handler(event(signedQuery())))
      .rejects.toMatchObject({ status: 401 })
  })

  it('rejects a missing oauth_query with 400', async () => {
    const handler = await getHandler()

    await expect(handler(event()))
      .rejects.toMatchObject({ status: 400 })
    expect(mocks.verifyOAuthQueryParams).not.toHaveBeenCalled()
  })

  it('verifies the signature with the live auth secret', async () => {
    const handler = await getHandler()
    const query = signedQuery()

    await handler(event(query))

    expect(mocks.verifyOAuthQueryParams)
      .toHaveBeenCalledExactlyOnceWith(query, SECRET)
  })

  it('rejects a query whose signature fails verification', async () => {
    mocks.verifyOAuthQueryParams.mockResolvedValueOnce(false)

    const handler = await getHandler()

    await expect(handler(event(signedQuery())))
      .rejects.toMatchObject({
        status: 400,
        message: 'This connection request is invalid or has expired',
      })
    expect(database.db.select).not.toHaveBeenCalled()
  })

  it('rejects an unknown client', async () => {
    mocks.clientRows = []

    const handler = await getHandler()

    await expect(handler(event(signedQuery())))
      .rejects.toMatchObject({ status: 400 })
  })

  it('rejects a disabled client', async () => {
    mocks.clientRows = [clientRow({ disabled: true })]

    const handler = await getHandler()

    await expect(handler(event(signedQuery())))
      .rejects.toMatchObject({ status: 400 })
  })

  it('returns the client, redirect host, requested scopes and expiry',
    async () => {
      const handler = await getHandler()
      const response = await handler(event(signedQuery()))

      expect(response).toEqual({
        client: {
          clientId: 'client-1',
          name: 'Claude',
          uri: 'https://claude.ai/',
        },
        redirectHost: 'claude.ai',
        scopes: ['openid', 'offline_access', 'chats:read', 'memory:write'],
        expiresAt: new Date(FUTURE_EXP * 1000).toISOString(),
      })
    })

  it('never reads or returns the client logo', async () => {
    const handler = await getHandler()
    const response = await handler(event(signedQuery())) as {
      client: Record<string, unknown>
    }

    expect(Object.keys(database.selectedColumns[0]!)).not.toContain('icon')
    expect(response.client).not.toHaveProperty('icon')
  })

  it('drops a non-https homepage', async () => {
    mocks.clientRows = [clientRow({ uri: 'javascript:alert(1)' })]

    const handler = await getHandler()
    const response = await handler(event(signedQuery())) as {
      client: { uri: string | null }
    }

    expect(response.client.uri).toBeNull()
  })

  it('falls back to the client scopes when the request names none',
    async () => {
      const handler = await getHandler()
      const query = new URLSearchParams(signedQuery())

      query.delete('scope')

      const response = await handler(event(query.toString())) as {
        scopes: string[]
      }

      expect(response.scopes).toEqual(['openid', 'chats:read'])
    })

  it('labels an unnamed client and a loopback redirect host', async () => {
    mocks.clientRows = [clientRow({ name: null })]

    const handler = await getHandler()
    const response = await handler(event(signedQuery({
      redirect_uri: 'http://127.0.0.1:33418/callback',
    }))) as { client: { name: string }, redirectHost: string }

    expect(response.client.name).toBe('Unnamed app')
    expect(response.redirectHost).toBe('127.0.0.1:33418')
  })
})
