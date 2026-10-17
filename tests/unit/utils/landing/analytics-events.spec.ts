import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  writeDataPoint: vi.fn(),
}))

vi.mock('nuxt/server', () => ({
  getRequestHeader: (
    event: { headers: Record<string, string> },
    name: string,
  ) => {
    return event.headers[name]
  },
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({ set: mocks.loggerSet }),
}))

const DESKTOP_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) '
  + 'AppleWebKit/605.1.15 Safari/605.1.15'

function makeRequestEvent(headers: Record<string, string> = {}) {
  return {
    headers: {
      'user-agent': DESKTOP_USER_AGENT,
      ...headers,
    },
    url: new URL('https://besidka.com/'),
    context: { cf: { country: 'PL' } },
  }
}

async function importTracker() {
  return import('../../../../server/utils/landing/analytics-events')
}

describe('trackLandingEvent', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    vi.stubGlobal('useAnalytics', () => ({
      writeDataPoint: mocks.writeDataPoint,
    }))
  })

  it('keeps the original five blobs first and appends utm blobs', async () => {
    const { trackLandingEvent } = await importTracker()

    trackLandingEvent(
      'landing_page_view',
      {
        path: '/',
        target: 'hero',
        utm: {
          source: 'reddit',
          medium: 'social',
          campaign: 'launch',
          content: 'banner',
        },
      },
      makeRequestEvent() as never,
    )

    expect(mocks.writeDataPoint).toHaveBeenCalledExactlyOnceWith({
      blobs: [
        'landing_page_view',
        '/',
        'hero',
        'PL',
        'desktop',
        'launch',
        'reddit',
        'social',
        'banner',
      ],
      doubles: [0],
      indexes: ['landing_page_view'],
    })
  })

  it('fills missing utm blobs with none', async () => {
    const { trackLandingEvent } = await importTracker()

    trackLandingEvent(
      'cta_click',
      { path: '/', target: 'signup', value: 3, utm: { source: 'x' } },
      makeRequestEvent({
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile',
      }) as never,
    )

    expect(mocks.writeDataPoint).toHaveBeenCalledExactlyOnceWith({
      blobs: [
        'cta_click',
        '/',
        'signup',
        'PL',
        'mobile',
        'none',
        'x',
        'none',
        'none',
      ],
      doubles: [3],
      indexes: ['cta_click'],
    })
  })

  it('writes none for every utm blob when no utm is passed', async () => {
    const { trackLandingEvent } = await importTracker()

    trackLandingEvent('new_chat_created', undefined, makeRequestEvent() as never)

    const [dataPoint] = mocks.writeDataPoint.mock.calls[0]!

    expect(dataPoint.blobs).toEqual([
      'new_chat_created',
      '/',
      '',
      'PL',
      'desktop',
      'none',
      'none',
      'none',
      'none',
    ])
  })

  it('skips bots', async () => {
    const { trackLandingEvent } = await importTracker()

    trackLandingEvent(
      'landing_page_view',
      { utm: { source: 'reddit' } },
      makeRequestEvent({ 'user-agent': 'Googlebot/2.1' }) as never,
    )

    expect(mocks.writeDataPoint).not.toHaveBeenCalled()
  })

  it('logs write failures without throwing', async () => {
    mocks.writeDataPoint.mockImplementation(() => {
      throw new Error('engine down')
    })

    const { trackLandingEvent } = await importTracker()

    expect(() => {
      trackLandingEvent('cta_click', undefined, makeRequestEvent() as never)
    }).not.toThrow()
    expect(mocks.loggerSet).toHaveBeenCalledExactlyOnceWith({
      analytics: { event: 'cta_click' },
      attributes: { analytics: { error: 'engine down' } },
    })
  })
})
