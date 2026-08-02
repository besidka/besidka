import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  revokeSession: vi.fn().mockResolvedValue({ status: true }),
}))

// Walks a drizzle `SQL` expression's `queryChunks` tree collecting column
// names and literal/param values as plain tokens. Two independently built
// `and(eq(...), gt(...))` trees are not `toEqual`-comparable (drizzle's SQL
// nodes carry internal state that differs between instances), so structural
// token collection is used instead to assert the where-clause targets the
// right columns/values.
function collectSqlTokens(
  node: unknown,
  visited: Set<unknown> = new Set(),
): string[] {
  if (node === null || node === undefined || typeof node !== 'object') {
    return node === null || node === undefined ? [] : [String(node)]
  }

  if (visited.has(node)) {
    return []
  }

  visited.add(node)

  if (Array.isArray(node)) {
    return node.flatMap(item => collectSqlTokens(item, visited))
  }

  const record = node as Record<string, unknown>

  if (Array.isArray(record.queryChunks)) {
    return record.queryChunks.flatMap((chunk) => {
      return collectSqlTokens(chunk, visited)
    })
  }

  if (Array.isArray(record.value)) {
    return record.value.map(String)
  }

  if (typeof record.name === 'string') {
    return [record.name]
  }

  if ('value' in record) {
    return [String(record.value)]
  }

  return []
}

function renderWhereTokens(whereArg: unknown): string {
  return collectSqlTokens(whereArg).join(' ')
}

vi.mock('evlog', () => ({
  createError: (input: {
    message?: string
    status?: number
    why?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

interface SessionRow {
  id: number
  userId: number
  token: string
  createdAt: Date
  updatedAt: Date
  expiresAt: Date
  ipAddress: string | null
  userAgent: string | null
}

function createSessionRow(overrides: Partial<SessionRow>): SessionRow {
  return {
    id: 1,
    userId: 1,
    token: 'token-1',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-20T00:00:00.000Z'),
    expiresAt: new Date('2026-08-10T00:00:00.000Z'),
    ipAddress: '203.0.113.10',
    userAgent: 'Mozilla/5.0 (Macintosh) Chrome/120 Safari/537.36',
    ...overrides,
  }
}

async function getSessionsHandler() {
  const module = await import('../../../server/api/v1/profiles/sessions/index.get')

  return module.default
}

async function getRevokeHandler() {
  const module = await import(
    '../../../server/api/v1/profiles/sessions/[id]/revoke.post'
  )

  return module.default
}

describe('profile sessions API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'))

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('createError', (input: {
      statusCode?: number
      statusMessage?: string
      data?: unknown
    }) => {
      const exception = new Error(input.statusMessage || 'Error')

      Object.assign(exception, input)

      return exception
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw (globalThis as any).createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
      })
    })
    vi.stubGlobal('getValidatedRouterParams', async (
      event: { params: unknown },
      parser: (params: unknown) => unknown,
    ) => {
      return parser(event.params)
    })
    vi.stubGlobal('getHeaders', vi.fn(() => ({ cookie: 'session=abc' })))
    vi.stubGlobal('setResponseStatus', (
      _event: unknown,
      code: number,
      message: string,
    ) => {
      return { code, message }
    })
    vi.stubGlobal('useServerAuth', vi.fn(() => ({
      api: {
        revokeSession: mocks.revokeSession,
      },
    })))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 401 for an unauthenticated caller', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))
    vi.stubGlobal('useDb', () => ({}))

    const getHandler = await getSessionsHandler()
    const revokeHandler = await getRevokeHandler()

    await expect(getHandler({} as any)).rejects.toMatchObject({
      statusCode: 401,
    })
    await expect(revokeHandler({
      params: { id: '1' },
    } as any)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('marks the caller\'s own session as current and never leaks a token',
    async () => {
      vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
        user: { id: '1' },
        session: { token: 'current-token' },
      }))

      const currentRow = createSessionRow({ id: 1, token: 'current-token' })
      const otherRow = createSessionRow({
        id: 2,
        token: 'other-token',
        ipAddress: '198.51.100.20',
        userAgent: 'Mozilla/5.0 (iPhone) Safari/604.1',
      })

      const where = vi.fn()
      const orderBy = vi.fn().mockResolvedValue([currentRow, otherRow])
      const selectChain = {
        from: vi.fn(() => selectChain),
        where: vi.fn((condition: unknown) => {
          where(condition)

          return selectChain
        }),
        orderBy,
      }

      vi.stubGlobal('useDb', () => ({
        select: vi.fn(() => selectChain),
      }))

      const handler = await getSessionsHandler()
      const response = await handler({} as any) as Record<string, unknown>[]

      expect(response).toHaveLength(2)
      expect(response[0]).toMatchObject({ id: 1, current: true })
      expect(response[1]).toMatchObject({ id: 2, current: false })

      for (const row of response) {
        expect('token' in row).toBe(false)
      }

      const renderedWhere = renderWhereTokens(where.mock.calls[0]?.[0])

      expect(renderedWhere).toMatch(/user_id\s+=\s+1\b/)
      expect(renderedWhere).toMatch(/expires_at\s+>\s+\S/)
    })

  it('does not return expired sessions', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
      session: { token: 'current-token' },
    }))

    const activeRow = createSessionRow({ id: 1, token: 'current-token' })

    const orderBy = vi.fn().mockResolvedValue([activeRow])
    const selectChain = {
      from: vi.fn(() => selectChain),
      where: vi.fn(() => selectChain),
      orderBy,
    }

    vi.stubGlobal('useDb', () => ({
      select: vi.fn(() => selectChain),
    }))

    const handler = await getSessionsHandler()
    const response = await handler({} as any) as Record<string, unknown>[]

    expect(response).toHaveLength(1)
    expect(response[0]).toMatchObject({ id: 1 })
  })

  it('returns 400 for an invalid session id', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
      session: { token: 'current-token' },
    }))
    vi.stubGlobal('useDb', () => ({
      query: { sessions: { findFirst: vi.fn() } },
    }))

    const handler = await getRevokeHandler()

    await expect(handler({
      params: { id: 'not-a-number' },
    } as any)).rejects.toMatchObject({ status: 400 })

    expect(mocks.revokeSession).not.toHaveBeenCalled()
  })

  it('returns not-found and never calls revokeSession for another '
    + 'user\'s session', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
      session: { token: 'current-token' },
    }))

    const findFirst = vi.fn().mockResolvedValue(undefined)

    vi.stubGlobal('useDb', () => ({
      query: { sessions: { findFirst } },
    }))

    const handler = await getRevokeHandler()

    await expect(handler({
      params: { id: '99' },
    } as any)).rejects.toMatchObject({ status: 404 })

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 99, userId: 1 },
      columns: { token: true },
    })
    expect(mocks.revokeSession).not.toHaveBeenCalled()
  })

  it('revokes the session through Better Auth\'s own API rather than a '
    + 'direct database delete', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
      session: { token: 'current-token' },
    }))

    const findFirst = vi.fn().mockResolvedValue({ token: 'target-token' })
    const dbDelete = vi.fn()

    vi.stubGlobal('useDb', () => ({
      query: { sessions: { findFirst } },
      delete: dbDelete,
    }))

    const handler = await getRevokeHandler()

    await handler({
      params: { id: '2' },
    } as any)

    expect(mocks.revokeSession).toHaveBeenCalledWith(expect.objectContaining({
      body: { token: 'target-token' },
    }))
    expect(dbDelete).not.toHaveBeenCalled()
  })
})
