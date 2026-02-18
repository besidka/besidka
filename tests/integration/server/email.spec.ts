import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resendSend: vi.fn(),
}))

vi.mock('resend', () => ({
  Resend: vi.fn(() => ({
    emails: {
      send: mocks.resendSend,
    },
  })),
}))

function createRuntimeConfig(overrides: {
  emailNoopEnabled?: boolean | string
  resendApiKey?: string
  resendSenderNoreply?: string
  resendSenderPersonalized?: string
} = {}) {
  return {
    emailNoopEnabled: false,
    resendApiKey: '',
    resendSenderNoreply: '',
    resendSenderPersonalized: '',
    ...overrides,
  }
}

describe('useEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('skips sending when noop mode is enabled', async () => {
    const { useEmail } = await import('../../../server/utils/email')
    const email = useEmail(createRuntimeConfig({
      emailNoopEnabled: true,
    }))

    await expect(email.send({
      to: 'test@example.com',
      subject: 'Subject',
      html: '<p>Hello</p>',
    })).resolves.toEqual({ id: 'email-noop' })
    expect(mocks.resendSend).not.toHaveBeenCalled()
  })

  it('throws when resend key is missing in strict mode', async () => {
    const { useEmail } = await import('../../../server/utils/email')
    const email = useEmail(createRuntimeConfig({
      emailNoopEnabled: false,
      resendApiKey: '',
      resendSenderNoreply: 'noreply@example.com',
      resendSenderPersonalized: 'personal@example.com',
    }))

    await expect(email.send({
      to: 'test@example.com',
      subject: 'Subject',
      html: '<p>Hello</p>',
    })).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'Resend API key is not set in the runtime configuration.',
    })
    expect(mocks.resendSend).not.toHaveBeenCalled()
  })

  it('throws when sender is missing in strict mode', async () => {
    const { useEmail } = await import('../../../server/utils/email')
    const email = useEmail(createRuntimeConfig({
      emailNoopEnabled: false,
      resendApiKey: 'resend-key',
      resendSenderNoreply: '',
      resendSenderPersonalized: '',
    }))

    await expect(email.send({
      to: 'test@example.com',
      subject: 'Subject',
      html: '<p>Hello</p>',
      from: 'noreply',
    })).rejects.toMatchObject({
      message: 'Sender email is required for noreply emails',
    })
    expect(mocks.resendSend).not.toHaveBeenCalled()
  })
})
