import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import VideoPlayer
  from '../../../../app/components/landing/VideoPlayer.client.vue'

interface FakeInstance {
  emit: (event: string) => void
  destroyed: boolean
}

const mocks = vi.hoisted(() => {
  return {
    track: vi.fn(),
    generate: vi.fn(),
    instances: [] as FakeInstance[],
    lastOptions: null as Record<string, unknown> | null,
    shouldThrow: false,
    isAllowed: vi.fn((_categoryId: string) => true),
    onConsentChange: vi.fn(),
  }
})

vi.mock('plyr', () => {
  class FakePlyr {
    handlers: Record<string, ((...args: unknown[]) => void)[]> = {}
    source: unknown = null
    destroyed = false
    currentTime = 0
    duration = 100
    ended = false

    constructor(_element: unknown, options: unknown) {
      if (mocks.shouldThrow) {
        throw new Error('plyr init failed')
      }

      mocks.lastOptions = options as Record<string, unknown>
      mocks.instances.push(this as unknown as FakeInstance)
    }

    on(event: string, callback: (...args: unknown[]) => void) {
      (this.handlers[event] ||= []).push(callback)
    }

    emit(event: string) {
      (this.handlers[event] || []).forEach((callback) => {
        return callback()
      })
    }

    destroy() {
      this.destroyed = true
    }
  }

  return { default: FakePlyr }
})

mockNuxtImport('useLandingAnalytics', () => {
  return () => {
    return { track: mocks.track }
  }
})

mockNuxtImport('useLandingVideoThumbnails', () => {
  return () => {
    return { generate: mocks.generate }
  }
})

mockNuxtImport('useCookieConsent', () => {
  return () => {
    return {
      isAllowed: mocks.isAllowed,
      onConsentChange: mocks.onConsentChange,
    }
  }
})

