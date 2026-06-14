import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useCookieConsent,
} from '../../../modules/cookie-consent/src/runtime/composables/consent'
import {
  clearPendingLandingAnalytics,
  flushPendingLandingAnalytics,
  useLandingAnalytics,
} from '../../../app/composables/landing-analytics'

/**
 * Sequential lifecycle tests for the landing-analytics queue-and-flush gate.
 *
 * Per project memory, modules/* runtime (the cookie-consent module) lives in a
 * dual module graph: vi.mock('#imports') breaks it. So this spec drives the
 * REAL useCookieConsent (imported directly from the module runtime path, never
 * via #imports) to flip analytics consent on/off, exactly like
 * preference-storage.spec.ts. Only $fetch is stubbed, to observe the outgoing
 * POST /api/v1/events calls without touching the network. The module-scoped
 * pendingEvents queue persists across track() call sites, so each test resets
 * it via clearPendingLandingAnalytics() to stay independent.
 */

const fetchMock = vi.fn(() => Promise.resolve({ ok: true }))

function lastEventPayloads() {
  return fetchMock.mock.calls.map(call => (call[1] as { body: unknown }).body)
}

beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('$fetch', fetchMock)

  // Start every test from a clean queue and denied analytics state.
  clearPendingLandingAnalytics()
  useCookieConsent().withdrawAll()
})

afterEach(() => {
  clearPendingLandingAnalytics()
})

describe('useLandingAnalytics (queue-and-flush gate)', () => {
  it('sends immediately when analytics consent is already granted', () => {
    useCookieConsent().allow(['necessary', 'analytics'])

    const { track } = useLandingAnalytics()

    track('cta_click', { target: 'hero-button' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/events',
      expect.objectContaining({
        method: 'POST',
        body: { event: 'cta_click', target: 'hero-button', value: undefined },
      }),
    )
  })

  it('queues events instead of sending while analytics is denied', () => {
    const { track } = useLandingAnalytics()

    track('landing_page_view')
    track('cta_click', { target: 'hero-button' })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('flushes queued events once analytics consent is granted', () => {
    const { track } = useLandingAnalytics()

    track('landing_page_view')
    track('video_play', { target: 'demo' })

    expect(fetchMock).not.toHaveBeenCalled()

    flushPendingLandingAnalytics()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(lastEventPayloads()).toEqual([
      { event: 'landing_page_view', target: undefined, value: undefined },
      { event: 'video_play', target: 'demo', value: undefined },
    ])
  })

  it('drains the queue on flush so a second flush sends nothing', () => {
    const { track } = useLandingAnalytics()

    track('cta_click', { target: 'first' })

    flushPendingLandingAnalytics()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    flushPendingLandingAnalytics()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('discards queued events when analytics is denied', () => {
    const { track } = useLandingAnalytics()

    track('cta_click', { target: 'discard-me' })

    clearPendingLandingAnalytics()
    flushPendingLandingAnalytics()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caps the queue at 50 events, dropping the oldest', () => {
    const { track } = useLandingAnalytics()

    for (let index = 0; index < 60; index += 1) {
      track('cta_click', { target: `target-${index}`, value: index })
    }

    flushPendingLandingAnalytics()

    expect(fetchMock).toHaveBeenCalledTimes(50)

    const payloads = lastEventPayloads() as Array<{ value: number }>

    // The oldest 10 (values 0-9) were dropped via shift(); 10-59 survive.
    expect(payloads[0].value).toBe(10)
    expect(payloads[payloads.length - 1].value).toBe(59)
  })
})
