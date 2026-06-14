import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  trackLandingEvent: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
  }),
  createError: (input: {
    message?: string
    status?: number
    why?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, {
      statusCode: input.status,
      statusMessage: input.message,
      why: input.why,
    })

    return exception
  },
}))

vi.mock('~~/server/utils/landing/analytics-events', () => ({
  trackLandingEvent: mocks.trackLandingEvent,
}))

// Mirror the live consent cookie revision (nuxt.config cookieConsent.revision).
// A cookie with any other `v` is treated as stale and denied.
const CONSENT_REVISION = 1
const CONSENT_COOKIE_NAME = 'cookies_consent'

interface ConsentCookieValue {
  v: number
  granted: string[]
  id?: string
  date?: string
}

/**
 * Build the encoded `cookies_consent` cookie header value the same way the
 * client writes it, so the stubbed getCookieConsent can parse it exactly as
 * the real Nitro util does.
 */
function consentCookieHeader(value: ConsentCookieValue): string {
  return `${CONSENT_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(value))}`
}

function grantedConsentHeaders(
  granted: string[] = ['necessary', 'analytics'],
): Record<string, string> {
  return {
    'sec-fetch-site': 'same-origin',
    'cookie': consentCookieHeader({
      v: CONSENT_REVISION,
      granted,
      id: 'test-consent',
      date: '2026-06-14T00:00:00.000Z',
    }),
  }
}

async function getEventsHandler() {
  const module = await import(
    '../../../server/api/v1/events/index.post'
  )

  return module.default
}

function makeEvent(
  body: unknown,
  headers: Record<string, string> = {},
) {
  return {
    body,
    headers,
    path: '/',
    method: 'POST',
    context: {},
  }
}

