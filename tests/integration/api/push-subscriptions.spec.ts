import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
    getContext: () => ({}),
  }),
  createError: (input: {
    status?: number
    message?: string
    why?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

function createDb(
  existing: { id: number, userId?: number } | null = null,
) {
  const insertValues = vi.fn(async () => undefined)
  const updateSet = vi.fn(() => ({ where: vi.fn(async () => undefined) }))
  const deleteWhere = vi.fn(async () => undefined)

  return {
    db: {
      query: {
        pushSubscriptions: {
          findFirst: vi.fn(async () => existing),
        },
      },
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: updateSet })),
      delete: vi.fn(() => ({ where: deleteWhere })),
    },
    insertValues,
    updateSet,
    deleteWhere,
  }
}

describe('push subscription API', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.loggerSet.mockClear()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('readValidatedBody', async (
      event: { body: unknown },
      parser: (body: unknown) => unknown,
    ) => {
      return parser(event.body)
    })
    vi.stubGlobal('setResponseStatus', vi.fn())
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '7' },
    }))
    vi.stubGlobal('useUnauthorizedError', vi.fn(() => {
      throw new Error('Unauthorized')
    }))
    vi.stubGlobal('isAllowedPushServiceEndpoint', vi.fn(() => true))
  })

  describe('subscribe', () => {
    async function getHandler() {
      const module = await import(
        '../../../server/api/v1/push/subscribe.post'
      )

      return module.default
    }

    it('inserts a new subscription for the current user', async () => {
      const { db, insertValues } = createDb(null)

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await handler({
        body: {
          endpoint: 'https://push.example.com/sub-1',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
        },
      } as any)

      expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
        userId: 7,
        endpoint: 'https://push.example.com/sub-1',
        p256dhKey: 'p256dh-key',
        authKey: 'auth-key',
      }))
      expect(mocks.loggerSet).toHaveBeenCalledWith(expect.objectContaining({
        push: expect.objectContaining({
          operation: 'subscribe',
          userId: 7,
        }),
      }))
    })

    it('re-associates an existing subscription endpoint with the current user', async () => {
      const { db, updateSet } = createDb({ id: 99, userId: 7 })

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await handler({
        body: {
          endpoint: 'https://push.example.com/sub-1',
          keys: { p256dh: 'new-p256dh', auth: 'new-auth' },
        },
      } as any)

      expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
        userId: 7,
        p256dhKey: 'new-p256dh',
        authKey: 'new-auth',
      }))
    })

    it('logs a reassignment when the endpoint belonged to a different user', async () => {
      const { db } = createDb({ id: 99, userId: 3 })

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await handler({
        body: {
          endpoint: 'https://push.example.com/sub-1',
          keys: { p256dh: 'new-p256dh', auth: 'new-auth' },
        },
      } as any)

      expect(mocks.loggerSet).toHaveBeenCalledWith(expect.objectContaining({
        push: expect.objectContaining({
          operation: 'reassign',
          fromUserId: 3,
          toUserId: 7,
        }),
      }))
    })

    it('logs a resubscribe, not a reassignment, for the same user', async () => {
      const { db } = createDb({ id: 99, userId: 7 })

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await handler({
        body: {
          endpoint: 'https://push.example.com/sub-1',
          keys: { p256dh: 'new-p256dh', auth: 'new-auth' },
        },
      } as any)

      expect(mocks.loggerSet).toHaveBeenCalledWith(expect.objectContaining({
        push: expect.objectContaining({
          operation: 'resubscribe',
          userId: 7,
        }),
      }))
      expect(mocks.loggerSet).not.toHaveBeenCalledWith(expect.objectContaining({
        push: expect.objectContaining({ operation: 'reassign' }),
      }))
    })

    it('rejects an invalid subscription body', async () => {
      const { db } = createDb(null)

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await expect(handler({
        body: { endpoint: 'not-a-url' },
      } as any)).rejects.toThrow('Invalid push subscription body')
    })

    it('rejects unauthenticated requests', async () => {
      vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

      const { db } = createDb(null)

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await expect(handler({
        body: {
          endpoint: 'https://push.example.com/sub-1',
          keys: { p256dh: 'a', auth: 'b' },
        },
      } as any)).rejects.toThrow('Unauthorized')
    })

    it('rejects an endpoint host outside the push service allowlist', async () => {
      vi.stubGlobal('isAllowedPushServiceEndpoint', vi.fn(() => false))

      const { db, insertValues } = createDb(null)

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await expect(handler({
        body: {
          endpoint: 'https://attacker.example.com/collect',
          keys: { p256dh: 'a', auth: 'b' },
        },
      } as any)).rejects.toThrow('Unrecognized push subscription endpoint')
      expect(insertValues).not.toHaveBeenCalled()
    })
  })

  describe('unsubscribe', () => {
    async function getHandler() {
      const module = await import(
        '../../../server/api/v1/push/unsubscribe.post'
      )

      return module.default
    }

    it('deletes the subscription scoped to the current user', async () => {
      const { db, deleteWhere } = createDb(null)

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await handler({
        body: { endpoint: 'https://push.example.com/sub-1' },
      } as any)

      expect(deleteWhere).toHaveBeenCalledTimes(1)
      expect(mocks.loggerSet).toHaveBeenCalledWith(expect.objectContaining({
        push: expect.objectContaining({
          operation: 'unsubscribe',
          userId: 7,
        }),
      }))
    })

    it('rejects an invalid unsubscribe body', async () => {
      const { db } = createDb(null)

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await expect(handler({
        body: {},
      } as any)).rejects.toThrow('Invalid unsubscribe body')
    })
  })
})