describe('VideoPlayer.client.vue', () => {
  beforeEach(() => {
    mocks.track.mockReset()
    mocks.generate.mockReset().mockResolvedValue(null)
    mocks.instances.length = 0
    mocks.lastOptions = null
    mocks.shouldThrow = false
    mocks.isAllowed.mockReset().mockReturnValue(true)
    mocks.onConsentChange.mockReset()
  })

  it(
    'enables Plyr storage when preferences consent is granted',
    async () => {
      mocks.isAllowed.mockReturnValue(true)

      await mountSuspended(VideoPlayer, {
        props: { src: '/videos/demo.mp4', thumbnails: false },
      })

      await flushPromises()

      const options = mocks.lastOptions as Record<string, never>

      expect(mocks.isAllowed).toHaveBeenCalledWith('preferences')
      expect(options.storage).toMatchObject({ enabled: true, key: 'plyr' })
    },
  )

  it(
    'disables Plyr storage when preferences consent is denied',
    async () => {
      mocks.isAllowed.mockReturnValue(false)

      await mountSuspended(VideoPlayer, {
        props: { src: '/videos/demo.mp4', thumbnails: false },
      })

      await flushPromises()

      const options = mocks.lastOptions as Record<string, never>

      expect(options.storage).toMatchObject({ enabled: false, key: 'plyr' })
    },
  )

  it('builds options with parsed markers and a sorted quality ladder',
    async () => {
      await mountSuspended(VideoPlayer, {
        props: {
          src: '/videos/demo.mp4',
          qualities: [
            { src: '/videos/demo-1080.mp4', size: 1080 },
            { src: '/videos/demo.mp4', size: 720 },
            { src: '/videos/demo-360.mp4', size: 360 },
          ],
          markers: [
            { time: '0:08', label: 'End' },
            { time: '0:02', label: 'Start' },
          ],
          thumbnails: false,
        },
      })

      await flushPromises()

      expect(mocks.instances).toHaveLength(1)

      const options = mocks.lastOptions as Record<string, never>

      expect(options.quality).toMatchObject({
        default: 720,
        options: [1080, 720, 360],
      })
      expect(options.markers).toMatchObject({
        enabled: true,
        points: [
          { time: 2, label: 'Start' },
          { time: 8, label: 'End' },
        ],
      })
    })

  it('reports a watch session on pause with the user trigger', async () => {
    await mountSuspended(VideoPlayer, {
      props: { src: '/videos/demo.mp4', thumbnails: false },
    })

    await flushPromises()

    const player = mocks.instances[0] as unknown as {
      currentTime: number
      emit: (event: string) => void
    }

    player.emit('play')

    for (const second of [0.5, 1, 1.5, 2]) {
      player.currentTime = second
      player.emit('timeupdate')
    }

    player.emit('pause')

    expect(mocks.track).toHaveBeenCalledWith(
      'video_watch',
      {
        target: 'demo',
        value: 2,
        trigger: 'user',
        watchedSeconds: 2,
        durationSeconds: 100,
        completionPercent: 2,
        endReason: 'pause',
      },
      { keepalive: false },
    )
  })

  it('reports ended when pause fires at the end of playback', async () => {
    await mountSuspended(VideoPlayer, {
      props: { src: '/videos/demo.mp4', thumbnails: false },
    })

    await flushPromises()

    const player = mocks.instances[0] as unknown as {
      currentTime: number
      duration: number
      ended: boolean
      emit: (event: string) => void
    }

    player.duration = 3
    player.emit('play')

    for (const second of [1, 2, 3]) {
      player.currentTime = second
      player.emit('timeupdate')
    }

    player.ended = true
    player.emit('pause')
    player.emit('ended')

    const watchCalls = mocks.track.mock.calls.filter((call) => {
      return call[0] === 'video_watch'
    })

    expect(watchCalls).toHaveLength(1)
    expect(watchCalls[0]![1]).toMatchObject({
      endReason: 'ended',
      completionPercent: 100,
    })
  })

  it('tracks a key guide play when a guide provider is set', async () => {
    await mountSuspended(VideoPlayer, {
      props: {
        src: '/videos/key.mp4',
        thumbnails: false,
        guideProvider: 'google',
      },
    })

    await flushPromises()

    mocks.instances[0]!.emit('play')
    mocks.instances[0]!.emit('ended')

    expect(mocks.track).toHaveBeenCalledWith('key_guide_video_play', {
      target: 'google',
      value: 1,
      trigger: 'user',
    })
    expect(mocks.track).toHaveBeenCalledWith(
      'video_complete',
      { target: 'google' },
    )
    expect(mocks.track).not.toHaveBeenCalledWith(
      'video_play',
      expect.anything(),
    )
  })

  it('tracks video_play once and video_complete on ended', async () => {
    await mountSuspended(VideoPlayer, {
      props: { src: '/videos/demo.mp4', thumbnails: false },
    })

    await flushPromises()

    const player = mocks.instances[0]!

    player.emit('play')
    player.emit('play')
    player.emit('ended')

    const playCalls = mocks.track.mock.calls.filter((call) => {
      return call[0] === 'video_play'
    })

    expect(playCalls).toHaveLength(1)
    expect(mocks.track).toHaveBeenCalledWith('video_play', {
      target: 'demo',
      value: 1,
      trigger: 'user',
    })
    expect(mocks.track).toHaveBeenCalledWith(
      'video_complete',
      { target: 'demo' },
    )
  })

  it('sets preload to metadata on the video element', async () => {
    const wrapper = await mountSuspended(VideoPlayer, {
      props: { src: '/videos/demo.mp4', thumbnails: true },
    })

    await flushPromises()

    expect(wrapper.find('video').attributes('preload')).toBe('metadata')
  })

  it('restores preload metadata when Plyr swaps the media element',
    async () => {
      const wrapper = await mountSuspended(VideoPlayer, {
        props: { src: '/videos/demo.mp4' },
      })

      await flushPromises()

      const video = wrapper.find('video').element

      video.removeAttribute('preload')
      mocks.instances[0]!.emit('ready')

      expect(video.preload).toBe('metadata')
    })

  it('does not generate thumbnails on mount', async () => {
    await mountSuspended(VideoPlayer, {
      props: { src: '/videos/demo.mp4', thumbnails: true },
    })

    await flushPromises()

    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('does not generate thumbnails on play', async () => {
    await mountSuspended(VideoPlayer, {
      props: { src: '/videos/demo.mp4', thumbnails: true },
    })

    await flushPromises()

    mocks.instances[0]!.emit('play')
    mocks.instances[0]!.emit('play')
    await flushPromises()

    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('requests thumbnails from the default-quality source with an abort '
    + 'signal on progress bar pointerenter', async () => {
    const wrapper = await mountSuspended(VideoPlayer, {
      props: {
        src: '/videos/demo.mp4',
        qualities: [
          { src: '/videos/demo-1080.mp4', size: 1080 },
          { src: '/videos/demo.mp4', size: 720 },
        ],
        thumbnails: true,
      },
    })

    await flushPromises()

    const progress = document.createElement('div')

    progress.className = 'plyr__progress'
    wrapper.find('.js-landing-player').element.append(progress)

    mocks.instances[0]!.emit('ready')
    progress.dispatchEvent(new Event('pointerenter'))
    await flushPromises()

    expect(mocks.generate).toHaveBeenCalledTimes(1)
    expect(mocks.generate).toHaveBeenCalledWith(
      '/videos/demo.mp4',
      { count: 12, signal: expect.any(AbortSignal) },
    )
  })

  it('aborts thumbnail generation on unmount', async () => {
    const wrapper = await mountSuspended(VideoPlayer, {
      props: { src: '/videos/demo.mp4', thumbnails: true },
    })

    await flushPromises()

    const progress = document.createElement('div')

    progress.className = 'plyr__progress'
    wrapper.find('.js-landing-player').element.append(progress)

    mocks.instances[0]!.emit('ready')
    progress.dispatchEvent(new Event('pointerenter'))
    await flushPromises()

    const { signal } = mocks.generate.mock.calls[0]![1] as {
      signal: AbortSignal
    }

    expect(signal.aborted).toBe(false)

    wrapper.unmount()

    expect(signal.aborted).toBe(true)
  })

  it('generates thumbnails once on the first progress bar pointerenter',
    async () => {
      const wrapper = await mountSuspended(VideoPlayer, {
        props: { src: '/videos/demo.mp4', thumbnails: true },
      })

      await flushPromises()

      const progress = document.createElement('div')

      progress.className = 'plyr__progress'
      wrapper.find('.js-landing-player').element.append(progress)

      mocks.instances[0]!.emit('ready')

      progress.dispatchEvent(new Event('pointerenter'))
      progress.dispatchEvent(new Event('pointerenter'))
      await flushPromises()

      expect(mocks.generate).toHaveBeenCalledTimes(1)
    })

  it('generates thumbnails when the progress bar receives focus',
    async () => {
      const wrapper = await mountSuspended(VideoPlayer, {
        props: { src: '/videos/demo.mp4', thumbnails: true },
      })

      await flushPromises()

      const progress = document.createElement('div')

      progress.className = 'plyr__progress'
      wrapper.find('.js-landing-player').element.append(progress)

      mocks.instances[0]!.emit('ready')

      progress.dispatchEvent(new Event('focusin'))
      await flushPromises()

      expect(mocks.generate).toHaveBeenCalledTimes(1)
    })

  it('skips thumbnail generation when disabled', async () => {
    const wrapper = await mountSuspended(VideoPlayer, {
      props: { src: '/videos/demo.mp4', thumbnails: false },
    })

    await flushPromises()

    const progress = document.createElement('div')

    progress.className = 'plyr__progress'
    wrapper.find('.js-landing-player').element.append(progress)

    mocks.instances[0]!.emit('ready')
    progress.dispatchEvent(new Event('pointerenter'))
    await flushPromises()

    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('shows the poster under the spinner while loading', async () => {
    const wrapper = await mountSuspended(VideoPlayer, {
      props: { src: '/videos/demo.mp4', poster: '/videos/demo.webp' },
    })

    await flushPromises()

    const poster = wrapper.get('[data-testid="player-loading-poster"]')

    expect(poster.attributes('src')).toBe('/videos/demo.webp')
    expect(poster.attributes('alt')).toBe('')
    expect(poster.classes()).toContain('object-cover')
    expect(wrapper.find('.skeleton').exists()).toBe(false)
    expect(wrapper.find('.animate-spin').exists()).toBe(true)
  })

  it('keeps the grey skeleton while loading without a poster', async () => {
    const wrapper = await mountSuspended(VideoPlayer, {
      props: { src: '/videos/demo.mp4' },
    })

    await flushPromises()

    expect(wrapper.find('[data-testid="player-loading-poster"]').exists())
      .toBe(false)
    expect(wrapper.find('.skeleton').exists()).toBe(true)
    expect(wrapper.find('.animate-spin').exists()).toBe(true)
  })

  it('removes the loading overlay once Plyr is ready', async () => {
    const wrapper = await mountSuspended(VideoPlayer, {
      props: { src: '/videos/demo.mp4', poster: '/videos/demo.webp' },
    })

    await flushPromises()
    mocks.instances[0]!.emit('ready')
    await flushPromises()

    expect(wrapper.find('[data-testid="player-loading-poster"]').exists())
      .toBe(false)
    expect(wrapper.find('.animate-spin').exists()).toBe(false)
  })

  it('falls back to native controls when Plyr throws', async () => {
    mocks.shouldThrow = true

    const wrapper = await mountSuspended(VideoPlayer, {
      props: { src: '/videos/demo.mp4', thumbnails: false },
    })

    await flushPromises()

    expect(mocks.instances).toHaveLength(0)
    expect(wrapper.find('video').element.controls).toBe(true)
  })
})
