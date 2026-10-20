import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import GuideVideo
  from '../../../../../app/components/Profile/Keys/GuideVideo.client.vue'

interface FakePlayer {
  paused: boolean
  pip: boolean
  destroyed: boolean
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  emit: (event: string) => void
}

interface ObserverInstance {
  callback: IntersectionObserverCallback
}

const mocks = vi.hoisted(() => {
  return {
    trackGuideVideoPlay: vi.fn(),
    generate: vi.fn(),
    players: [] as FakePlayer[],
    lastOptions: null as Record<string, unknown> | null,
    shouldThrow: false,
    observers: [] as ObserverInstance[],
  }
})

vi.mock('plyr', () => {
  class FakePlyr {
    handlers: Record<string, (() => void)[]> = {}
    paused = true
    pip = false
    destroyed = false

    constructor(_element: unknown, options: unknown) {
      if (mocks.shouldThrow) {
        throw new Error('plyr init failed')
      }

      mocks.lastOptions = options as Record<string, unknown>
      mocks.players.push(this as unknown as FakePlayer)
    }

    on(event: string, callback: () => void) {
      (this.handlers[event] ||= []).push(callback)
    }

    emit(event: string) {
      (this.handlers[event] || []).forEach((callback) => {
        return callback()
      })
    }

    play = vi.fn(async () => {
      this.paused = false
      this.emit('play')
      this.emit('playing')
    })

    pause = vi.fn(() => {
      this.paused = true
      this.emit('pause')
    })

    destroy() {
      this.destroyed = true
    }
  }

  return { default: FakePlyr }
})

mockNuxtImport('useKeyGuideAnalytics', () => {
  return () => {
    return {
      trackGuideOpen: vi.fn(),
      trackGuideVideoPlay: mocks.trackGuideVideoPlay,
    }
  }
})

mockNuxtImport('useLandingVideoThumbnails', () => {
  return () => {
    return { generate: mocks.generate }
  }
})

function stubMotionPreference(prefersReducedMotion: boolean) {
  vi.stubGlobal('matchMedia', vi.fn(() => {
    return { matches: prefersReducedMotion }
  }))
}

