import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import {
  resetKeyGuideTracking,
  useKeyGuideAnalytics,
} from '../../../app/composables/key-guide-analytics'

const mocks = vi.hoisted(() => {
  return { track: vi.fn() }
})

mockNuxtImport('useLandingAnalytics', () => {
  return () => {
    return { track: mocks.track }
  }
})

describe('useKeyGuideAnalytics', () => {
  beforeEach(() => {
    mocks.track.mockReset()
    resetKeyGuideTracking()
  })

  it('tracks key_guide_open once per provider', () => {
    const { trackGuideOpen } = useKeyGuideAnalytics()

    trackGuideOpen('google')
    trackGuideOpen('google')
    trackGuideOpen('openrouter')

    expect(mocks.track).toHaveBeenCalledTimes(2)
    expect(mocks.track).toHaveBeenNthCalledWith(1, 'key_guide_open', {
      target: 'google',
    })
    expect(mocks.track).toHaveBeenNthCalledWith(2, 'key_guide_open', {
      target: 'openrouter',
    })
  })

  it('tracks a user play with value 1 once per provider', () => {
    const { trackGuideVideoPlay } = useKeyGuideAnalytics()

    trackGuideVideoPlay('google', true)
    trackGuideVideoPlay('google', true)

    expect(mocks.track).toHaveBeenCalledTimes(1)
    expect(mocks.track).toHaveBeenCalledWith('key_guide_video_play', {
      target: 'google',
      value: 1,
    })
  })

  it('tracks an autoplay with value 0 once per provider', () => {
    const { trackGuideVideoPlay } = useKeyGuideAnalytics()

    trackGuideVideoPlay('google', false)
    trackGuideVideoPlay('google', false)

    expect(mocks.track).toHaveBeenCalledTimes(1)
    expect(mocks.track).toHaveBeenCalledWith('key_guide_video_play', {
      target: 'google',
      value: 0,
    })
  })

  it('does not let an autoplay hide a later user play', () => {
    const { trackGuideVideoPlay } = useKeyGuideAnalytics()

    trackGuideVideoPlay('google', false)
    trackGuideVideoPlay('google', true)

    expect(mocks.track).toHaveBeenCalledTimes(2)
    expect(mocks.track).toHaveBeenNthCalledWith(1, 'key_guide_video_play', {
      target: 'google',
      value: 0,
    })
    expect(mocks.track).toHaveBeenNthCalledWith(2, 'key_guide_video_play', {
      target: 'google',
      value: 1,
    })
  })

  it('dedupes plays per provider independently', () => {
    const { trackGuideVideoPlay } = useKeyGuideAnalytics()

    trackGuideVideoPlay('google', true)
    trackGuideVideoPlay('openrouter', true)

    expect(mocks.track).toHaveBeenCalledTimes(2)
  })

  it('tracks key_guide_video_play with value 0 for an autoplay start', () => {
    const { trackGuideVideoPlay } = useKeyGuideAnalytics()

    trackGuideVideoPlay('exa', false)

    expect(mocks.track).toHaveBeenCalledWith('key_guide_video_play', {
      target: 'exa',
      value: 0,
    })
  })

  it('counts open and play independently', () => {
    const { trackGuideOpen, trackGuideVideoPlay } = useKeyGuideAnalytics()

    trackGuideOpen('google')
    trackGuideVideoPlay('google', true)

    expect(mocks.track).toHaveBeenCalledTimes(2)
  })

  it('tracks again after the tracking state is reset', () => {
    const { trackGuideOpen } = useKeyGuideAnalytics()

    trackGuideOpen('google')
    resetKeyGuideTracking()
    trackGuideOpen('google')

    expect(mocks.track).toHaveBeenCalledTimes(2)
  })
})
