import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendTemplateEmail: vi.fn(async () => undefined),
}))

function stubSendTemplateEmail() {
  vi.stubGlobal('sendTemplateEmail', mocks.sendTemplateEmail)
}

async function importSecurityEmails() {
  return import('../../../../server/utils/account/security-emails')
}

describe('security-emails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubSendTemplateEmail()
  })

  it('sends the password-changed email to the account address', async () => {
    const { sendPasswordChangedEmail } = await importSecurityEmails()

    await sendPasswordChangedEmail({
      user: { email: 'user@example.com' },
      logger: { set: vi.fn() },
    })

    expect(mocks.sendTemplateEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendTemplateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Your password was changed',
        template: 'NoticeEmail',
      }),
    )
  })

  it('sends the sign-in-method-connected email with the provider label',
    async () => {
      const { sendSignInMethodConnectedEmail } = await importSecurityEmails()

      await sendSignInMethodConnectedEmail({
        user: { email: 'user@example.com' },
        providerId: 'google',
        logger: { set: vi.fn() },
      })

      expect(mocks.sendTemplateEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'New sign-in method connected',
          template: 'NoticeEmail',
          props: expect.objectContaining({
            body: expect.stringContaining('Google'),
          }),
        }),
      )
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

      expect(mocks.sendTemplateEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Sign-in method disconnected',
          template: 'NoticeEmail',
          props: expect.objectContaining({
            body: expect.stringContaining('GitHub'),
          }),
        }),
      )
    })

  it('sends the two-factor-enabled email to the account address', async () => {
    const { sendTwoFactorEnabledEmail } = await importSecurityEmails()

    await sendTwoFactorEnabledEmail({
      user: { email: 'user@example.com' },
      logger: { set: vi.fn() },
    })

    expect(mocks.sendTemplateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Two-factor authentication turned on',
        template: 'NoticeEmail',
      }),
    )
  })

  it('sends the two-factor-disabled email to the account address', async () => {
    const { sendTwoFactorDisabledEmail } = await importSecurityEmails()

    await sendTwoFactorDisabledEmail({
      user: { email: 'user@example.com' },
      logger: { set: vi.fn() },
    })

    expect(mocks.sendTemplateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Two-factor authentication turned off',
        template: 'NoticeEmail',
      }),
    )
  })

  it('sends the email-changed email to the previous address', async () => {
    const { sendEmailChangedEmail } = await importSecurityEmails()

    await sendEmailChangedEmail({
      user: { email: 'old@example.com' },
      newEmail: 'new@example.com',
      logger: { set: vi.fn() },
    })

    expect(mocks.sendTemplateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'old@example.com',
        subject: 'Your account email address was changed',
        template: 'NoticeEmail',
        props: expect.objectContaining({
          body: expect.stringContaining('new@example.com'),
        }),
      }),
    )
  })

  it(
    'sends the backup-codes-regenerated email to the account address',
    async () => {
      const { sendTwoFactorBackupCodesRegeneratedEmail }
        = await importSecurityEmails()

      await sendTwoFactorBackupCodesRegeneratedEmail({
        user: { email: 'user@example.com' },
        logger: { set: vi.fn() },
      })

      expect(mocks.sendTemplateEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Two-factor backup codes regenerated',
          template: 'NoticeEmail',
        }),
      )
    },
  )

  it('sends the passkey-added email to the account address', async () => {
    const { sendPasskeyAddedEmail } = await importSecurityEmails()

    await sendPasskeyAddedEmail({
      user: { email: 'user@example.com' },
      logger: { set: vi.fn() },
    })

    expect(mocks.sendTemplateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'New passkey added',
        template: 'NoticeEmail',
      }),
    )
  })

  it('sends the passkey-removed email to the account address', async () => {
    const { sendPasskeyRemovedEmail } = await importSecurityEmails()

    await sendPasskeyRemovedEmail({
      user: { email: 'user@example.com' },
      logger: { set: vi.fn() },
    })

    expect(mocks.sendTemplateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Passkey removed',
        template: 'NoticeEmail',
      }),
    )
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

      expect(mocks.sendTemplateEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          props: expect.objectContaining({
            body: expect.stringContaining('custom-provider'),
          }),
        }),
      )
    })

  it('catches a send failure and logs it instead of throwing', async () => {
    mocks.sendTemplateEmail.mockRejectedValueOnce(
      new Error('E_DELIVERY_FAILED'),
    )

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
