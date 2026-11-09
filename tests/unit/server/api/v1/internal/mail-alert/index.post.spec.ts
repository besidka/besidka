import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAIL_ALERT_MAX_BODY_BYTES,
  MAIL_ALERT_ROUTE,
  MAIL_ALERT_SIGNATURE_HEADER,
  MAIL_ALERT_TIMESTAMP_HEADER,
  signMailAlert,
} from '#shared/utils/mail-alert-protocol'

const SECRET = 'route-secret'

const mocks = vi.hoisted(() => ({
  runtimeConfig: {} as Record<string, unknown>,
  notifyMailAlert: vi.fn(),
  logger: { set: vi.fn() },
}))

vi.mock('cloudflare:workers', () => ({ env: {} }))

vi.mock('#app/nuxt', () => ({
  useRuntimeConfig: () => mocks.runtimeConfig,
}))

vi.mock('nuxt/server', () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRequestHeader: (
    event: { req: Request },
    name: string,
  ) => event.req.headers.get(name) ?? undefined,
  setResponseStatus: (
    event: { res: { status?: number } },
    status: number,
  ) => {
    event.res.status = status
  },
}))

vi.mock('~~/server/utils/mail-alerts/notify', () => ({
  notifyMailAlert: mocks.notifyMailAlert,
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

function createRuntimeConfig(secret: string) {
  return {
    mailAlertSecret: secret,
    vapidPrivateKey: 'private',
    vapidSubject: 'owner@example.com',
    adminEmails: 'owner@example.com',
    featuresDisabled: '',
    featuresHostMode: 'byok',
    featuresRolloutEnabled: '',
    public: {
      baseUrl: 'https://besidka.com',
      vapidPublicKey: 'public',
    },
  }
}

async function createSignedRequest(input: {
  body?: string
  secret?: string
  timestamp?: string
  headers?: Record<string, string>
} = {}) {
  const body = input.body ?? JSON.stringify({
    mailbox: 'privacy',
    subject: 'Hello',
    urgent: false,
  })
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1000))
  const signature = await signMailAlert(
    input.secret ?? SECRET,
    timestamp,
    body,
  )

  return new Request(`https://besidka.com${MAIL_ALERT_ROUTE}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [MAIL_ALERT_TIMESTAMP_HEADER]: timestamp,
      [MAIL_ALERT_SIGNATURE_HEADER]: signature,
      ...input.headers,
    },
    body,
  })
}

async function callRoute(request: Request) {
  vi.stubGlobal('useDb', () => ({ db: true }))
  vi.stubGlobal('useKV', () => ({ kv: true }))

  const { default: handler } = await import(
    '~~/server/api/v1/internal/mail-alert/index.post'
  )
  const event = { req: request, res: {} as { status?: number }, context: {} }

  try {
    const body = await (handler as (input: unknown) => Promise<unknown>)(event)

    return { status: event.res.status ?? 200, body }
  } catch (exception) {
    return {
      status: (exception as { status?: number }).status ?? 500,
      body: null,
    }
  }
}

describe(`POST ${MAIL_ALERT_ROUTE}`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runtimeConfig = createRuntimeConfig(SECRET)
    mocks.notifyMailAlert.mockResolvedValue({
      outcome: 'sent',
      recipients: 1,
      sent: 1,
    })
  })

  it('answers 404 while the secret is not configured', async () => {
    mocks.runtimeConfig = createRuntimeConfig('')

    const result = await callRoute(await createSignedRequest())

    expect(result.status).toBe(404)
    expect(mocks.notifyMailAlert).not.toHaveBeenCalled()
  })

  it('answers 404 without the signature headers', async () => {
    const request = new Request(`https://besidka.com${MAIL_ALERT_ROUTE}`, {
      method: 'POST',
      body: '{"mailbox":"privacy","subject":"x","urgent":true}',
    })

    expect((await callRoute(request)).status).toBe(404)
    expect(mocks.notifyMailAlert).not.toHaveBeenCalled()
  })

  it('answers 404 for a signature made with another secret', async () => {
    const result = await callRoute(await createSignedRequest({
      secret: 'guessed-secret',
    }))

    expect(result.status).toBe(404)
    expect(mocks.notifyMailAlert).not.toHaveBeenCalled()
  })

  it('answers 404 for a replayed, stale request', async () => {
    const stale = String(Math.floor(Date.now() / 1000) - 3600)
    const result = await callRoute(await createSignedRequest({
      timestamp: stale,
    }))

    expect(result.status).toBe(404)
    expect(mocks.notifyMailAlert).not.toHaveBeenCalled()
  })

  it('answers 404 for an oversized body before verifying it', async () => {
    const body = JSON.stringify({
      mailbox: 'privacy',
      subject: 'x'.repeat(MAIL_ALERT_MAX_BODY_BYTES),
      urgent: false,
    })

    expect((await callRoute(await createSignedRequest({ body }))).status)
      .toBe(404)
  })

  it('answers 400 for a signed body with an unknown mailbox', async () => {
    const body = JSON.stringify({
      mailbox: 'postmaster',
      subject: 'x',
      urgent: false,
    })

    expect((await callRoute(await createSignedRequest({ body }))).status)
      .toBe(400)
    expect(mocks.notifyMailAlert).not.toHaveBeenCalled()
  })

  it('pushes a valid alert and logs only mailbox, urgency and outcome', async () => {
    const body = JSON.stringify({
      mailbox: 'security',
      subject: 'Vulnerability in sign-in',
      urgent: true,
    })
    const result = await callRoute(await createSignedRequest({ body }))

    expect(result).toEqual({ status: 202, body: { outcome: 'sent' } })
    expect(mocks.notifyMailAlert).toHaveBeenCalledWith(
      { mailbox: 'security', subject: 'Vulnerability in sign-in', urgent: true },
      expect.objectContaining({
        targetOrigin: 'https://besidka.com',
        vapid: expect.objectContaining({ subject: 'mailto:owner@example.com' }),
      }),
    )

    const logged = JSON.stringify(mocks.logger.set.mock.calls)

    expect(logged).toContain('"mailbox":"security"')
    expect(logged).toContain('"urgent":true')
    expect(logged).not.toContain('Vulnerability')
  })
})