function setVisibility(isIntersecting: boolean) {
  mocks.observers.at(-1)!.callback(
    [{ isIntersecting } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  )
}

async function mountVideo(extraProps: Record<string, unknown> = {}) {
  const wrapper = await mountSuspended(GuideVideo, {
    props: {
      provider: 'google',
      src: '/videos/key-guide-google.mp4',
      poster: '/key-guides/google.webp',
      label: 'Creating a key',
      ...extraProps,
    },
  })

  await flushPromises()

  return wrapper
}

describe('Profile/Keys/GuideVideo.client', () => {
  beforeEach(() => {
    mocks.trackGuideVideoPlay.mockReset()
    mocks.players.length = 0
    mocks.observers.length = 0
    mocks.lastOptions = null
    mocks.shouldThrow = false
    mocks.generate.mockReset().mockResolvedValue(null)

    class FakeIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        mocks.observers.push({ callback })
      }

      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
      takeRecords = vi.fn(() => {
        return []
      })
    }

    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    stubMotionPreference(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders a muted, looping, non-preloading video with a poster and '
    + 'an accessible name', async () => {
    const wrapper = await mountVideo()
    const video = wrapper.get('video')

    expect(video.attributes('preload')).toBe('none')
    expect(video.attributes('aria-label')).toBe('Creating a key')
    expect(video.attributes('poster')).toBe('/key-guides/google.webp')
    expect(video.attributes('src')).toBe('/videos/key-guide-google.mp4')
    expect((video.element as HTMLVideoElement).muted).toBe(true)
    expect(video.element.hasAttribute('loop')).toBe(true)
    expect(video.element.hasAttribute('playsinline')).toBe(true)
  })

  it('creates a muted looping Plyr instance without storage', async () => {
    await mountVideo()

    expect(mocks.lastOptions).toMatchObject({
      muted: true,
      loop: { active: true },
      storage: { enabled: false },
    })
  })

  it('offers picture-in-picture and never disables it on the video',
    async () => {
      const wrapper = await mountVideo()

      expect(mocks.lastOptions!.controls).toEqual([
        'play-large',
        'play',
        'progress',
        'mute',
        'pip',
        'fullscreen',
      ])
      expect(wrapper.get('video').element.hasAttribute(
        'disablepictureinpicture',
      )).toBe(false)
    })

  it('passes parsed chapter markers to Plyr', async () => {
    await mountVideo({
      markers: [
        { time: '0:12', label: 'Copy your key' },
        { time: '0:00', label: 'Open the page' },
      ],
    })

    expect(mocks.lastOptions!.markers).toEqual({
      enabled: true,
      points: [
        { time: 0, label: 'Open the page' },
        { time: 12, label: 'Copy your key' },
      ],
    })
  })

  it('disables markers when the guide has none', async () => {
    await mountVideo()

    expect(mocks.lastOptions!.markers).toEqual({
      enabled: false,
      points: [],
    })
  })

  it('does not generate thumbnails until the progress bar is used',
    async () => {
      await mountVideo()

      mocks.players[0]!.emit('ready')
      await flushPromises()

      expect(mocks.generate).not.toHaveBeenCalled()
    })

  it('generates thumbnails once on the first progress bar pointerenter',
    async () => {
      const wrapper = await mountVideo()
      const progress = document.createElement('div')

      progress.className = 'plyr__progress'
      wrapper.element.append(progress)

      mocks.players[0]!.emit('ready')
      progress.dispatchEvent(new Event('pointerenter'))
      progress.dispatchEvent(new Event('pointerenter'))
      await flushPromises()

      expect(mocks.generate).toHaveBeenCalledExactlyOnceWith(
        '/videos/key-guide-google.mp4',
        { count: 12, signal: expect.any(AbortSignal) },
      )
    })

  it('aborts thumbnail generation on unmount', async () => {
    const wrapper = await mountVideo()
    const progress = document.createElement('div')

    progress.className = 'plyr__progress'
    wrapper.element.append(progress)

    mocks.players[0]!.emit('ready')
    progress.dispatchEvent(new Event('focusin'))
    await flushPromises()

    const { signal } = mocks.generate.mock.calls[0]![1] as {
      signal: AbortSignal
    }

    wrapper.unmount()

    expect(signal.aborted).toBe(true)
  })

  it('autoplays muted when it becomes visible', async () => {
    await mountVideo()

    setVisibility(true)

    expect(mocks.players[0]!.play).toHaveBeenCalledTimes(1)
  })

  it('reports an autoplay start with isUserInitiated false', async () => {
    await mountVideo()

    setVisibility(true)
    await flushPromises()

    expect(mocks.trackGuideVideoPlay)
      .toHaveBeenCalledExactlyOnceWith('google', false)
  })

  it('pauses when it scrolls out of view', async () => {
    await mountVideo()

    setVisibility(true)
    setVisibility(false)

    expect(mocks.players[0]!.pause).toHaveBeenCalledTimes(1)
  })

  it('keeps playing in picture-in-picture when it scrolls out of view',
    async () => {
      await mountVideo()

      setVisibility(true)
      mocks.players[0]!.pip = true
      setVisibility(false)

      expect(mocks.players[0]!.pause).not.toHaveBeenCalled()
    })

  it('pauses again once picture-in-picture closes off screen', async () => {
    const wrapper = await mountVideo()

    setVisibility(true)
    mocks.players[0]!.pip = true
    setVisibility(false)
    mocks.players[0]!.pip = false
    await wrapper.get('video').trigger('leavepictureinpicture')

    expect(mocks.players[0]!.pause).toHaveBeenCalledTimes(1)
  })

  it('resumes autoplay when it scrolls back into view', async () => {
    await mountVideo()

    setVisibility(true)
    setVisibility(false)
    setVisibility(true)

    expect(mocks.players[0]!.play).toHaveBeenCalledTimes(2)
  })

  it('does not autoplay again after the user paused it', async () => {
    await mountVideo()

    setVisibility(true)
    mocks.players[0]!.paused = true
    mocks.players[0]!.emit('pause')
    setVisibility(true)

    expect(mocks.players[0]!.play).toHaveBeenCalledTimes(1)
  })

  it('never autoplays when the user prefers reduced motion', async () => {
    stubMotionPreference(true)
    await mountVideo()

    setVisibility(true)

    expect(mocks.players[0]!.play).not.toHaveBeenCalled()
  })

  it('never autoplays when data saver is on', async () => {
    Object.defineProperty(navigator, 'connection', {
      value: { saveData: true },
      configurable: true,
    })
    await mountVideo()

    setVisibility(true)

    expect(mocks.players[0]!.play).not.toHaveBeenCalled()

    Object.defineProperty(navigator, 'connection', {
      value: undefined,
      configurable: true,
    })
  })

  it('reports a user-started play with isUserInitiated true', async () => {
    stubMotionPreference(true)
    await mountVideo()

    mocks.players[0]!.emit('play')
    mocks.players[0]!.emit('playing')

    expect(mocks.trackGuideVideoPlay)
      .toHaveBeenCalledExactlyOnceWith('google', true)
  })

  it('falls back to native controls when Plyr fails to initialise',
    async () => {
      mocks.shouldThrow = true

      const wrapper = await mountVideo()

      expect((wrapper.get('video').element as HTMLVideoElement).controls)
        .toBe(true)
    })

  it('emits failed when the video element errors', async () => {
    const wrapper = await mountVideo()

    expect(wrapper.emitted('failed')).toBeUndefined()

    await wrapper.get('video').trigger('error')

    expect(wrapper.emitted('failed')).toHaveLength(1)
  })

  it('has no js hook class on the player container', async () => {
    const wrapper = await mountVideo()

    expect(wrapper.html()).not.toContain('js-key-guide')
  })

  it('destroys the player on unmount', async () => {
    const wrapper = await mountVideo()

    wrapper.unmount()

    expect(mocks.players[0]!.destroyed).toBe(true)
  })
})
