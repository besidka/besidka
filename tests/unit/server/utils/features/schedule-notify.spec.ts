import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listAdminUserRoles: vi.fn(),
  sendTemplateEmail: vi.fn(),
  sendPushNotificationToUser: vi.fn(),
}))

vi.mock('cloudflare:workers', () => ({ env: {} }))

vi.mock('~~/server/utils/features/admin-queries', () => ({
  listAdminUserRoles: mocks.listAdminUserRoles,
}))

vi.mock('~~/server/utils/email-template', () => ({
  sendTemplateEmail: mocks.sendTemplateEmail,
}))

vi.mock('~~/server/utils/push', async (importOriginal) => {
  const original = await importOriginal<typeof import('~~/server/utils/push')>()

  return {
    ...original,
    sendPushNotificationToUser: mocks.sendPushNotificationToUser,
  }
})

const {
  buildFeatureScheduleMessage,
  notifyFeatureAdmins,
} = await import('~~/server/utils/features/schedule-notify')

const schedule = {
  id: 4,
  flag: 'artifacts',
  change: { rolloutBps: 2500 },
  runAt: Math.floor(Date.parse('2026-12-26T10:00:00Z') / 1000),
  status: 'applied' as const,
  requiresNoticeId: null,
  appliedAt: null,
  error: null,
}

const config = {
  featuresDisabled: '',
  featuresHostMode: 'byok' as const,
  featuresRolloutEnabled: true,
  adminEmails: 'owner@example.com',
  requireAdminTwoFactor: false,
}

describe('buildFeatureScheduleMessage', () => {
  it('names the flag, the change, the time and the audit link', () => {
    const message = buildFeatureScheduleMessage({
      outcome: 'applied',
      schedule,
      appliedAt: new Date(),
    }, 'https://besidka.com')

    expect(message.subject).toContain('applied')
    expect(message.body).toContain('rollout 25%')
    expect(message.body).toContain('2026-12-26T10:00:00.000Z')
    expect(message.body).toContain('https://besidka.com/admin/audit')
  })

  it('carries the reason and the no-retry note for a failure', () => {
    const message = buildFeatureScheduleMessage({
      outcome: 'failed',
      schedule: { ...schedule, status: 'failed', error: 'Feature not found' },
      appliedAt: new Date(),
    }, 'https://besidka.com')

    expect(message.subject).toContain('failed')
    expect(message.body).toContain('Feature not found')
    expect(message.body).toContain('will not be retried')
  })
})

describe('notifyFeatureAdmins', () => {
  const logger = { set: vi.fn() }
  const notification = {
    outcome: 'applied' as const,
    schedule,
    appliedAt: new Date(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendTemplateEmail.mockResolvedValue({ messageId: 'm' })
    mocks.sendPushNotificationToUser.mockResolvedValue(null)
    mocks.listAdminUserRoles.mockResolvedValue({
      roles: [
        { role: 'admin', userId: 2, email: 'admin@example.com' },
        { role: 'tester', userId: 3, email: 'tester@example.com' },
        { role: 'admin', userId: 1, email: 'owner@example.com' },
      ],
      envAdmins: [{ id: 1, name: 'Owner', email: 'owner@example.com' }],
    })
  })

  it('emails each admin once and never a tester', async () => {
    await notifyFeatureAdmins(notification, {
      db: {} as never,
      config,
      vapid: {},
      siteUrl: 'https://besidka.com',
      logger,
    })

    expect(mocks.sendTemplateEmail.mock.calls.map((call) => {
      return call[0].to
    }).sort()).toEqual(['admin@example.com', 'owner@example.com'])
    expect(mocks.sendPushNotificationToUser).not.toHaveBeenCalled()
  })

  it('pushes to admins when push is configured, with a generic body', async () => {
    await notifyFeatureAdmins(notification, {
      db: {} as never,
      config,
      vapid: {
        publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa40HI0DLLuxazjqAKVxK0AAA',
        privateKey: 'private',
      },
      siteUrl: 'https://besidka.com',
      logger,
    })

    for (const call of mocks.sendPushNotificationToUser.mock.calls) {
      expect(call[2]).toMatchObject({
        title: 'Scheduled change applied',
        url: '/admin/features/artifacts',
      })
      expect(JSON.stringify(call[2])).not.toContain('@')
    }
  })

  it('keeps going when one email fails and reports it', async () => {
    mocks.sendTemplateEmail.mockRejectedValueOnce(new Error('rejected'))

    await notifyFeatureAdmins(notification, {
      db: {} as never,
      config,
      vapid: {},
      siteUrl: '',
      logger,
    })

    expect(mocks.sendTemplateEmail).toHaveBeenCalledTimes(2)
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        featureScheduleNotify: expect.objectContaining({
          emailsSent: 1,
          failures: 1,
        }),
      },
    })
  })
})
