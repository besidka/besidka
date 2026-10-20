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
    expect(mocks.loggerSet).toHaveBeenNthCalledWith(1, {
      analytics: { event: 'cta_click' },
    })
    expect(mocks.loggerSet).toHaveBeenNthCalledWith(2, {
      attributes: {
        analytics: { target: 'hero-button', surface: 'home', path: '/' },
      },
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
      attributes: {
        analytics: { surface: 'home', path: '/' },
      },
    })
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

  describe('surfaces and paths', () => {
    const surfaceCases = [
      ['/', 'home'],
      ['/byok', 'byok'],
      ['/profile/keys', 'keys'],
      ['/guides/gemini-api-key', 'guide'],
      ['/guides/gemini-api-key/', 'guide'],
      ['/privacy-policy', 'legal'],
      ['/terms-of-use', 'legal'],
      ['/cookie-policy', 'legal'],
    ] as const

    for (const [path, surface] of surfaceCases) {
      it(`logs surface ${surface} for ${path}`, async () => {
        const handler = await getEventsHandler()
        const event = makeEvent(
          { event: 'cta_click', path },
          { 'sec-fetch-site': 'same-origin' },
        )

        await handler(event as any)

        expect(mocks.loggerSet).toHaveBeenCalledWith({
          attributes: {
            analytics: {
              surface,
              path: path.length > 1 && path.endsWith('/')
                ? path.slice(0, -1)
                : path,
            },
          },
        })
      })
    }

    for (const path of [
      '/guides/',
      '/guides/UPPER',
      '/guides/a/b',
      `/guides/${'a'.repeat(65)}`,
      '/guides/with_underscore',
      '/byok/extra',
    ]) {
      it(`rejects path ${path} (400)`, async () => {
        const handler = await getEventsHandler()
        const event = makeEvent(
          { event: 'cta_click', path },
          { 'sec-fetch-site': 'same-origin' },
        )

        await expect(handler(event as any)).rejects.toMatchObject({
          statusCode: 400,
        })
      })
    }
  })

  describe('video events', () => {
    const watchBody = {
      event: 'video_watch',
      path: '/profile/keys',
      target: 'google',
      value: 12.3,
      trigger: 'autoplay',
      watchedSeconds: 12.3,
      durationSeconds: 60,
      completionPercent: 40,
      endReason: 'pause',
    }

    async function send(body: Record<string, unknown>) {
      const handler = await getEventsHandler()

      return handler(makeEvent(
        body,
        { 'sec-fetch-site': 'same-origin' },
      ) as any)
    }

    it('logs trigger for key_guide_video_play', async () => {
      await send({
        event: 'key_guide_video_play',
        path: '/guides/gemini-api-key',
        target: 'google',
        value: 0,
        trigger: 'autoplay',
      })

      expect(mocks.loggerSet).toHaveBeenCalledWith({
        attributes: {
          analytics: {
            target: 'google',
            surface: 'guide',
            path: '/guides/gemini-api-key',
            trigger: 'autoplay',
          },
        },
      })
    })

    it('logs trigger for the home video_play', async () => {
      await send({
        event: 'video_play',
        path: '/',
        target: 'demo',
        value: 1,
        trigger: 'user',
      })

      expect(mocks.loggerSet).toHaveBeenCalledWith({
        attributes: {
          analytics: {
            target: 'demo',
            surface: 'home',
            path: '/',
            trigger: 'user',
          },
        },
      })
    })

    it('does not log trigger or watch fields for other events', async () => {
      await send({
        event: 'cta_click',
        path: '/',
        trigger: 'user',
        watchedSeconds: 5,
        endReason: 'pause',
      })

      expect(mocks.loggerSet).toHaveBeenCalledWith({
        attributes: { analytics: { surface: 'home', path: '/' } },
      })
    })

    it('rejects an unknown trigger (400)', async () => {
      await expect(send({
        event: 'video_play',
        target: 'demo',
        trigger: 'robot',
      })).rejects.toMatchObject({ statusCode: 400 })
    })

    for (const trigger of ['auto', 'user']) {
      it(`logs trigger ${trigger} for key_guide_open`, async () => {
        const result = await send({
          event: 'key_guide_open',
          path: '/profile/keys',
          target: 'google',
          value: trigger === 'user' ? 1 : 0,
          trigger,
        })

        expect(result).toEqual({ ok: true })
        expect(mocks.loggerSet).toHaveBeenCalledWith({
          attributes: {
            analytics: {
              target: 'google',
              surface: 'keys',
              path: '/profile/keys',
              trigger,
            },
          },
        })
        expect(mocks.trackLandingEvent).toHaveBeenCalledWith(
          'key_guide_open',
          expect.objectContaining({
            target: 'google',
            value: trigger === 'user' ? 1 : 0,
          }),
          expect.anything(),
        )
      })
    }

    it('rejects trigger autoplay for key_guide_open (400)', async () => {
      await expect(send({
        event: 'key_guide_open',
        path: '/profile/keys',
        target: 'google',
        trigger: 'autoplay',
      })).rejects.toMatchObject({ statusCode: 400 })
      expect(mocks.trackLandingEvent).not.toHaveBeenCalled()
    })

    for (const eventName of [
      'video_play',
      'key_guide_video_play',
      'video_watch',
    ]) {
      it(`rejects trigger auto for ${eventName} (400)`, async () => {
        await expect(send({
          ...watchBody,
          event: eventName,
          trigger: 'auto',
        })).rejects.toMatchObject({ statusCode: 400 })
        expect(mocks.trackLandingEvent).not.toHaveBeenCalled()
      })
    }

    it('accepts video_watch and logs every watch field', async () => {
      const result = await send(watchBody)

      expect(result).toEqual({ ok: true })
      expect(mocks.loggerSet).toHaveBeenCalledWith({
        attributes: {
          analytics: {
            target: 'google',
            surface: 'keys',
            path: '/profile/keys',
            trigger: 'autoplay',
            watchedSeconds: 12.3,
            durationSeconds: 60,
            completionPercent: 40,
            endReason: 'pause',
          },
        },
      })
      expect(mocks.trackLandingEvent).toHaveBeenCalledWith(
        'video_watch',
        expect.objectContaining({
          path: '/profile/keys',
          target: 'google',
          value: 12.3,
        }),
        expect.anything(),
      )
    })

    it('accepts video_watch for the home demo target', async () => {
      const result = await send({
        ...watchBody,
        path: '/',
        target: 'demo',
        trigger: 'user',
      })

      expect(result).toEqual({ ok: true })
    })

    it('uses watchedSeconds as the value when value is omitted', async () => {
      await send({ ...watchBody, value: undefined, watchedSeconds: 7.26 })

      expect(mocks.trackLandingEvent).toHaveBeenCalledWith(
        'video_watch',
        expect.objectContaining({ value: 7.3 }),
        expect.anything(),
      )
    })

    for (const target of [undefined, 'nope', '__proto__', 'Demo']) {
      it(`rejects video_watch with target ${String(target)} (400)`,
        async () => {
          await expect(send({ ...watchBody, target }))
            .rejects.toMatchObject({ statusCode: 400 })
          expect(mocks.trackLandingEvent).not.toHaveBeenCalled()
        })
    }

    for (const field of [
      'trigger',
      'watchedSeconds',
      'durationSeconds',
      'completionPercent',
      'endReason',
    ]) {
      it(`rejects video_watch without ${field} (400)`, async () => {
        await expect(send({ ...watchBody, [field]: undefined }))
          .rejects.toMatchObject({ statusCode: 400 })
      })
    }

    const invalidWatchValues: Array<[string, unknown]> = [
      ['watchedSeconds', -1],
      ['watchedSeconds', 86401],
      ['durationSeconds', 86401],
      ['durationSeconds', Number.NaN],
      ['completionPercent', 101],
      ['completionPercent', -1],
      ['completionPercent', 50.5],
      ['endReason', 'crash'],
    ]

    for (const [field, invalidValue] of invalidWatchValues) {
      it(`rejects ${field} ${String(invalidValue)} (400)`, async () => {
        await expect(send({ ...watchBody, [field]: invalidValue }))
          .rejects.toMatchObject({ statusCode: 400 })
      })
    }

    it('rejects watchedSeconds more than a second above durationSeconds',
      async () => {
        await expect(send({
          ...watchBody,
          watchedSeconds: 61.5,
          durationSeconds: 60,
        })).rejects.toMatchObject({ statusCode: 400 })
        expect(mocks.trackLandingEvent).not.toHaveBeenCalled()
      })

    it('accepts watchedSeconds within a second of durationSeconds',
      async () => {
        const result = await send({
          ...watchBody,
          watchedSeconds: 61,
          durationSeconds: 60,
        })

        expect(result).toEqual({ ok: true })
      })

    it('accepts the offscreen end reason and logs it', async () => {
      await send({ ...watchBody, endReason: 'offscreen' })

      expect(mocks.loggerSet).toHaveBeenCalledWith({
        attributes: {
          analytics: expect.objectContaining({ endReason: 'offscreen' }),
        },
      })
    })

    it('logs watched and duration seconds rounded to a tenth', async () => {
      await send({
        ...watchBody,
        watchedSeconds: 12.3456,
        durationSeconds: 38.5049,
      })

      expect(mocks.loggerSet).toHaveBeenCalledWith({
        attributes: {
          analytics: expect.objectContaining({
            watchedSeconds: 12.3,
            durationSeconds: 38.5,
          }),
        },
      })
    })

    it('omits a malformed target of another event from the log',
      async () => {
        await send({ event: 'cta_click', path: '/', target: 'Hero <b>CTA' })

        expect(mocks.trackLandingEvent).toHaveBeenCalledWith(
          'cta_click',
          expect.objectContaining({ target: 'Hero <b>CTA' }),
          expect.anything(),
        )
        expect(mocks.loggerSet).toHaveBeenCalledWith({
          attributes: { analytics: { surface: 'home', path: '/' } },
        })
      })

    it('accepts the boundary watch values', async () => {
      const result = await send({
        ...watchBody,
        watchedSeconds: 0,
        durationSeconds: 86400,
        completionPercent: 100,
        endReason: 'unmount',
      })

      expect(result).toEqual({ ok: true })
    })
  })
})
