import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listAdminUserRoles: vi.fn(),
  sendPushNotificationToUser: vi.fn(),
}))

vi.mock('cloudflare:workers', () => ({ env: {} }))

vi.mock('~~/server/utils/features/admin-queries', () => ({
  listAdminUserRoles: mocks.listAdminUserRoles,
}))

vi.mock('~~/server/utils/push', async (importOriginal) => {
  const original = await importOriginal<typeof import('~~/server/utils/push')>()

  return {
    ...original,
    sendPushNotificationToUser: mocks.sendPushNotificationToUser,
  }
})

const {
  MAIL_ALERT_COLLAPSE_SECONDS,
  MAIL_PUSH_DELIVERY,
  URGENT_MAIL_PUSH_DELIVERY,
  buildMailAlertPush,
  mailAlertCollapseKey,
  notifyMailAlert,
} = await import('~~/server/utils/mail-alerts/notify')

const config = {
  featuresDisabled: '',
  featuresHostMode: 'byok' as const,
  featuresRolloutEnabled: true,
  adminEmails: 'owner@example.com',
  requireAdminTwoFactor: false,
}

const vapid = {
  subject: 'mailto:owner@example.com',
  publicKey: 'public',
  privateKey: 'private',
}

function createKv() {
  const store = new Map<string, string>()

  return {
    store,
    get: vi.fn(async (key: string) => {
      return store.get(key) ?? null
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
  }
}

function createInput(kv = createKv()) {
  return {
    db: {} as never,
    kv: kv as never,
    config,
    vapid,
    targetOrigin: 'https://besidka.com',
    createTag: () => 'fixed',
  }
}

const normalMail = {
  mailbox: 'privacy' as const,
  subject: 'Question about my data',
  urgent: false,
}

const urgentMail = {
  mailbox: 'abuse' as const,
  subject: 'Removal order 2021/784',
  urgent: true,
}

describe('buildMailAlertPush', () => {
  it('names the mailbox and shows the short subject', () => {
    expect(buildMailAlertPush(normalMail)).toEqual({
      title: 'New mail to privacy@',
      body: 'Question about my data',
      url: '/admin',
      tag: 'besidka-mail-privacy',
    })
  })

  it('marks urgent mail and gives it a tag of its own', () => {
    const push = buildMailAlertPush(urgentMail, () => 'abc')

    expect(push.title).toBe('Urgent: new mail to abuse@')
    expect(push.tag).toBe('besidka-mail-urgent-abc')
  })

  it('re-sanitizes the subject and fills an empty one', () => {
    const injected = buildMailAlertPush({
      ...normalMail,
      subject: 'Line\r\nInjected: header',
    })

    expect(injected.body).toBe('Line Injected: header')
    expect(buildMailAlertPush({ ...normalMail, subject: '  ' }).body)
      .toBe('(no subject)')
  })
})

describe('notifyMailAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendPushNotificationToUser.mockResolvedValue({
      sent: 1,
      staleRemoved: 0,
      rejected: 0,
      failed: 0,
      failures: [],
    })
    mocks.listAdminUserRoles.mockResolvedValue({
      roles: [
        { role: 'admin', userId: 2, email: 'admin@example.com' },
        { role: 'tester', userId: 3, email: 'tester@example.com' },
        { role: 'admin', userId: 1, email: 'owner@example.com' },
      ],
      envAdmins: [{ id: 1, name: 'Owner', email: 'owner@example.com' }],
    })
  })

  it('pushes to admins only, once each', async () => {
    const result = await notifyMailAlert(normalMail, createInput())
    const userIds = mocks.sendPushNotificationToUser.mock.calls.map((call) => {
      return call[1]
    })

    expect(userIds.sort()).toEqual([1, 2])
    expect(result).toEqual({ outcome: 'sent', recipients: 2, sent: 2, failed: 0 })
  })

  it('sends urgent mail with high urgency and the site origin', async () => {
    await notifyMailAlert(urgentMail, createInput())

    const call = mocks.sendPushNotificationToUser.mock.calls[0] ?? []

    expect(call[5]).toBe('https://besidka.com')
    expect(call[6]).toEqual(URGENT_MAIL_PUSH_DELIVERY)
    expect(URGENT_MAIL_PUSH_DELIVERY.urgency).toBe('high')
  })

  it('collapses normal mail to one push per mailbox per window', async () => {
    const kv = createKv()

    const first = await notifyMailAlert(normalMail, createInput(kv))
    const second = await notifyMailAlert(normalMail, createInput(kv))
    const otherMailbox = await notifyMailAlert(
      { ...normalMail, mailbox: 'contact' },
      createInput(kv),
    )

    expect(first.outcome).toBe('sent')
    expect(second.outcome).toBe('collapsed')
    expect(otherMailbox.outcome).toBe('sent')
    expect(kv.put).toHaveBeenCalledWith(
      mailAlertCollapseKey('privacy'),
      '1',
      { expirationTtl: MAIL_ALERT_COLLAPSE_SECONDS },
    )
    expect(mocks.sendPushNotificationToUser.mock.calls[0]?.[6])
      .toEqual(MAIL_PUSH_DELIVERY)
  })

  it('always sends urgent mail, even inside a collapse window', async () => {
    const kv = createKv()

    kv.store.set(mailAlertCollapseKey('abuse'), '1')

    const first = await notifyMailAlert(urgentMail, createInput(kv))
    const second = await notifyMailAlert(urgentMail, createInput(kv))

    expect(first.outcome).toBe('sent')
    expect(second.outcome).toBe('sent')
    expect(kv.get).not.toHaveBeenCalled()
  })

  it('keeps going when one admin push throws', async () => {
    mocks.sendPushNotificationToUser
      .mockRejectedValueOnce(new Error('push service down'))

    const result = await notifyMailAlert(urgentMail, createInput())

    expect(result).toEqual({ outcome: 'sent', recipients: 2, sent: 1, failed: 1 })
  })

  it('releases the window when no push reached anyone', async () => {
    const kv = createKv()

    mocks.sendPushNotificationToUser.mockRejectedValue(new Error('down'))

    const failed = await notifyMailAlert(normalMail, createInput(kv))

    expect(failed).toEqual({
      outcome: 'push-failed',
      recipients: 2,
      sent: 0,
      failed: 2,
    })
    expect(kv.store.has(mailAlertCollapseKey('privacy'))).toBe(false)

    mocks.sendPushNotificationToUser.mockResolvedValue({ sent: 1 })

    const retried = await notifyMailAlert(normalMail, createInput(kv))

    expect(retried.outcome).toBe('sent')
  })

  it('fails open when KV refuses the write', async () => {
    const kv = createKv()

    kv.put.mockRejectedValue(new Error('KV PUT failed: 429'))

    const result = await notifyMailAlert(normalMail, createInput(kv))

    expect(result.outcome).toBe('sent')
  })

  it('reports push-not-configured without touching KV', async () => {
    const kv = createKv()
    const result = await notifyMailAlert(normalMail, {
      ...createInput(kv),
      vapid: {},
    })

    expect(result.outcome).toBe('push-not-configured')
    expect(kv.put).not.toHaveBeenCalled()
  })

  it('reports no-recipients when there is no admin', async () => {
    mocks.listAdminUserRoles.mockResolvedValue({ roles: [], envAdmins: [] })

    const result = await notifyMailAlert(urgentMail, createInput())

    expect(result.outcome).toBe('no-recipients')
    expect(mocks.sendPushNotificationToUser).not.toHaveBeenCalled()
  })
})
