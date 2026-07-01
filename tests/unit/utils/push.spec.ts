import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildPushPayload: vi.fn(async () => ({
    headers: { authorization: 'vapid t=...' },
    method: 'POST',
    body: new Uint8Array([1, 2, 3]),
  })),
}))

vi.mock('@block65/webcrypto-web-push', () => ({
  buildPushPayload: mocks.buildPushPayload,
}))

const configuredVapid = {
  subject: 'mailto:test@example.com' as string | undefined,
  publicKey: 'public-key' as string | undefined,
  privateKey: 'private-key' as string | undefined,
}

const unconfiguredVapid = {
  subject: undefined as string | undefined,
  publicKey: undefined as string | undefined,
  privateKey: undefined as string | undefined,
}

function createSubscription(overrides: Partial<{
  id: number
  endpoint: string
  p256dhKey: string
  authKey: string
}> = {}) {
  return {
    id: 1,
    endpoint: 'https://fcm.googleapis.com/fcm/send/sub-1',
    p256dhKey: 'p256dh-key',
    authKey: 'auth-key',
    ...overrides,
  }
}

function createDb(subscriptions: ReturnType<typeof createSubscription>[]) {
  const deleteWhere = vi.fn(async () => undefined)
  const remove = vi.fn(() => ({ where: deleteWhere }))

  return {
    db: {
      query: {
        pushSubscriptions: {
          findMany: vi.fn(async () => subscriptions),
        },
      },
      delete: remove,
    },
    deleteWhere,
    remove,
  }
}

function createLogger() {
  return { set: vi.fn() }
}

async function importPushUtils() {
  return import('../../../server/utils/push')
}

describe('push utils', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mocks.buildPushPayload.mockClear()
    fetchMock = vi.fn(async () => new Response(null, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports unconfigured when either VAPID key is missing', async () => {
    const { isPushConfigured } = await importPushUtils()

    expect(isPushConfigured(unconfiguredVapid)).toBe(false)
    expect(isPushConfigured(configuredVapid)).toBe(true)
  })

  it('recognizes known push service endpoint hosts', async () => {
    const { isAllowedPushServiceEndpoint } = await importPushUtils()

    expect(isAllowedPushServiceEndpoint(
      'https://fcm.googleapis.com/fcm/send/abc',
    )).toBe(true)
    expect(isAllowedPushServiceEndpoint(
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
    )).toBe(true)
    expect(isAllowedPushServiceEndpoint(
      'https://web.push.apple.com/abc',
    )).toBe(true)
  })

  it('rejects an endpoint host that is not a known push service', async () => {
    const { isAllowedPushServiceEndpoint } = await importPushUtils()

    expect(isAllowedPushServiceEndpoint(
      'https://attacker.example.com/collect',
    )).toBe(false)
    expect(isAllowedPushServiceEndpoint('not-a-url')).toBe(false)
  })

  it('skips and logs a subscription whose endpoint is not allowlisted', async () => {
    const { sendPushNotificationToUser } = await importPushUtils()
    const subscription = createSubscription({
      endpoint: 'https://attacker.example.com/collect',
    })
    const { db, remove } = createDb([subscription])
    const logger = createLogger()

    await sendPushNotificationToUser(
      db as any,
      1,
      { title: 't', body: 'b', url: '/chats/1' },
      configuredVapid,
      logger,
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
      push: expect.objectContaining({
        error: 'endpoint host not in the push service allowlist',
      }),
    }))
  })

  it('does nothing when VAPID keys are not configured', async () => {
    const { sendPushNotificationToUser } = await importPushUtils()
    const { db } = createDb([createSubscription()])

    await sendPushNotificationToUser(
      db as any,
      1,
      { title: 't', body: 'b', url: '/chats/1' },
      unconfiguredVapid,
      createLogger(),
    )

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing when the user has no subscriptions', async () => {
    const { sendPushNotificationToUser } = await importPushUtils()
    const { db } = createDb([])

    await sendPushNotificationToUser(
      db as any,
      1,
      { title: 't', body: 'b', url: '/chats/1' },
      configuredVapid,
      createLogger(),
    )

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends to every subscription sequentially', async () => {
    const { sendPushNotificationToUser } = await importPushUtils()
    const subscriptions = [
      createSubscription({
        id: 1,
        endpoint: 'https://fcm.googleapis.com/fcm/send/a',
      }),
      createSubscription({
        id: 2,
        endpoint: 'https://fcm.googleapis.com/fcm/send/b',
      }),
    ]
    const { db } = createDb(subscriptions)

    await sendPushNotificationToUser(
      db as any,
      1,
      { title: 'Your response is ready', body: 'b', url: '/chats/1' },
      configuredVapid,
      createLogger(),
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://fcm.googleapis.com/fcm/send/a',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://fcm.googleapis.com/fcm/send/b',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('deletes the subscription when the push service reports it gone (410)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 410 }))

    const { sendPushNotificationToUser } = await importPushUtils()
    const subscription = createSubscription({ id: 42 })
    const { db, remove, deleteWhere } = createDb([subscription])

    await sendPushNotificationToUser(
      db as any,
      1,
      { title: 't', body: 'b', url: '/chats/1' },
      configuredVapid,
      createLogger(),
    )

    expect(remove).toHaveBeenCalledTimes(1)
    expect(deleteWhere).toHaveBeenCalledTimes(1)
  })

  it('deletes the subscription when the push service reports it missing (404)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }))

    const { sendPushNotificationToUser } = await importPushUtils()
    const { db, remove } = createDb([createSubscription()])

    await sendPushNotificationToUser(
      db as any,
      1,
      { title: 't', body: 'b', url: '/chats/1' },
      configuredVapid,
      createLogger(),
    )

    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('logs without throwing when the push send fails for another reason', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }))

    const { sendPushNotificationToUser } = await importPushUtils()
    const { db, remove } = createDb([createSubscription()])
    const logger = createLogger()

    await sendPushNotificationToUser(
      db as any,
      1,
      { title: 't', body: 'b', url: '/chats/1' },
      configuredVapid,
      logger,
    )

    expect(remove).not.toHaveBeenCalled()
    expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
      push: expect.objectContaining({ status: 500 }),
    }))
  })

  it('logs without throwing when fetch itself rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    const { sendPushNotificationToUser } = await importPushUtils()
    const { db } = createDb([createSubscription()])
    const logger = createLogger()

    await expect(sendPushNotificationToUser(
      db as any,
      1,
      { title: 't', body: 'b', url: '/chats/1' },
      configuredVapid,
      logger,
    )).resolves.toBeUndefined()

    expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
      push: expect.objectContaining({ error: 'network down' }),
    }))
  })
})
