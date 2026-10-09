import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNotCrossSiteRequest } from '~~/server/utils/cross-site-guard'
import { drizzle } from 'drizzle-orm/d1'
import type { SQL } from 'drizzle-orm'
import * as schema from '../../../server/db/schema'

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

const sqlBuilder = drizzle({} as any)

function renderCondition(condition: SQL) {
  return sqlBuilder.delete(schema.pushSubscriptions)
    .where(condition)
    .toSQL()
}

function createDb(
  existing: { id: number, userId?: number } | null = null,
  deletedRows: { id: number }[] = [],
) {
  const insertValues = vi.fn(async () => undefined)
  const updateSet = vi.fn(() => ({ where: vi.fn(async () => undefined) }))
  const returning = vi.fn(async () => deletedRows)
  const deleteWhere = vi.fn(() => ({ returning }))

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
    returning,
  }
}

describe('push subscription API', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.loggerSet.mockClear()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('assertNotCrossSiteRequest', assertNotCrossSiteRequest)
    vi.stubGlobal('getRequestHeader', (
      event: { headers?: Record<string, string> },
      key: string,
    ) => event.headers?.[key.toLowerCase()])
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

    it('stamps lastSeenAt on insert', async () => {
      const { db, insertValues } = createDb(null)

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()
      const before = Date.now()

      await handler({
        body: {
          endpoint: 'https://push.example.com/sub-1',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
        },
      } as any)

      const inserted = (insertValues.mock.calls[0] as unknown[])[0] as {
        lastSeenAt: Date
      }

      expect(inserted.lastSeenAt).toBeInstanceOf(Date)
      expect(inserted.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before)
    })

    it('stamps lastSeenAt on update of an existing endpoint', async () => {
      const { db, updateSet } = createDb({ id: 99, userId: 7 })

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()
      const before = Date.now()

      await handler({
        body: {
          endpoint: 'https://push.example.com/sub-1',
          keys: { p256dh: 'new-p256dh', auth: 'new-auth' },
        },
      } as any)

      const updated = (updateSet.mock.calls[0] as unknown[])[0] as {
        lastSeenAt: Date
      }

      expect(updated.lastSeenAt).toBeInstanceOf(Date)
      expect(updated.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before)
    })

    it('deletes the previous endpoint row scoped to the current user', async () => {
      const { db, deleteWhere, insertValues } = createDb(null, [{ id: 41 }])

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await handler({
        body: {
          endpoint: 'https://push.example.com/sub-2',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
          previousEndpoint: 'https://push.example.com/sub-1',
        },
      } as any)

      expect(insertValues).toHaveBeenCalledTimes(1)
      expect(deleteWhere).toHaveBeenCalledTimes(1)

      const rendered = renderCondition(
        (deleteWhere.mock.calls[0] as unknown[])[0] as SQL,
      )

      expect(rendered.sql).toContain('"endpoint"')
      expect(rendered.sql).toContain('"user_id"')
      expect(rendered.params).toEqual([
        'https://push.example.com/sub-1',
        7,
      ])
      expect(mocks.loggerSet).toHaveBeenCalledWith({
        attributes: { push: { previousEndpointRemoved: true } },
      })
    })

    it('never deletes another user row through previousEndpoint', async () => {
      const { db, deleteWhere } = createDb(null, [])

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await handler({
        body: {
          endpoint: 'https://push.example.com/sub-2',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
          previousEndpoint: 'https://push.example.com/other-users-sub',
        },
      } as any)

      const rendered = renderCondition(
        (deleteWhere.mock.calls[0] as unknown[])[0] as SQL,
      )

      expect(rendered.params).toEqual([
        'https://push.example.com/other-users-sub',
        7,
      ])
      expect(mocks.loggerSet).toHaveBeenCalledWith({
        attributes: { push: { previousEndpointRemoved: false } },
      })
    })

    it('skips deletion when previousEndpoint equals the endpoint', async () => {
      const { db, deleteWhere } = createDb(null)

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await handler({
        body: {
          endpoint: 'https://push.example.com/sub-1',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
          previousEndpoint: 'https://push.example.com/sub-1',
        },
      } as any)

      expect(deleteWhere).not.toHaveBeenCalled()
    })

    it('skips deletion when previousEndpoint is absent', async () => {
      const { db, deleteWhere } = createDb(null)

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await handler({
        body: {
          endpoint: 'https://push.example.com/sub-1',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
        },
      } as any)

      expect(deleteWhere).not.toHaveBeenCalled()
    })

    it('rejects a previousEndpoint that is not a url', async () => {
      const { db } = createDb(null)

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await expect(handler({
        body: {
          endpoint: 'https://push.example.com/sub-1',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
          previousEndpoint: 'not-a-url',
        },
      } as any)).rejects.toThrow('Invalid push subscription body')
    })

    it('rejects a previousEndpoint longer than 2048 chars', async () => {
      const { db } = createDb(null)

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()
      const longEndpoint = `https://push.example.com/${'a'.repeat(2050)}`

      await expect(handler({
        body: {
          endpoint: 'https://push.example.com/sub-1',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
          previousEndpoint: longEndpoint,
        },
      } as any)).rejects.toThrow('Invalid push subscription body')
    })

    it('captures the request origin server-side, not from client input', async () => {
      const { db, insertValues } = createDb(null)

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await handler({
        url: new URL(
          'https://pr-292.besidka-preview.chernenko.workers.dev'
          + '/api/v1/push/subscribe',
        ),
        body: {
          endpoint: 'https://push.example.com/sub-1',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
          origin: 'https://attacker.example.com',
        },
      } as any)

      expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
        origin: 'https://pr-292.besidka-preview.chernenko.workers.dev',
      }))
    })

    it('falls back to an undefined origin when the request URL cannot be derived', async () => {
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
        origin: undefined,
      }))
    })

    it('re-associates an existing subscription endpoint with the current user', async () => {
      const { db, updateSet } = createDb({ id: 99, userId: 7 })

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await handler({
        url: new URL('https://app.besidka.com/api/v1/push/subscribe'),
        body: {
          endpoint: 'https://push.example.com/sub-1',
          keys: { p256dh: 'new-p256dh', auth: 'new-auth' },
        },
      } as any)

      expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
        userId: 7,
        p256dhKey: 'new-p256dh',
        authKey: 'new-auth',
        origin: 'https://app.besidka.com',
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

    it('rejects cross-site requests without touching the database', async () => {
      const { db, insertValues, updateSet, deleteWhere } = createDb(null)

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await expect(handler({
        headers: { 'sec-fetch-site': 'cross-site' },
        body: {
          endpoint: 'https://push.example.com/sub-1',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
          previousEndpoint: 'https://push.example.com/sub-0',
        },
      } as any)).rejects.toMatchObject({ status: 403 })
      expect(insertValues).not.toHaveBeenCalled()
      expect(updateSet).not.toHaveBeenCalled()
      expect(deleteWhere).not.toHaveBeenCalled()
    })

    it('rejects cross-site requests before the session lookup', async () => {
      const { db } = createDb(null)
      const useUserSession = vi.fn().mockResolvedValue({ user: { id: '7' } })

      vi.stubGlobal('useUserSession', useUserSession)
      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await expect(handler({
        headers: { 'sec-fetch-site': 'cross-site' },
        body: {},
      } as any)).rejects.toMatchObject({ status: 403 })
      expect(useUserSession).not.toHaveBeenCalled()
    })

    it('accepts requests where sec-fetch-site is missing', async () => {
      const { db, insertValues } = createDb(null)

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await handler({
        headers: {},
        body: {
          endpoint: 'https://push.example.com/sub-1',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
        },
      } as any)

      expect(insertValues).toHaveBeenCalledTimes(1)
    })

    it('accepts same-origin requests', async () => {
      const { db, insertValues } = createDb(null)

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await handler({
        headers: { 'sec-fetch-site': 'same-origin' },
        body: {
          endpoint: 'https://push.example.com/sub-1',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
        },
      } as any)

      expect(insertValues).toHaveBeenCalledTimes(1)
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

    it('rejects cross-site requests without deleting anything', async () => {
      const { db, deleteWhere } = createDb(null)

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await expect(handler({
        headers: { 'sec-fetch-site': 'cross-site' },
        body: { endpoint: 'https://push.example.com/sub-1' },
      } as any)).rejects.toMatchObject({ status: 403 })
      expect(deleteWhere).not.toHaveBeenCalled()
    })

    it('rejects cross-site requests before the session lookup', async () => {
      const { db } = createDb(null)
      const useUserSession = vi.fn().mockResolvedValue({ user: { id: '7' } })

      vi.stubGlobal('useUserSession', useUserSession)
      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await expect(handler({
        headers: { 'sec-fetch-site': 'cross-site' },
        body: {},
      } as any)).rejects.toMatchObject({ status: 403 })
      expect(useUserSession).not.toHaveBeenCalled()
    })

    it('accepts requests where sec-fetch-site is missing', async () => {
      const { db, deleteWhere } = createDb(null)

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await handler({
        headers: {},
        body: { endpoint: 'https://push.example.com/sub-1' },
      } as any)

      expect(deleteWhere).toHaveBeenCalledTimes(1)
    })

    it('accepts same-origin requests', async () => {
      const { db, deleteWhere } = createDb(null)

      vi.stubGlobal('useDb', () => db)

      const handler = await getHandler()

      await handler({
        headers: { 'sec-fetch-site': 'same-origin' },
        body: { endpoint: 'https://push.example.com/sub-1' },
      } as any)

      expect(deleteWhere).toHaveBeenCalledTimes(1)
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
