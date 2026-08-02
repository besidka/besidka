import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(async () => ({ messageId: 'm1' })),
}))

function stubUseEmail() {
  vi.stubGlobal('useEmail', () => ({ send: mocks.send }))
}

async function importSecurityEmails() {
  return import('../../../../server/utils/account/security-emails')
}

describe('security-emails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubUseEmail()
  })

  it('sends the password-changed email to the account address', async () => {
    const { sendPasswordChangedEmail } = await importSecurityEmails()

    await sendPasswordChangedEmail({
      user: { email: 'user@example.com' },
      logger: { set: vi.fn() },
    })

    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
      subject: 'Your password was changed',
    }))
  })

  it('sends the sign-in-method-connected email with the provider label',
    async () => {
      const { sendSignInMethodConnectedEmail } = await importSecurityEmails()

      await sendSignInMethodConnectedEmail({
        user: { email: 'user@example.com' },
        providerId: 'google',
        logger: { set: vi.fn() },
      })

      expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
        to: 'user@example.com',
        subject: 'New sign-in method connected',
        html: expect.stringContaining('Google'),
      }))
    })

  it('sends the sign-in-method-disconnected email with the provider label',
    async () => {
      const { sendSignInMethodDisconnectedEmail }
        = await importSecurityEmails()

      await sendSignInMethodDisconnectedEmail({
        user: { email: 'user@example.com' },
        providerId: 'github',
        logger: { set: vi.fn() },
      })

      expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
        to: 'user@example.com',
        subject: 'Sign-in method disconnected',
        html: expect.stringContaining('GitHub'),
      }))
    })

  it('sends the two-factor-enabled email to the account address', async () => {
    const { sendTwoFactorEnabledEmail } = await importSecurityEmails()

    await sendTwoFactorEnabledEmail({
      user: { email: 'user@example.com' },
      logger: { set: vi.fn() },
    })

    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
      subject: 'Two-factor authentication turned on',
    }))
  })

  it('sends the two-factor-disabled email to the account address', async () => {
    const { sendTwoFactorDisabledEmail } = await importSecurityEmails()

    await sendTwoFactorDisabledEmail({
      user: { email: 'user@example.com' },
      logger: { set: vi.fn() },
    })

    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
      subject: 'Two-factor authentication turned off',
    }))
  })

  it('falls back to the raw provider id when it has no display label',
    async () => {
      const { sendSignInMethodDisconnectedEmail }
        = await importSecurityEmails()

      await sendSignInMethodDisconnectedEmail({
        user: { email: 'user@example.com' },
        providerId: 'custom-provider',
        logger: { set: vi.fn() },
      })

      expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
        html: expect.stringContaining('custom-provider'),
      }))
    })

  it('catches a send failure and logs it instead of throwing', async () => {
    mocks.send.mockRejectedValueOnce(new Error('E_DELIVERY_FAILED'))

    const logger = { set: vi.fn() }
    const { sendPasswordChangedEmail } = await importSecurityEmails()

    await expect(sendPasswordChangedEmail({
      user: { email: 'user@example.com' },
      logger,
    })).resolves.toBeUndefined()

    expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
      securityEmail: expect.objectContaining({
        subject: 'Your password was changed',
        error: 'E_DELIVERY_FAILED',
      }),
    }))
  })
})
