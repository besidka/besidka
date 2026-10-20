import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNotCrossSiteRequest } from '~~/server/utils/cross-site-guard'

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
    vi.stubGlobal('assertNotCrossSiteRequest', assertNotCrossSiteRequest)

    vi.stubGlobal('getRequestHeader', (
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
  })

  it('accepts requests where sec-fetch-site is missing', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      { event: 'cta_click' },
      {},
    )

    mocks.trackLandingEvent.mockResolvedValue(undefined)

    const result = await handler(event as any)

    expect(result).toEqual({ ok: true })
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
      { 'sec-fetch-site': 'same-origin' },
    )

    await expect(handler(event as any)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('rejects new_chat_created from public endpoint (400)', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      { event: 'new_chat_created' },
      { 'sec-fetch-site': 'same-origin' },
    )

    await expect(handler(event as any)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('accepts cta_click and returns ok:true even when ANALYTICS binding is absent', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      { event: 'cta_click', path: '/', target: 'hero-button' },
      { 'sec-fetch-site': 'same-origin' },
    )

    mocks.trackLandingEvent.mockResolvedValue(undefined)

    const result = await handler(event as any)

    expect(result).toEqual({ ok: true })
    expect(mocks.trackLandingEvent).toHaveBeenCalledWith(
      'cta_click',
      { path: '/', target: 'hero-button', value: undefined, utm: {} },
      expect.anything(),
    )
    expect(mocks.loggerSet).toHaveBeenCalledExactlyOnceWith({
      analytics: { event: 'cta_click' },
    })
  })

  it('sanitizes utm, logs it under attributes and forwards it', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      {
        event: 'landing_page_view',
        path: '/',
        utm: {
          source: ' Reddit ',
          medium: 'social',
          campaign: 'bad value!',
          content: 'a'.repeat(65),
        },
      },
      { 'sec-fetch-site': 'same-origin' },
    )

    const result = await handler(event as any)

    expect(result).toEqual({ ok: true })
    expect(mocks.loggerSet).toHaveBeenCalledWith({
      attributes: { utm: { source: 'reddit', medium: 'social' } },
    })
    expect(mocks.trackLandingEvent).toHaveBeenCalledWith(
      'landing_page_view',
      {
        path: '/',
        target: undefined,
        value: undefined,
        utm: { source: 'reddit', medium: 'social' },
      },
      expect.anything(),
    )
  })

  it('does not log utm attributes when every utm value is invalid', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      {
        event: 'landing_page_view',
        utm: { source: '<script>', medium: '' },
      },
      { 'sec-fetch-site': 'same-origin' },
    )

    await handler(event as any)

    expect(mocks.loggerSet).toHaveBeenCalledExactlyOnceWith({
      analytics: { event: 'landing_page_view' },
    })
    expect(mocks.trackLandingEvent).toHaveBeenCalledWith(
      'landing_page_view',
      expect.objectContaining({ utm: {} }),
      expect.anything(),
    )
  })

  it('rejects utm values longer than 256 characters (400)', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      { event: 'landing_page_view', utm: { source: 'a'.repeat(257) } },
      { 'sec-fetch-site': 'same-origin' },
    )

    await expect(handler(event as any)).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(mocks.trackLandingEvent).not.toHaveBeenCalled()
  })

  it('rejects a non-object utm payload (400)', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      { event: 'landing_page_view', utm: 'utm_source=reddit' },
      { 'sec-fetch-site': 'same-origin' },
    )

    await expect(handler(event as any)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('rejects unknown client path values (400)', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      { event: 'cta_click', path: '/admin' },
      { 'sec-fetch-site': 'same-origin' },
    )

    await expect(handler(event as any)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('accepts the key guide events from the keys page path', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      {
        event: 'key_guide_video_play',
        path: '/profile/keys',
        target: 'google',
        value: 0,
      },
      { 'sec-fetch-site': 'same-origin' },
    )

    const result = await handler(event as any)

    expect(result).toEqual({ ok: true })
    expect(mocks.trackLandingEvent).toHaveBeenCalledWith(
      'key_guide_video_play',
      { path: '/profile/keys', target: 'google', value: 0, utm: {} },
      expect.anything(),
    )
  })

  it('normalises a trailing slash on the keys page path', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      {
        event: 'key_guide_open',
        path: '/profile/keys/',
        target: 'openrouter',
      },
      { 'sec-fetch-site': 'same-origin' },
    )

    const result = await handler(event as any)

    expect(result).toEqual({ ok: true })
    expect(mocks.trackLandingEvent).toHaveBeenCalledWith(
      'key_guide_open',
      { path: '/profile/keys', target: 'openrouter', value: undefined, utm: {} },
      expect.anything(),
    )
  })

  it('still rejects an unknown path with a trailing slash (400)', async () => {
    const handler = await getEventsHandler()
    const event = makeEvent(
      { event: 'cta_click', path: '/admin/' },
      { 'sec-fetch-site': 'same-origin' },
    )

    await expect(handler(event as any)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  for (const eventName of ['key_guide_open', 'key_guide_video_play']) {
    for (const target of [
      undefined,
      'not-a-provider',
      '__proto__',
      'constructor',
      'toString',
    ]) {
      it(`rejects ${eventName} with target ${String(target)} (400)`,
        async () => {
          const handler = await getEventsHandler()
          const event = makeEvent(
            { event: eventName, path: '/profile/keys', target },
            { 'sec-fetch-site': 'same-origin' },
          )

          await expect(handler(event as any)).rejects.toMatchObject({
            statusCode: 400,
          })
          expect(mocks.trackLandingEvent).not.toHaveBeenCalled()
        })
    }
  }

  it('accepts all client-allowed event names', async () => {
    const allowedEvents = [
      'landing_page_view',
      'cta_click',
      'header_cta_click',
      'footer_link_click',
      'video_play',
      'video_complete',
      'github_click',
      'key_guide_open',
      'key_guide_video_play',
    ]

    mocks.trackLandingEvent.mockResolvedValue(undefined)

    for (const name of allowedEvents) {
      const handler = await getEventsHandler()
      const event = makeEvent(
        { event: name, target: 'google' },
        { 'sec-fetch-site': 'same-origin' },
      )

      const result = await handler(event as any)

      expect(result).toEqual({ ok: true })
    }
  })
})
