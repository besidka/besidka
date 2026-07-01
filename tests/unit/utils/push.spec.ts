import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildPushPayload: vi.fn(async () => ({
    headers: { authorization: 'vapid t=...' },
    method: 'POST',
    body: new Uint8Array([1, 2, 3]),
  })),
  loggerSet: vi.fn(),
  loggerEmit: vi.fn(() => ({ message: 'Push notification send completed' })),
  createRequestLogger: vi.fn(),
  shipWideEventToAxiom: vi.fn(async () => undefined),
}))

vi.mock('@block65/webcrypto-web-push', () => ({
  buildPushPayload: mocks.buildPushPayload,
}))

vi.mock('evlog', () => ({
  createRequestLogger: mocks.createRequestLogger,
}))

vi.mock('../../../server/utils/evlog-drains', () => ({
  shipWideEventToAxiom: mocks.shipWideEventToAxiom,
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

async function importPushUtils() {
  return import('../../../server/utils/push')
}

describe('push utils', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let waitUntilMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mocks.buildPushPayload.mockClear()
    mocks.loggerSet.mockClear()
    mocks.loggerEmit.mockClear()
    mocks.shipWideEventToAxiom.mockClear()
    mocks.createRequestLogger.mockClear()
    mocks.createRequestLogger.mockReturnValue({
      set: mocks.loggerSet,
      emit: mocks.loggerEmit,
    })
    fetchMock = vi.fn(async () => new Response(null, { status: 201 }))
    waitUntilMock = vi.fn()
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

  it('prepends mailto: to a bare VAPID subject address', async () => {
    const { buildVapidSubject } = await importPushUtils()

    expect(buildVapidSubject('abuse@besidka.com'))
      .toBe('mailto:abuse@besidka.com')
  })

  it('leaves an already-prefixed VAPID subject untouched', async () => {
    const { buildVapidSubject } = await importPushUtils()

    expect(buildVapidSubject('mailto:abuse@besidka.com'))
      .toBe('mailto:abuse@besidka.com')
    expect(buildVapidSubject('https://besidka.com/contact'))
      .toBe('https://besidka.com/contact')
  })

  it('returns undefined for an empty VAPID subject', async () => {
    const { buildVapidSubject } = await importPushUtils()

    expect(buildVapidSubject('')).toBeUndefined()
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

  it('does nothing when VAPID keys are not configured', async () => {
    const { sendPushNotificationToUser } = await importPushUtils()
    const { db } = createDb([createSubscription()])

    await sendPushNotificationToUser(
      db as any,
      1,
      { title: 't', body: 'b', url: '/chats/1' },
      unconfiguredVapid,
      waitUntilMock,
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.createRequestLogger).not.toHaveBeenCalled()
  })

  it('does nothing when the user has no subscriptions', async () => {
    const { sendPushNotificationToUser } = await importPushUtils()
    const { db } = createDb([])

    await sendPushNotificationToUser(
      db as any,
      1,
      { title: 't', body: 'b', url: '/chats/1' },
      configuredVapid,
      waitUntilMock,
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.createRequestLogger).not.toHaveBeenCalled()
  })

  it('skips a subscription whose endpoint is not allowlisted', async () => {
    const { sendPushNotificationToUser } = await importPushUtils()
    const subscription = createSubscription({
      endpoint: 'https://attacker.example.com/collect',
    })
    const { db, remove } = createDb([subscription])

    await sendPushNotificationToUser(
      db as any,
      1,
      { title: 't', body: 'b', url: '/chats/1' },
      configuredVapid,
      waitUntilMock,
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(mocks.loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      push: expect.objectContaining({ userId: 1, rejected: 1, sent: 0 }),
    }))
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
      waitUntilMock,
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
    expect(mocks.loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      push: expect.objectContaining({
        userId: 1,
        subscriptionCount: 2,
        sent: 2,
      }),
    }))
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
      waitUntilMock,
    )

    expect(remove).toHaveBeenCalledTimes(1)
    expect(deleteWhere).toHaveBeenCalledTimes(1)
    expect(mocks.loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      push: expect.objectContaining({ staleRemoved: 1 }),
    }))
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
      waitUntilMock,
    )

    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('logs without throwing when the push send fails for another reason', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }))

    const { sendPushNotificationToUser } = await importPushUtils()
    const { db, remove } = createDb([createSubscription()])

    await sendPushNotificationToUser(
      db as any,
      1,
      { title: 't', body: 'b', url: '/chats/1' },
      configuredVapid,
      waitUntilMock,
    )

    expect(remove).not.toHaveBeenCalled()
    expect(mocks.loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      push: expect.objectContaining({ failed: 1 }),
    }))
    expect(mocks.loggerEmit).toHaveBeenCalledWith(expect.objectContaining({
      status: 502,
    }))
  })

  it('logs without throwing when fetch itself rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    const { sendPushNotificationToUser } = await importPushUtils()
    const { db } = createDb([createSubscription()])

    await expect(sendPushNotificationToUser(
      db as any,
      1,
      { title: 't', body: 'b', url: '/chats/1' },
      configuredVapid,
      waitUntilMock,
    )).resolves.toBeUndefined()

    expect(mocks.loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      push: expect.objectContaining({ failed: 1 }),
    }))
  })

  it('ships the wide event to Axiom via waitUntil instead of the racing request logger', async () => {
    const wideEvent = { message: 'Push notification send completed' }

    mocks.loggerEmit.mockReturnValue(wideEvent)

    const { sendPushNotificationToUser } = await importPushUtils()
    const { db } = createDb([createSubscription()])

    await sendPushNotificationToUser(
      db as any,
      1,
      { title: 't', body: 'b', url: '/chats/1' },
      configuredVapid,
      waitUntilMock,
    )

    expect(waitUntilMock).toHaveBeenCalledTimes(1)
    expect(mocks.shipWideEventToAxiom).toHaveBeenCalledWith(wideEvent)
  })

  it('never logs the subscription endpoint or encryption keys', async () => {
    const { sendPushNotificationToUser } = await importPushUtils()
    const { db } = createDb([createSubscription({
      endpoint: 'https://fcm.googleapis.com/fcm/send/secret-capability-url',
      p256dhKey: 'super-secret-p256dh',
      authKey: 'super-secret-auth',
    })])

    await sendPushNotificationToUser(
      db as any,
      1,
      { title: 't', body: 'b', url: '/chats/1' },
      configuredVapid,
      waitUntilMock,
    )

    const loggedPayloads = [
      ...mocks.loggerSet.mock.calls.flat(),
      ...mocks.loggerEmit.mock.calls.flat(),
    ]
    const serializedPayloads = JSON.stringify(loggedPayloads)

    expect(serializedPayloads).not.toContain('secret-capability-url')
    expect(serializedPayloads).not.toContain('super-secret-p256dh')
    expect(serializedPayloads).not.toContain('super-secret-auth')
  })
})
