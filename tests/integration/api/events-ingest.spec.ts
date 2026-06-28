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
      { path: '/', target: 'hero-button', value: undefined },
      expect.anything(),
    )
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

  it('accepts all client-allowed event names', async () => {
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
        { 'sec-fetch-site': 'same-origin' },
      )

      const result = await handler(event as any)

      expect(result).toEqual({ ok: true })
    }
  })
})
