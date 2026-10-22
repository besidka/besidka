import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import {
  installVideoPlayerEnvironment,
  waitForPlayerReady,
} from '../../../../setup/helpers/video-player'
import type { MediaState } from '../../../../setup/helpers/video-player'
import GuideVideo
  from '../../../../../app/components/Profile/Keys/GuideVideo.client.vue'

interface ObserverInstance {
  callback: IntersectionObserverCallback
}

interface WebKitPresentationVideo extends HTMLVideoElement {
  webkitPresentationMode?: string
}

const mocks = vi.hoisted(() => {
  return {
    trackGuideVideoPlay: vi.fn(),
    startWatch: vi.fn(),
    updateWatch: vi.fn(),
    upgradeWatchToUser: vi.fn(() => false),
    endWatch: vi.fn(),
    generate: vi.fn(),
    observers: [] as ObserverInstance[],
  }
})

mockNuxtImport('useKeyGuideAnalytics', () => {
  return () => {
    return {
      trackGuideOpen: vi.fn(),
      trackGuideVideoPlay: mocks.trackGuideVideoPlay,
    }
  }
})

mockNuxtImport('useVideoWatchAnalytics', () => {
  return () => {
    return {
      start: mocks.startWatch,
      update: mocks.updateWatch,
      upgradeToUser: mocks.upgradeWatchToUser,
      end: mocks.endWatch,
      isActive: vi.fn(),
    }
  }
})

mockNuxtImport('useLandingVideoThumbnails', () => {
  return () => {
    return { generate: mocks.generate }
  }
})

const SOURCE = '/videos/key-guide-google.mp4'
const PLAYER_TIMEOUT_MS = 15000

let environment: ReturnType<typeof installVideoPlayerEnvironment>
let media: MediaState

enableAutoUnmount(afterEach)

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

function setPictureInPictureElement(element: Element | null) {
  Object.defineProperty(document, 'pictureInPictureElement', {
    configurable: true,
    get: () => {
      return element
    },
  })
}

function getVideo(wrapper: VueWrapper): HTMLVideoElement {
  return wrapper.get('[data-testid="video-media"]').element as HTMLVideoElement
}

function getTimeSlider(wrapper: VueWrapper): HTMLElement {
  return wrapper.get('[data-testid="video-time-slider"]').element as HTMLElement
}

async function mountVideo(extraProps: Record<string, unknown> = {}) {
  const wrapper = await mountSuspended(GuideVideo, {
    props: {
      provider: 'google',
      src: SOURCE,
      poster: '/key-guides/google.webp',
      label: 'Creating a key',
      ...extraProps,
    },
    attachTo: document.body,
  })

  await waitForPlayerReady(wrapper)

  const video = getVideo(wrapper)

  return {
    wrapper,
    video,
    play: vi.spyOn(video, 'play'),
    pause: vi.spyOn(video, 'pause'),
  }
}

