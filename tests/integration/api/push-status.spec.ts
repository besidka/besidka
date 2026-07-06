import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
  }),
}))

async function getHandler() {
  const module = await import('../../../server/api/v1/push/status.get')

  return module.default
}

function createDb(overrides: {
  subscriptions?: { id: string }[]
} = {}) {
  return {
    query: {
      pushSubscriptions: {
        findMany: vi.fn(async () => {
          return overrides.subscriptions ?? [{ id: 'subscription-1' }]
        }),
      },
    },
  }
}

describe('push status API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
    vi.stubGlobal('useUnauthorizedError', vi.fn(() => {
      throw new Error('Unauthorized')
    }))
  })

  it('returns subscribed true when subscriptions exist', async () => {
    const handler = await getHandler()
    const db = createDb()

    vi.stubGlobal('useDb', () => db)

    const response = await handler({} as never)

    expect(response).toEqual({ subscribed: true })
    expect(db.query.pushSubscriptions.findMany).toHaveBeenCalledWith({
      where: { userId: 1 },
      columns: { id: true },
    })
  })

  it('returns subscribed false when there are no subscriptions', async () => {
    const handler = await getHandler()
    const db = createDb({ subscriptions: [] })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({} as never)

    expect(response).toEqual({ subscribed: false })
  })

  it('rejects unauthenticated requests', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    const handler = await getHandler()
    const db = createDb()

    vi.stubGlobal('useDb', () => db)

    await expect(handler({} as never)).rejects.toThrow('Unauthorized')
    expect(db.query.pushSubscriptions.findMany).not.toHaveBeenCalled()
  })
})
