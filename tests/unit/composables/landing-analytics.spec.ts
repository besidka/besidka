import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useUtmAttribution } from '../../../app/composables/utm-attribution'
import { useLandingAnalytics } from '../../../app/composables/landing-analytics'

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

mockNuxtImport('$fetch', () => fetchMock)

function lastRequestBody(): Record<string, unknown> {
  const [, options] = fetchMock.mock.calls.at(-1) ?? []

  return options.body
}

describe('useLandingAnalytics utm', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(undefined)
    clearNuxtState('utm-attribution')
  })

  afterEach(() => {
    window.history.replaceState({}, '', '/')
  })

  it('sends sanitized utm with landing_page_view', () => {
    window.history.replaceState(
      {},
      '',
      '/?utm_source=X&utm_campaign=test&utm_medium=bad%20value',
    )

    useLandingAnalytics().track('landing_page_view')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/events',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(lastRequestBody()).toMatchObject({
      event: 'landing_page_view',
      utm: { source: 'x', campaign: 'test' },
    })
  })

  it('prefers first-touch utm over the current location', () => {
    useUtmAttribution().captureUtmFromQuery({
      utm_source: 'first',
      utm_campaign: 'one',
    })
    window.history.replaceState({}, '', '/byok')

    useLandingAnalytics().track('landing_page_view')

    expect(lastRequestBody().utm).toEqual({
      source: 'first',
      campaign: 'one',
    })
  })

  it('omits utm when the page has no utm params', () => {
    window.history.replaceState({}, '', '/?ref=newsletter')

    useLandingAnalytics().track('landing_page_view')

    expect(lastRequestBody().utm).toBeUndefined()
  })

  it('omits utm for non page-view events', () => {
    window.history.replaceState({}, '', '/?utm_source=x')

    useLandingAnalytics().track('cta_click', { target: '/signup' })

    expect(lastRequestBody()).toMatchObject({
      event: 'cta_click',
      target: '/signup',
    })
    expect(lastRequestBody().utm).toBeUndefined()
  })

  it('sends video fields and keepalive when requested', () => {
    useLandingAnalytics().track('video_watch', {
      target: 'google',
      value: 4.2,
      trigger: 'autoplay',
      watchedSeconds: 4.2,
      durationSeconds: 60,
      completionPercent: 10,
      endReason: 'hidden',
    }, { keepalive: true })

    const [, options] = fetchMock.mock.calls.at(-1) ?? []

    expect(options.keepalive).toBe(true)
    expect(options.body).toMatchObject({
      event: 'video_watch',
      target: 'google',
      value: 4.2,
      trigger: 'autoplay',
      watchedSeconds: 4.2,
      durationSeconds: 60,
      completionPercent: 10,
      endReason: 'hidden',
    })
  })

  it('does not set keepalive by default', () => {
    useLandingAnalytics().track('cta_click', { target: '/signup' })

    const [, options] = fetchMock.mock.calls.at(-1) ?? []

    expect(options.keepalive).toBeUndefined()
  })

  it('swallows request failures', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))

    expect(() => {
      useLandingAnalytics().track('landing_page_view')
    }).not.toThrow()

    await Promise.resolve()
  })
})