describe('Profile/Keys/GuideVideo.client', () => {
  beforeEach(() => {
    environment = installVideoPlayerEnvironment()
    media = environment.media
    media.duration = 60
    mocks.trackGuideVideoPlay.mockReset()
    mocks.startWatch.mockReset()
    mocks.updateWatch.mockReset()
    mocks.upgradeWatchToUser.mockReset().mockReturnValue(false)
    mocks.endWatch.mockReset()
    mocks.observers.length = 0
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
    Reflect.deleteProperty(document, 'pictureInPictureElement')
    Object.defineProperty(navigator, 'connection', {
      value: undefined,
      configurable: true,
    })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('media element', () => {
    it('renders a muted, looping, non-preloading video with a poster and '
      + 'an accessible name', async () => {
      const { video } = await mountVideo()

      expect(video.getAttribute('preload')).toBe('none')
      expect(video.getAttribute('aria-label')).toBe('Creating a key')
      expect(video.getAttribute('poster')).toBe('/key-guides/google.webp')
      expect(video.getAttribute('src')).toBe(SOURCE)
      expect(video.muted).toBe(true)
      expect(video.hasAttribute('loop')).toBe(true)
      expect(video.hasAttribute('playsinline')).toBe(true)
    }, PLAYER_TIMEOUT_MS)

    it('offers picture-in-picture and never disables it on the video',
      async () => {
        const { wrapper, video } = await mountVideo()

        expect(wrapper.find('[data-testid="video-pip-button"]').exists())
          .toBe(true)
        expect(video.hasAttribute('disablepictureinpicture')).toBe(false)
      })

    it('renders only the lean controls', async () => {
      const { wrapper } = await mountVideo()

      for (const testId of [
        'video-big-play',
        'video-play-button',
        'video-time-slider',
        'video-mute-button',
        'video-pip-button',
        'video-fullscreen-button',
        'video-settings-button',
        'video-settings-menu',
        'video-settings-speed',
        'video-speed-options',
      ]) {
        expect(wrapper.find(`[data-testid="${testId}"]`).exists(), testId)
          .toBe(true)
      }

      for (const testId of [
        'video-settings-captions',
        'video-captions-options',
        'video-settings-quality',
        'video-quality-options',
        'video-volume-slider',
        'video-captions-button',
        'video-time',
        'video-airplay-button',
      ]) {
        expect(wrapper.find(`[data-testid="${testId}"]`).exists(), testId)
          .toBe(false)
      }
    })

    it('has no js hook class on the player container', async () => {
      const { wrapper } = await mountVideo()

      expect(wrapper.html()).not.toContain('js-key-guide')
    })
  })

  describe('speed menu', () => {
    function chooseSpeed(wrapper: VueWrapper, value: string) {
      wrapper.get('[data-testid="video-speed-options"]').element
        .dispatchEvent(new CustomEvent('value-change', { detail: { value } }))
    }

    it('lists 0.5x to 2x with Normal selected by default', async () => {
      const { wrapper } = await mountVideo()

      for (const rate of ['0.5', '0.75', '1', '1.25', '1.5', '2']) {
        expect(
          wrapper.find(`[data-testid="video-speed-${rate}"]`).exists(),
          rate,
        ).toBe(true)
      }

      expect(wrapper.get('[data-testid="video-speed-1"]').text())
        .toBe('Normal')
      expect(wrapper.get('[data-testid="video-settings-speed"]').text())
        .toContain('Normal')
    })

    it('keeps the settings button visible without caption tracks',
      async () => {
        const { wrapper } = await mountVideo()

        expect(wrapper.find('track[kind="captions"]').exists()).toBe(false)
        expect(wrapper.get('[data-testid="video-settings-button"]')
          .element.hasAttribute('hidden')).toBe(false)
      })

    it('applies the chosen speed to the video and the menu label',
      async () => {
        const { wrapper, video } = await mountVideo()

        chooseSpeed(wrapper, '1.5')
        await flushPromises()

        expect(video.playbackRate).toBe(1.5)
        expect(video.defaultPlaybackRate).toBe(1.5)

        video.dispatchEvent(new Event('ratechange'))
        await flushPromises()

        expect(wrapper.get('[data-testid="video-settings-speed"]').text())
          .toContain('1.5×')
      })

    it('ignores a speed that is not offered', async () => {
      const { wrapper, video } = await mountVideo()

      chooseSpeed(wrapper, '3')

      expect(video.playbackRate).toBe(1)
    })

    it('does not persist the chosen speed', async () => {
      localStorage.removeItem('video-player')

      const { wrapper } = await mountVideo()

      chooseSpeed(wrapper, '2')
      await flushPromises()

      expect(localStorage.getItem('video-player')).toBeNull()
    })
  })

  describe('chapters', () => {
    it('builds a chapters track from sorted, parsed markers', async () => {
      const { wrapper } = await mountVideo({
        markers: [
          { time: '0:12', label: 'Copy your key' },
          { time: '0:00', label: 'Open the page' },
        ],
      })
      const chapters = wrapper.get('track[kind="chapters"]')
      const vtt = await environment.readBlobUrl(chapters.attributes('src')!)

      expect(vtt).toBe([
        'WEBVTT',
        '',
        '00:00:00.000 --> 00:00:12.000\nOpen the page',
        '',
        '00:00:12.000 --> 99:59:59.000\nCopy your key',
        '',
      ].join('\n'))
    })

    it('renders no chapters track when the guide has none', async () => {
      const { wrapper } = await mountVideo()

      expect(wrapper.find('track[kind="chapters"]').exists()).toBe(false)
    })
  })

  describe('lazy thumbnails', () => {
    it('does not generate thumbnails until the time slider is used',
      async () => {
        await mountVideo()

        expect(mocks.generate).not.toHaveBeenCalled()
      })

    it('generates thumbnails once on the first time slider pointerenter',
      async () => {
        const { wrapper } = await mountVideo()
        const slider = getTimeSlider(wrapper)

        slider.dispatchEvent(new Event('pointerenter'))
        slider.dispatchEvent(new Event('pointerenter'))
        await flushPromises()

        expect(mocks.generate).toHaveBeenCalledExactlyOnceWith(
          SOURCE,
          { count: 12, signal: expect.any(AbortSignal) },
        )
      })

    it('passes a versioned src to the thumbnail generator unchanged',
      async () => {
        const { wrapper, video } = await mountVideo({
          src: `${SOURCE}?v=2`,
        })

        getTimeSlider(wrapper).dispatchEvent(new Event('pointerenter'))
        await flushPromises()

        expect(video.getAttribute('src')).toBe(`${SOURCE}?v=2`)
        expect(mocks.generate).toHaveBeenCalledExactlyOnceWith(
          `${SOURCE}?v=2`,
          { count: 12, signal: expect.any(AbortSignal) },
        )
      })

    it('aborts thumbnail generation on unmount', async () => {
      const { wrapper } = await mountVideo()

      getTimeSlider(wrapper).dispatchEvent(new Event('focusin'))
      await flushPromises()

      const { signal } = mocks.generate.mock.calls[0]![1] as {
        signal: AbortSignal
      }

      expect(signal.aborted).toBe(false)

      wrapper.unmount()

      expect(signal.aborted).toBe(true)
    })
  })

  describe('autoplay', () => {
    it('autoplays muted when it becomes visible', async () => {
      const { play } = await mountVideo()

      setVisibility(true)

      expect(play).toHaveBeenCalledTimes(1)
    })

    it('reports an autoplay start with isUserInitiated false', async () => {
      await mountVideo()

      setVisibility(true)
      await flushPromises()

      expect(mocks.trackGuideVideoPlay)
        .toHaveBeenCalledExactlyOnceWith('google', false)
    })

    it('does not autoplay before the player is ready', async () => {
      vi.spyOn(customElements, 'whenDefined')
        .mockReturnValue(new Promise(() => {}))

      const wrapper = await mountSuspended(GuideVideo, {
        props: {
          provider: 'google',
          src: SOURCE,
          label: 'Creating a key',
        },
        attachTo: document.body,
      })
      const play = vi.spyOn(getVideo(wrapper), 'play')

      setVisibility(true)

      expect(play).not.toHaveBeenCalled()
    })

    it('pauses when it scrolls out of view', async () => {
      const { pause } = await mountVideo()

      setVisibility(true)
      setVisibility(false)

      expect(pause).toHaveBeenCalledTimes(1)
    })

    it('does not pause a video that is not playing when it leaves the view',
      async () => {
        const { pause } = await mountVideo()

        setVisibility(false)

        expect(pause).not.toHaveBeenCalled()
      })

    it('keeps playing in picture-in-picture when it scrolls out of view',
      async () => {
        const { video, pause } = await mountVideo()

        setVisibility(true)
        setPictureInPictureElement(video)
        setVisibility(false)

        expect(pause).not.toHaveBeenCalled()
      })

    it('keeps playing in WebKit picture-in-picture when it scrolls out '
      + 'of view', async () => {
      const { video, pause } = await mountVideo()

      setVisibility(true)
      ;(video as WebKitPresentationVideo).webkitPresentationMode
        = 'picture-in-picture'
      setVisibility(false)

      expect(pause).not.toHaveBeenCalled()
    })

    it('pauses again once picture-in-picture closes off screen',
      async () => {
        const { video, pause } = await mountVideo()

        setVisibility(true)
        setPictureInPictureElement(video)
        setVisibility(false)
        setPictureInPictureElement(null)
        video.dispatchEvent(new Event('leavepictureinpicture'))

        expect(pause).toHaveBeenCalledTimes(1)
      })

    it('pauses again once WebKit picture-in-picture closes off screen',
      async () => {
        const { video, pause } = await mountVideo()

        setVisibility(true)
        ;(video as WebKitPresentationVideo).webkitPresentationMode
          = 'picture-in-picture'
        setVisibility(false)
        ;(video as WebKitPresentationVideo).webkitPresentationMode = 'inline'
        video.dispatchEvent(new Event('webkitpresentationmodechanged'))

        expect(pause).toHaveBeenCalledTimes(1)
      })

    it('resumes autoplay when it scrolls back into view', async () => {
      const { play } = await mountVideo()

      setVisibility(true)
      setVisibility(false)
      setVisibility(true)

      expect(play).toHaveBeenCalledTimes(2)
    })

    it('does not autoplay again after the user paused it', async () => {
      const { video, play } = await mountVideo()

      setVisibility(true)
      video.pause()
      setVisibility(true)

      expect(play).toHaveBeenCalledTimes(1)
    })

    it('never autoplays when the user prefers reduced motion', async () => {
      stubMotionPreference(true)

      const { play } = await mountVideo()

      setVisibility(true)

      expect(play).not.toHaveBeenCalled()
    })

    it('never autoplays when data saver is on', async () => {
      Object.defineProperty(navigator, 'connection', {
        value: { saveData: true },
        configurable: true,
      })

      const { play } = await mountVideo()

      setVisibility(true)

      expect(play).not.toHaveBeenCalled()
    })
  })

  describe('analytics', () => {
    it('reports a user-started play with isUserInitiated true', async () => {
      stubMotionPreference(true)

      const { video } = await mountVideo()

      video.dispatchEvent(new Event('play'))
      video.dispatchEvent(new Event('playing'))

      expect(mocks.trackGuideVideoPlay)
        .toHaveBeenCalledExactlyOnceWith('google', true)
    })

    it('starts a watch session with the autoplay trigger', async () => {
      await mountVideo()

      setVisibility(true)
      await flushPromises()

      expect(mocks.startWatch).toHaveBeenCalledExactlyOnceWith('autoplay', 0)
    })

    it('starts a watch session with the user trigger', async () => {
      stubMotionPreference(true)

      const { video } = await mountVideo()

      video.dispatchEvent(new Event('play'))
      video.dispatchEvent(new Event('playing'))

      expect(mocks.startWatch).toHaveBeenCalledExactlyOnceWith('user', 0)
    })

    it('ignores a playing event that is not preceded by play', async () => {
      stubMotionPreference(true)

      const { video } = await mountVideo()

      video.dispatchEvent(new Event('playing'))

      expect(mocks.trackGuideVideoPlay).not.toHaveBeenCalled()
      expect(mocks.startWatch).not.toHaveBeenCalled()
    })

    it('does not count a rebuffer after autoplay as a user play',
      async () => {
        const { video } = await mountVideo()

        setVisibility(true)
        await flushPromises()
        video.dispatchEvent(new Event('playing'))

        expect(mocks.trackGuideVideoPlay)
          .toHaveBeenCalledExactlyOnceWith('google', false)
        expect(mocks.startWatch).toHaveBeenCalledTimes(1)
      })

    it('forwards timeupdate to the watch session', async () => {
      const { video } = await mountVideo()

      video.currentTime = 4.5
      video.dispatchEvent(new Event('timeupdate'))

      expect(mocks.updateWatch).toHaveBeenCalledWith(4.5, 60)
    })

    it('ends the watch session as offscreen when scrolling away pauses it',
      async () => {
        await mountVideo()

        setVisibility(true)
        setVisibility(false)

        expect(mocks.endWatch).toHaveBeenCalledExactlyOnceWith('offscreen')
      })

    it('ends the watch session as pause when the user pauses', async () => {
      const { video } = await mountVideo()

      setVisibility(true)
      await flushPromises()
      video.pause()

      expect(mocks.endWatch).toHaveBeenCalledExactlyOnceWith('pause')
    })

    it('starts an autoplay session as user when the video is unmuted',
      async () => {
        const { video } = await mountVideo()

        video.muted = false
        setVisibility(true)
        await flushPromises()

        expect(mocks.startWatch).toHaveBeenCalledExactlyOnceWith('user', 0)
      })

    it('counts unmuting an autoplayed video as a user play', async () => {
      mocks.upgradeWatchToUser.mockReturnValue(true)

      const { video } = await mountVideo()

      setVisibility(true)
      await flushPromises()
      mocks.trackGuideVideoPlay.mockClear()

      video.muted = false
      video.dispatchEvent(new Event('volumechange'))

      expect(mocks.upgradeWatchToUser).toHaveBeenCalledTimes(1)
      expect(mocks.trackGuideVideoPlay)
        .toHaveBeenCalledExactlyOnceWith('google', true)
    })

    it('does not count unmuting when the session is already a user play',
      async () => {
        const { video } = await mountVideo()

        video.muted = false
        video.dispatchEvent(new Event('volumechange'))

        expect(mocks.upgradeWatchToUser).toHaveBeenCalledTimes(1)
        expect(mocks.trackGuideVideoPlay).not.toHaveBeenCalled()
      })

    it('does not count muting again as a user play', async () => {
      const { video } = await mountVideo()

      video.muted = false
      video.dispatchEvent(new Event('volumechange'))
      video.muted = true
      video.dispatchEvent(new Event('volumechange'))

      expect(mocks.upgradeWatchToUser).toHaveBeenCalledTimes(1)
    })
  })

  describe('failures', () => {
    it('falls back to native controls when the elements fail to load',
      async () => {
        vi.spyOn(customElements, 'whenDefined')
          .mockRejectedValue(new Error('elements failed'))

        const wrapper = await mountSuspended(GuideVideo, {
          props: {
            provider: 'google',
            src: SOURCE,
            label: 'Creating a key',
          },
          attachTo: document.body,
        })

        await flushPromises()

        expect(getVideo(wrapper).controls).toBe(true)
        expect(wrapper.find('[data-testid="video-play-button"]').exists())
          .toBe(false)
      })

    it('emits failed when the video element errors', async () => {
      const { wrapper, video } = await mountVideo()

      expect(wrapper.emitted('failed')).toBeUndefined()

      video.dispatchEvent(new Event('error'))

      expect(wrapper.emitted('failed')).toHaveLength(1)
    })
  })
})
