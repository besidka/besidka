import { describe, expect, it, vi } from 'vitest'
import {
  MAIL_ALERT_ROUTE,
  MAIL_ALERT_SIGNATURE_HEADER,
  MAIL_ALERT_TIMESTAMP_HEADER,
  verifyMailAlertSignature,
} from '#shared/utils/mail-alert-protocol'
import {
  buildMailAlertPayload,
  handleEmail,
  sendMailAlert,
  type MailAlertsEnv,
} from '~~/workers/mail-alerts/src/main'

const SECRET = 'test-mail-alert-secret-0123456789abcdef'

function createMessage(input: {
  to?: string
  subject?: string
  from?: string
  authenticationResults?: string
  forward?: () => Promise<unknown>
} = {}) {
  const values = new Map([
    ['subject', input.subject ?? 'Hello'],
    ['from', input.from ?? 'Sender <sender@example.com>'],
    ['authentication-results', input.authenticationResults ?? ''],
  ])
  const headers = {
    get: (name: string) => {
      return values.get(name.toLowerCase()) ?? null
    },
  }

  return {
    to: input.to ?? 'privacy@besidka.com',
    from: 'bounce@example.com',
    headers,
    raw: new ReadableStream(),
    rawSize: 10,
    canBeForwarded: true,
    setReject: vi.fn(),
    reply: vi.fn(),
    forward: vi.fn(input.forward ?? (async () => {
      return { messageId: 'forwarded' }
    })),
  } as unknown as ForwardableEmailMessage & {
    forward: ReturnType<typeof vi.fn>
  }
}

function createEnv(overrides: Partial<MailAlertsEnv> = {}) {
  const fetch = vi.fn(async () => {
    return new Response(null, { status: 202 })
  })

  return {
    env: {
      FORWARD_TO: 'destination@example.net',
      MAIL_ALERT_SECRET: SECRET,
      APP: { fetch },
      ...overrides,
    } as MailAlertsEnv,
    fetch,
  }
}

function createContext() {
  const pending: Promise<unknown>[] = []

  return {
    pending,
    context: {
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        pending.push(promise)
      }),
    },
  }
}

describe('handleEmail', () => {
  it('forwards before it schedules the alert', async () => {
    const order: string[] = []
    const message = createMessage({
      forward: async () => {
        order.push('forward')

        return { messageId: 'forwarded' }
      },
    })
    const { env, fetch } = createEnv()

    fetch.mockImplementation(async () => {
      order.push('alert')

      return new Response(null, { status: 202 })
    })

    const { context, pending } = createContext()

    await handleEmail(message, env, context)
    await Promise.all(pending)

    expect(message.forward).toHaveBeenCalledWith('destination@example.net')
    expect(order).toEqual(['forward', 'alert'])
  })

  it('rethrows a failed forward and sends no alert', async () => {
    const message = createMessage({
      forward: async () => {
        throw new Error('destination not verified')
      },
    })
    const { env, fetch } = createEnv()
    const { context } = createContext()

    await expect(handleEmail(message, env, context))
      .rejects.toThrow('destination not verified')
    expect(context.waitUntil).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('throws instead of dropping mail when FORWARD_TO is unset', async () => {
    const message = createMessage()
    const { env } = createEnv({ FORWARD_TO: undefined })
    const { context } = createContext()

    await expect(handleEmail(message, env, context)).rejects.toThrow()
    expect(message.forward).not.toHaveBeenCalled()
  })

  it('still forwards when the alert call throws', async () => {
    const message = createMessage()
    const { env, fetch } = createEnv()

    fetch.mockRejectedValue(new Error('service binding down'))

    const { context, pending } = createContext()

    await expect(handleEmail(message, env, context)).resolves.toBeUndefined()
    await expect(Promise.all(pending)).resolves.toEqual(['failed'])
    expect(message.forward).toHaveBeenCalledTimes(1)
  })

  it('still forwards when the alert secret is missing', async () => {
    const message = createMessage()
    const { env, fetch } = createEnv({ MAIL_ALERT_SECRET: undefined })
    const { context, pending } = createContext()

    await handleEmail(message, env, context)

    await expect(Promise.all(pending)).resolves.toEqual(['skipped-unconfigured'])
    expect(message.forward).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('sendMailAlert', () => {
  it('posts a signed payload the app can verify', async () => {
    const message = createMessage({
      to: 'abuse@besidka.com',
      subject: '=?UTF-8?Q?Nakaz_usuni=C4=99cia?=',
    })
    const { env, fetch } = createEnv()
    const now = Date.parse('2026-11-09T10:00:00Z')

    await expect(sendMailAlert(message, env, now)).resolves.toBe('sent')

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    const body = init.body as string

    expect(new URL(url).pathname).toBe(MAIL_ALERT_ROUTE)
    expect(JSON.parse(body)).toEqual({
      mailbox: 'abuse',
      subject: 'Nakaz usunięcia',
      urgent: true,
    })
    await expect(verifyMailAlertSignature({
      secret: SECRET,
      timestamp: headers[MAIL_ALERT_TIMESTAMP_HEADER],
      signature: headers[MAIL_ALERT_SIGNATURE_HEADER],
      body,
      nowSeconds: now / 1000,
    })).resolves.toBe(true)
  })

  it('never sends the sender address or the body', async () => {
    const message = createMessage({ from: 'Jan <jan.kowalski@example.com>' })
    const { env, fetch } = createEnv()

    await sendMailAlert(message, env)

    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]

    expect(init.body).not.toContain('jan.kowalski')
    expect(Object.keys(JSON.parse(init.body as string)).sort())
      .toEqual(['mailbox', 'subject', 'urgent'])
  })

  it('skips mail to other addresses', async () => {
    const { env, fetch } = createEnv()

    await expect(sendMailAlert(createMessage({ to: 'hi@besidka.com' }), env))
      .resolves.toBe('skipped-mailbox')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports a rejected call without throwing', async () => {
    const { env, fetch } = createEnv()

    fetch.mockResolvedValue(new Response(null, { status: 404 }))

    await expect(sendMailAlert(createMessage(), env)).resolves.toBe('rejected')
  })
})

describe('buildMailAlertPayload', () => {
  it('reads the Authentication-Results header for authority domains', () => {
    const fromAuthority = createMessage({
      subject: 'Pismo nr 15',
      from: 'Sekretariat <sekretariat@abw.gov.pl>',
      authenticationResults:
        'mx.cloudflare.net; dmarc=pass header.from=abw.gov.pl',
    })
    const unauthenticated = createMessage({
      subject: 'Pismo nr 15',
      from: 'Sekretariat <sekretariat@abw.gov.pl>',
    })

    expect(buildMailAlertPayload(fromAuthority, 'privacy').urgent).toBe(true)
    expect(buildMailAlertPayload(unauthenticated, 'privacy').urgent)
      .toBe(false)
  })

  it('strips tabs and bidi controls and cuts the subject short', () => {
    const message = createMessage({
      subject: `Line one\t\u202Eevil\u202C ${'x'.repeat(200)}`,
    })
    const payload = buildMailAlertPayload(message, 'contact')

    expect(payload.subject).not.toMatch(/[\t\u202E\u202C]/)
    expect(Array.from(payload.subject).length).toBeLessThanOrEqual(80)
    expect(payload.urgent).toBe(false)
  })
})
