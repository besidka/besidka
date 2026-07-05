import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({ env: {} }))

function createRuntimeConfig(overrides: {
  emailNoopEnabled?: boolean | string
  emailSenderNoreply?: string
  emailSenderPersonalized?: string
} = {}) {
  return {
    emailNoopEnabled: false,
    emailSenderNoreply: '',
    emailSenderPersonalized: '',
    ...overrides,
  }
}

describe('useEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('createError', (input: string | {
      statusCode?: number
      statusMessage?: string
      message?: string
    }) => {
      if (typeof input === 'string') {
        return new Error(input)
      }

      const exception = new Error(input.statusMessage || input.message)

      Object.assign(exception, input)

      return exception
    })
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
    })).resolves.toEqual({ messageId: 'email-noop' })
  })

  it('throws when email binding is missing in strict mode', async () => {
    const { useEmail } = await import('../../../server/utils/email')
    const email = useEmail(createRuntimeConfig({
      emailNoopEnabled: false,
      emailSenderNoreply: 'noreply@example.com',
      emailSenderPersonalized: 'personal@example.com',
    }), undefined)

    await expect(email.send({
      to: 'test@example.com',
      subject: 'Subject',
      html: '<p>Hello</p>',
    })).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'Email binding (EMAIL) is not available in the runtime.',
    })
  })

  it('throws when sender is missing in strict mode', async () => {
    const { useEmail } = await import('../../../server/utils/email')
    const fakeBinding = { send: vi.fn() }
    const email = useEmail(createRuntimeConfig({
      emailNoopEnabled: false,
      emailSenderNoreply: '',
      emailSenderPersonalized: '',
    }), fakeBinding)

    await expect(email.send({
      to: 'test@example.com',
      subject: 'Subject',
      html: '<p>Hello</p>',
      from: 'noreply',
    })).rejects.toMatchObject({
      message: 'Sender email is required for noreply emails',
    })
    expect(fakeBinding.send).not.toHaveBeenCalled()
  })

  it('sends via the binding with from, to, subject, html and text', async () => {
    const { useEmail } = await import('../../../server/utils/email')
    const fakeBinding = {
      send: vi.fn().mockResolvedValue({ messageId: 'm1' }),
    }
    const email = useEmail(createRuntimeConfig({
      emailNoopEnabled: false,
      emailSenderNoreply: 'noreply@example.com',
      emailSenderPersonalized: 'personal@example.com',
    }), fakeBinding)

    await expect(email.send({
      to: 'test@example.com',
      subject: 'Subject',
      html: '<p>Hello</p>',
    })).resolves.toEqual({ messageId: 'm1' })
    expect(fakeBinding.send).toHaveBeenCalledTimes(1)
    expect(fakeBinding.send).toHaveBeenCalledWith({
      from: { name: 'Besidka', email: 'noreply@example.com' },
      to: 'test@example.com',
      subject: 'Subject',
      html: '<p>Hello</p>',
      text: 'Hello',
    })
  })

  it('uses an explicit text override instead of deriving from html', async () => {
    const { useEmail } = await import('../../../server/utils/email')
    const fakeBinding = {
      send: vi.fn().mockResolvedValue({ messageId: 'm2' }),
    }
    const email = useEmail(createRuntimeConfig({
      emailSenderNoreply: 'noreply@example.com',
    }), fakeBinding)

    await email.send({
      to: 'test@example.com',
      subject: 'Subject',
      html: '<p>Hello</p>',
      text: 'Custom plain text',
    })

    expect(fakeBinding.send).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Custom plain text' }),
    )
  })

  it('derives a link-aware, entity-decoded text part from html', async () => {
    const { useEmail } = await import('../../../server/utils/email')
    const fakeBinding = {
      send: vi.fn().mockResolvedValue({ messageId: 'm3' }),
    }
    const email = useEmail(createRuntimeConfig({
      emailSenderNoreply: 'noreply@example.com',
    }), fakeBinding)

    await email.send({
      to: 'test@example.com',
      subject: 'Subject',
      html: '<p>Reset here: <a href="https://besidka.com/r?a=1&amp;b=2">Reset</a></p>',
    })

    expect(fakeBinding.send).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Reset here: Reset (https://besidka.com/r?a=1&b=2)',
      }),
    )
  })

  it('sends from the personalized sender when from is personalized', async () => {
    const { useEmail } = await import('../../../server/utils/email')
    const fakeBinding = {
      send: vi.fn().mockResolvedValue({ messageId: 'm4' }),
    }
    const email = useEmail(createRuntimeConfig({
      emailSenderNoreply: 'noreply@example.com',
      emailSenderPersonalized: 'personal@example.com',
    }), fakeBinding)

    await email.send({
      to: 'test@example.com',
      subject: 'Subject',
      html: '<p>Hi</p>',
      from: 'personalized',
    })

    expect(fakeBinding.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: 'Besidka', email: 'personal@example.com' },
      }),
    )
  })

  it('wraps a binding send failure via createError', async () => {
    const { useEmail } = await import('../../../server/utils/email')
    const fakeBinding = {
      send: vi.fn().mockRejectedValue(new Error('E_DELIVERY_FAILED')),
    }
    const email = useEmail(createRuntimeConfig({
      emailSenderNoreply: 'noreply@example.com',
    }), fakeBinding)

    await expect(email.send({
      to: 'test@example.com',
      subject: 'Subject',
      html: '<p>Hello</p>',
    })).rejects.toThrow('E_DELIVERY_FAILED')
    expect(fakeBinding.send).toHaveBeenCalledTimes(1)
  })
})