describe('events ingest API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)

    vi.stubGlobal('getHeader', (
      event: { headers: Record<string, string> },
      key: string,
    ) => event.headers[key.toLowerCase()])

    vi.stubGlobal('readValidatedBody', async (
      event: { body: unknown },
      parser: (body: unknown) => { success: true, data: unknown }
        | { success: false, error: { message: string } },
    ) => {
      return parser(event.body)
    })

    // Faithful reimplementation of the Nitro-auto-imported getCookieConsent
    // util: read the `cookies_consent` cookie off the request, validate the
    // revision matches the live one, and FAIL CLOSED (deny everything) on a
    // missing / malformed / stale-revision cookie.
    vi.stubGlobal('getCookieConsent', (
      event: { headers: Record<string, string> },
    ) => {
      const denied = {
        isDecided: false,
        granted: [] as string[],
        isAllowed: () => false,
      }

      const cookieHeader = event.headers.cookie

      if (!cookieHeader) {
        return denied
      }

      const match = cookieHeader
        .split(';')
        .map(part => part.trim())
        .find(part => part.startsWith(`${CONSENT_COOKIE_NAME}=`))

      if (!match) {
        return denied
      }

      const raw = decodeURIComponent(
        match.slice(CONSENT_COOKIE_NAME.length + 1),
      )

      let parsed: ConsentCookieValue | null = null

      try {
        parsed = JSON.parse(raw) as ConsentCookieValue
      } catch {
        return denied
      }

      if (
        !parsed
        || typeof parsed !== 'object'
        || parsed.v !== CONSENT_REVISION
        || !Array.isArray(parsed.granted)
      ) {
        return denied
      }

      const granted = parsed.granted

      return {
        isDecided: true,
        granted,
        isAllowed: (id: string) => granted.includes(id),
      }
    })
  })

  it('rejects requests where sec-fetch-site is missing (403)', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      { event: 'cta_click' },
      {},
    )

    await expect(handler(event as any)).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it('rejects requests where sec-fetch-site is cross-site (403)', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      { event: 'cta_click' },
      { 'sec-fetch-site': 'cross-site' },
    )

    await expect(handler(event as any)).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it('rejects unknown event name (400)', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      { event: 'admin_panel_access' },
      grantedConsentHeaders(),
    )

    await expect(handler(event as any)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('rejects new_chat_created from public endpoint (400)', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      { event: 'new_chat_created' },
      grantedConsentHeaders(),
    )

    await expect(handler(event as any)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('records the event with a valid analytics consent cookie', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      { event: 'cta_click', target: 'hero-button' },
      grantedConsentHeaders(['necessary', 'analytics']),
    )

    mocks.trackLandingEvent.mockResolvedValue(undefined)

    const result = await handler(event as any)

    expect(result).toEqual({ ok: true })
    expect(mocks.trackLandingEvent).toHaveBeenCalledWith(
      'cta_click',
      { target: 'hero-button', value: undefined },
      expect.anything(),
    )
    expect(mocks.loggerSet).toHaveBeenCalledWith({
      analytics: { event: 'cta_click', consent: 'granted' },
    })
  })

  it('returns ok:true even when ANALYTICS binding is absent', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      { event: 'cta_click', target: 'hero-button' },
      grantedConsentHeaders(),
    )

    mocks.trackLandingEvent.mockResolvedValue(undefined)

    const result = await handler(event as any)

    expect(result).toEqual({ ok: true })
    expect(mocks.trackLandingEvent).toHaveBeenCalledTimes(1)
  })

  it('accepts all client-allowed event names with analytics consent', async () => {
    const allowedEvents = [
      'landing_page_view',
      'cta_click',
      'header_cta_click',
      'footer_link_click',
      'video_play',
      'video_complete',
      'github_click',
    ]

    mocks.trackLandingEvent.mockResolvedValue(undefined)

    for (const name of allowedEvents) {
      const handler = await getEventsHandler()
      const event = makeEvent(
        { event: name },
        grantedConsentHeaders(),
      )

      const result = await handler(event as any)

      expect(result).toEqual({ ok: true })
    }

    expect(mocks.trackLandingEvent).toHaveBeenCalledTimes(allowedEvents.length)
  })

  it('does NOT record when no consent cookie is present (fail closed)', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      { event: 'cta_click', target: 'hero-button' },
      { 'sec-fetch-site': 'same-origin' },
    )

    const result = await handler(event as any)

    expect(result).toEqual({ ok: true })
    expect(mocks.trackLandingEvent).not.toHaveBeenCalled()
    expect(mocks.loggerSet).toHaveBeenCalledWith({
      analytics: { event: 'cta_click', consent: 'denied' },
    })
  })

  it('does NOT record when consent cookie lacks the analytics category', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      { event: 'cta_click', target: 'hero-button' },
      grantedConsentHeaders(['necessary', 'preferences']),
    )

    const result = await handler(event as any)

    expect(result).toEqual({ ok: true })
    expect(mocks.trackLandingEvent).not.toHaveBeenCalled()
    expect(mocks.loggerSet).toHaveBeenCalledWith({
      analytics: { event: 'cta_click', consent: 'denied' },
    })
  })

  it('does NOT record with a stale-revision consent cookie (v:2)', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      { event: 'cta_click', target: 'hero-button' },
      {
        'sec-fetch-site': 'same-origin',
        'cookie': consentCookieHeader({
          v: 2,
          granted: ['necessary', 'analytics'],
          id: 'stale-consent',
          date: '2026-01-01T00:00:00.000Z',
        }),
      },
    )

    const result = await handler(event as any)

    expect(result).toEqual({ ok: true })
    expect(mocks.trackLandingEvent).not.toHaveBeenCalled()
  })

  it('does NOT record with a malformed consent cookie (fail closed)', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      { event: 'cta_click', target: 'hero-button' },
      {
        'sec-fetch-site': 'same-origin',
        'cookie': `${CONSENT_COOKIE_NAME}=${encodeURIComponent('not-json')}`,
      },
    )

    const result = await handler(event as any)

    expect(result).toEqual({ ok: true })
    expect(mocks.trackLandingEvent).not.toHaveBeenCalled()
  })
})
