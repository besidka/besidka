import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import {
  createStorageStub,
  installVideoPlayerEnvironment,
  waitForPlayerReady,
} from '../../../setup/helpers/video-player'
import type { MediaState } from '../../../setup/helpers/video-player'
import VideoPlayer
  from '../../../../app/components/landing/VideoPlayer.client.vue'

const mocks = vi.hoisted(() => {
  return {
    track: vi.fn(),
    generate: vi.fn(),
    isAllowed: vi.fn((_categoryId: string) => true),
    onConsentChange: vi.fn(),
  }
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

const QUALITIES = [
  { src: '/videos/demo-1080.mp4', size: 1080 },
  { src: '/videos/demo.mp4', size: 720 },
  { src: '/videos/demo-360.mp4', size: 360 },
]

const SPEED_RATES = ['0.5', '0.75', '1', '1.25', '1.5', '2']
const PLAYER_TIMEOUT_MS = 15000

let environment: ReturnType<typeof installVideoPlayerEnvironment>
let media: MediaState

enableAutoUnmount(afterEach)

async function mountPlayer(props: Record<string, unknown> = {}) {
  const wrapper = await mountSuspended(VideoPlayer, {
    props: { src: '/videos/demo.mp4', thumbnails: false, ...props },
    attachTo: document.body,
  })

  await waitForPlayerReady(wrapper)

  return wrapper
}

interface StartQualityEnvironment {
  width: number
  devicePixelRatio?: number
  connection?: { saveData?: boolean, effectiveType?: string }
}

function stubStartQualityEnvironment(environment: StartQualityEnvironment) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: environment.width,
  } as DOMRect)
  vi.stubGlobal('devicePixelRatio', environment.devicePixelRatio ?? 1)

  Object.defineProperty(navigator, 'connection', {
    configurable: true,
    value: environment.connection,
  })
}

const originalMediaSrcDescriptor = Object.getOwnPropertyDescriptor(
  HTMLMediaElement.prototype,
  'src',
)!

function recordSrcAssignments(): string[] {
  const assigned: string[] = []

  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    configurable: true,
    get: originalMediaSrcDescriptor.get,
    set(value: string) {
      assigned.push(value)
      originalMediaSrcDescriptor.set!.call(this, value)
    },
  })

  return assigned
}

function getVideo(wrapper: VueWrapper): HTMLVideoElement {
  return wrapper.get('[data-testid="video-media"]').element as HTMLVideoElement
}

function getTimeSlider(wrapper: VueWrapper): HTMLElement {
  return wrapper.get('[data-testid="video-time-slider"]').element as HTMLElement
}

function getTestIds(wrapper: VueWrapper, testId: string): string[] {
  const group = wrapper.get(`[data-testid="${testId}"]`).element

  return Array.from(group.querySelectorAll('[data-testid]')).map((item) => {
    return item.getAttribute('data-testid')!
  })
}

function chooseMenuOption(
  wrapper: VueWrapper,
  testId: string,
  value: string,
) {
  wrapper.get(`[data-testid="${testId}"]`).element.dispatchEvent(
    new CustomEvent('value-change', { detail: { value } }),
  )
}

function getWatchCalls() {
  return mocks.track.mock.calls.filter((call) => {
    return call[0] === 'video_watch'
  })
}

function readStoredPreferences() {
  return JSON.parse(localStorage.getItem('video-player') ?? 'null')
}

describe('VideoPlayer.client.vue', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorageStub())
    environment = installVideoPlayerEnvironment()
    media = environment.media
    mocks.track.mockReset()
    mocks.generate.mockReset().mockResolvedValue(null)
    mocks.isAllowed.mockReset().mockReturnValue(true)
    mocks.onConsentChange.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'connection')
    Object.defineProperty(
      HTMLMediaElement.prototype,
      'src',
      originalMediaSrcDescriptor,
    )
  })

  describe('preferences storage', () => {
    it('writes preferences under the video-player key when consent is '
      + 'granted', async () => {
      mocks.isAllowed.mockReturnValue(true)

      const wrapper = await mountPlayer({ qualities: QUALITIES })
      const video = getVideo(wrapper)

      expect(mocks.isAllowed).toHaveBeenCalledWith('preferences')

      video.volume = 0.3
      video.dispatchEvent(new Event('volumechange'))
      await flushPromises()

      expect(readStoredPreferences()).toMatchObject({
        volume: 0.3,
        muted: false,
        speed: 1,
        quality: null,
        qualityChosen: false,
        captions: { enabled: false },
      })
    }, PLAYER_TIMEOUT_MS)

    it('writes nothing when preferences consent is denied', async () => {
      mocks.isAllowed.mockReturnValue(false)

      const wrapper = await mountPlayer({ qualities: QUALITIES })
      const video = getVideo(wrapper)

      video.volume = 0.3
      video.dispatchEvent(new Event('volumechange'))
      await flushPromises()

      expect(mocks.isAllowed).toHaveBeenCalledWith('preferences')
      expect(localStorage.getItem('video-player')).toBeNull()
    })

    it('keeps a saved quality on a page without quality renditions',
      async () => {
        localStorage.setItem('video-player', JSON.stringify({
          volume: 0.4,
          muted: false,
          speed: 1,
          quality: 1080,
          qualityChosen: true,
          captions: { enabled: false, language: null },
        }))

        const wrapper = await mountPlayer()
        const video = getVideo(wrapper)

        video.volume = 0.7
        video.dispatchEvent(new Event('volumechange'))
        await flushPromises()

        expect(readStoredPreferences()).toMatchObject({
          volume: 0.7,
          quality: 1080,
          qualityChosen: true,
        })
      })

    it('keeps a legacy unflagged quality unchosen on a page without '
      + 'quality renditions', async () => {
      localStorage.setItem('video-player', JSON.stringify({
        volume: 0.4,
        muted: false,
        speed: 1,
        quality: 720,
        captions: { enabled: false, language: null },
      }))

      const wrapper = await mountPlayer()
      const video = getVideo(wrapper)

      video.volume = 0.7
      video.dispatchEvent(new Event('volumechange'))
      await flushPromises()

      expect(readStoredPreferences()).toMatchObject({
        volume: 0.7,
        quality: 720,
        qualityChosen: false,
      })
    })

    it('restores saved speed, quality and volume once the player is ready',
      async () => {
        localStorage.setItem('video-player', JSON.stringify({
          volume: 0.4,
          muted: true,
          speed: 1.5,
          quality: 1080,
          qualityChosen: true,
          captions: { enabled: false, language: null },
        }))

        const wrapper = await mountPlayer({ qualities: QUALITIES })
        const video = getVideo(wrapper)

        expect(video.getAttribute('src')).toBe('/videos/demo-1080.mp4')
        expect(video.playbackRate).toBe(1.5)
        expect(video.volume).toBe(0.4)
        expect(video.muted).toBe(true)
      })

    it('ignores corrupt saved preferences', async () => {
      localStorage.setItem('video-player', '{not json')

      const wrapper = await mountPlayer({ qualities: QUALITIES })

      expect(getVideo(wrapper).getAttribute('src')).toBe('/videos/demo.mp4')
      expect(getVideo(wrapper).playbackRate).toBe(1)
    })

    it('persists the quality picked from the menu', async () => {
      const wrapper = await mountPlayer({ qualities: QUALITIES })

      chooseMenuOption(wrapper, 'video-quality-options', '1080')
      await flushPromises()

      expect(readStoredPreferences())
        .toMatchObject({ quality: 1080, qualityChosen: true })
    })
  })

  describe('starting quality', () => {
    const STARTING_CASES = [
      {
        name: 'a desktop player at 1x density starts on 720p',
        environment: { width: 672, devicePixelRatio: 1 },
        expected: '/videos/demo.mp4',
      },
      {
        name: 'a desktop player at 2x density starts on 1080p',
        environment: { width: 672, devicePixelRatio: 2 },
        expected: '/videos/demo-1080.mp4',
      },
      {
        name: 'a phone at 3x density is clamped to 2x and starts on 720p',
        environment: { width: 343, devicePixelRatio: 3 },
        expected: '/videos/demo.mp4',
      },
      {
        name: 'a phone at 1x density starts on 360p',
        environment: { width: 343, devicePixelRatio: 1 },
        expected: '/videos/demo-360.mp4',
      },
      {
        name: 'a wide 2x player on a fast network starts on 1080p',
        environment: {
          width: 1400,
          devicePixelRatio: 2,
          connection: { effectiveType: '4g' },
        },
        expected: '/videos/demo-1080.mp4',
      },
      {
        name: 'save-data starts on the lowest rendition',
        environment: {
          width: 1400,
          devicePixelRatio: 2,
          connection: { saveData: true, effectiveType: '4g' },
        },
        expected: '/videos/demo-360.mp4',
      },
      {
        name: 'a 3g connection starts on the lowest rendition',
        environment: {
          width: 1400,
          devicePixelRatio: 2,
          connection: { effectiveType: '3g' },
        },
        expected: '/videos/demo-360.mp4',
      },
    ]

    it.each(STARTING_CASES)('$name', async ({ environment, expected }) => {
      stubStartQualityEnvironment(environment)

      const wrapper = await mountPlayer({ qualities: QUALITIES })

      expect(getVideo(wrapper).getAttribute('src')).toBe(expected)
    }, PLAYER_TIMEOUT_MS)

    it('falls back to 720p when the player width cannot be measured',
      async () => {
        stubStartQualityEnvironment({ width: 0, devicePixelRatio: 2 })

        const wrapper = await mountPlayer({ qualities: QUALITIES })

        expect(getVideo(wrapper).getAttribute('src'))
          .toBe('/videos/demo.mp4')
      })

    it('assigns the source exactly once on first mount', async () => {
      stubStartQualityEnvironment({ width: 343, devicePixelRatio: 1 })

      const assigned = recordSrcAssignments()
      const wrapper = await mountPlayer({ qualities: QUALITIES })

      expect(getVideo(wrapper).getAttribute('src'))
        .toBe('/videos/demo-360.mp4')
      expect(assigned.filter(Boolean)).toEqual(['/videos/demo-360.mp4'])
    }, PLAYER_TIMEOUT_MS)

    it('lets a saved quality win over the heuristic without a second '
      + 'source', async () => {
      stubStartQualityEnvironment({ width: 1400, devicePixelRatio: 2 })
      localStorage.setItem('video-player', JSON.stringify({
        volume: 1,
        muted: false,
        speed: 1,
        quality: 360,
        qualityChosen: true,
        captions: { enabled: false, language: null },
      }))

      const assigned = recordSrcAssignments()
      const wrapper = await mountPlayer({ qualities: QUALITIES })

      expect(getVideo(wrapper).getAttribute('src'))
        .toBe('/videos/demo-360.mp4')
      expect(assigned.filter(Boolean)).toEqual(['/videos/demo-360.mp4'])
    }, PLAYER_TIMEOUT_MS)

    it('ignores a saved quality that is not offered', async () => {
      stubStartQualityEnvironment({ width: 343, devicePixelRatio: 1 })
      localStorage.setItem('video-player', JSON.stringify({
        volume: 1,
        muted: false,
        speed: 1,
        quality: 480,
        qualityChosen: true,
        captions: { enabled: false, language: null },
      }))

      const wrapper = await mountPlayer({ qualities: QUALITIES })

      expect(getVideo(wrapper).getAttribute('src'))
        .toBe('/videos/demo-360.mp4')
    }, PLAYER_TIMEOUT_MS)

    it('does not persist the heuristic pick over a stored null quality',
      async () => {
        stubStartQualityEnvironment({ width: 343, devicePixelRatio: 1 })

        const wrapper = await mountPlayer({ qualities: QUALITIES })
        const video = getVideo(wrapper)

        video.volume = 0.5
        video.dispatchEvent(new Event('volumechange'))
        await flushPromises()

        expect(readStoredPreferences()).toMatchObject({
          volume: 0.5,
          quality: null,
          qualityChosen: false,
        })
      }, PLAYER_TIMEOUT_MS)

    it('lets the heuristic start a legacy unflagged quality and does not '
      + 'promote it to a deliberate choice', async () => {
      stubStartQualityEnvironment({ width: 343, devicePixelRatio: 1 })
      localStorage.setItem('video-player', JSON.stringify({
        volume: 0.4,
        muted: false,
        speed: 1,
        quality: 720,
        captions: { enabled: false, language: null },
      }))

      const assigned = recordSrcAssignments()
      const wrapper = await mountPlayer({ qualities: QUALITIES })
      const video = getVideo(wrapper)

      expect(video.getAttribute('src')).toBe('/videos/demo-360.mp4')
      expect(assigned.filter(Boolean)).toEqual(['/videos/demo-360.mp4'])

      video.volume = 0.6
      video.dispatchEvent(new Event('volumechange'))
      await flushPromises()

      expect(readStoredPreferences()).toMatchObject({
        volume: 0.6,
        quality: 720,
        qualityChosen: false,
      })
    }, PLAYER_TIMEOUT_MS)

    it('persists a manual quality choice made after a heuristic start',
      async () => {
        stubStartQualityEnvironment({ width: 343, devicePixelRatio: 1 })

        const wrapper = await mountPlayer({ qualities: QUALITIES })

        chooseMenuOption(wrapper, 'video-quality-options', '1080')
        await flushPromises()

        expect(getVideo(wrapper).getAttribute('src'))
          .toBe('/videos/demo-1080.mp4')
        expect(readStoredPreferences())
          .toMatchObject({ quality: 1080, qualityChosen: true })
      }, PLAYER_TIMEOUT_MS)

    it('persists choosing the heuristic rendition itself', async () => {
      stubStartQualityEnvironment({ width: 343, devicePixelRatio: 1 })

      const wrapper = await mountPlayer({ qualities: QUALITIES })

      chooseMenuOption(wrapper, 'video-quality-options', '360')
      await flushPromises()

      expect(readStoredPreferences())
        .toMatchObject({ quality: 360, qualityChosen: true })
    }, PLAYER_TIMEOUT_MS)

    it('keeps a stored quality when the volume changes after a '
      + 'heuristic start with an unknown saved value', async () => {
      stubStartQualityEnvironment({ width: 343, devicePixelRatio: 1 })
      localStorage.setItem('video-player', JSON.stringify({
        volume: 0.4,
        muted: false,
        speed: 1,
        quality: 480,
        qualityChosen: true,
        captions: { enabled: false, language: null },
      }))

      const wrapper = await mountPlayer({ qualities: QUALITIES })
      const video = getVideo(wrapper)

      video.volume = 0.6
      video.dispatchEvent(new Event('volumechange'))
      await flushPromises()

      expect(readStoredPreferences()).toMatchObject({
        volume: 0.6,
        quality: 480,
        qualityChosen: true,
      })
    }, PLAYER_TIMEOUT_MS)

    it('keeps thumbnails on the 720p source whatever the playback '
      + 'rendition', async () => {
      stubStartQualityEnvironment({ width: 343, devicePixelRatio: 1 })

      const wrapper = await mountPlayer({
        qualities: QUALITIES,
        thumbnails: true,
      })

      getTimeSlider(wrapper).dispatchEvent(new Event('pointerenter'))
      await flushPromises()

      expect(getVideo(wrapper).getAttribute('src'))
        .toBe('/videos/demo-360.mp4')
      expect(mocks.generate).toHaveBeenCalledWith(
        '/videos/demo.mp4',
        { count: 12, signal: expect.any(AbortSignal) },
      )
    }, PLAYER_TIMEOUT_MS)

    it('keeps a single source on pages without renditions', async () => {
      stubStartQualityEnvironment({ width: 343, devicePixelRatio: 1 })

      const assigned = recordSrcAssignments()
      const wrapper = await mountPlayer({ src: '/videos/guide.mp4' })

      expect(getVideo(wrapper).getAttribute('src'))
        .toBe('/videos/guide.mp4')
      expect(assigned.filter(Boolean)).toEqual(['/videos/guide.mp4'])
    }, PLAYER_TIMEOUT_MS)
  })

  describe('quality menu', () => {
    it('lists qualities from highest to lowest and defaults to 720p',
      async () => {
        const wrapper = await mountPlayer({ qualities: QUALITIES })

        expect(getTestIds(wrapper, 'video-quality-options')).toEqual([
          'video-quality-1080',
          'video-quality-720',
          'video-quality-360',
        ])
        expect(wrapper.get('[data-testid="video-quality-720"]').text())
          .toBe('720p')
        expect(getVideo(wrapper).getAttribute('src'))
          .toBe('/videos/demo.mp4')
        expect(wrapper.get('[data-testid="video-settings-quality"]').text())
          .toContain('720p')
      })

    it('defaults to the highest quality when 720p is missing', async () => {
      const wrapper = await mountPlayer({
        qualities: [
          { src: '/videos/demo-1080.mp4', size: 1080 },
          { src: '/videos/demo-360.mp4', size: 360 },
        ],
      })

      expect(getVideo(wrapper).getAttribute('src'))
        .toBe('/videos/demo-1080.mp4')
    })

    it('hides the quality menu with fewer than two qualities', async () => {
      const wrapper = await mountPlayer()

      expect(wrapper.find('[data-testid="video-settings-quality"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="video-quality-options"]').exists())
        .toBe(false)
    })

    it('keeps time, speed and playback when switching quality', async () => {
      const wrapper = await mountPlayer({ qualities: QUALITIES })
      const video = getVideo(wrapper)

      video.currentTime = 12
      video.playbackRate = 1.5
      await video.play()

      const play = vi.spyOn(video, 'play').mockResolvedValue()

      chooseMenuOption(wrapper, 'video-quality-options', '1080')
      await flushPromises()

      expect(video.getAttribute('src')).toBe('/videos/demo-1080.mp4')

      video.currentTime = 0
      video.playbackRate = 1
      video.dispatchEvent(new Event('loadedmetadata'))
      await flushPromises()

      expect(video.currentTime).toBe(12)
      expect(video.playbackRate).toBe(1.5)
      expect(video.defaultPlaybackRate).toBe(1.5)
      expect(play).toHaveBeenCalledTimes(1)
    })

    it('falls back to the start when the resume point is beyond the new '
      + 'rendition', async () => {
      const wrapper = await mountPlayer({ qualities: QUALITIES })
      const video = getVideo(wrapper)

      media.duration = 100
      video.currentTime = 60
      chooseMenuOption(wrapper, 'video-quality-options', '1080')
      await flushPromises()

      media.duration = 34
      video.dispatchEvent(new Event('loadedmetadata'))
      await flushPromises()

      expect(video.getAttribute('src')).toBe('/videos/demo-1080.mp4')
      expect(video.currentTime).toBe(0)
    })

    it('does not resume playback when the video was paused', async () => {
      const wrapper = await mountPlayer({ qualities: QUALITIES })
      const video = getVideo(wrapper)
      const play = vi.spyOn(video, 'play').mockResolvedValue()

      video.currentTime = 30

      chooseMenuOption(wrapper, 'video-quality-options', '360')
      await flushPromises()

      video.currentTime = 0
      video.dispatchEvent(new Event('loadedmetadata'))
      await flushPromises()

      expect(video.getAttribute('src')).toBe('/videos/demo-360.mp4')
      expect(video.currentTime).toBe(30)
      expect(play).not.toHaveBeenCalled()
    })

    it('keeps the original resume point across back-to-back switches',
      async () => {
        const wrapper = await mountPlayer({ qualities: QUALITIES })
        const video = getVideo(wrapper)

        video.currentTime = 12
        video.playbackRate = 1.5
        await video.play()

        const play = vi.spyOn(video, 'play').mockResolvedValue()

        chooseMenuOption(wrapper, 'video-quality-options', '1080')
        await flushPromises()

        video.currentTime = 0
        video.playbackRate = 1

        chooseMenuOption(wrapper, 'video-quality-options', '360')
        await flushPromises()

        expect(video.getAttribute('src')).toBe('/videos/demo-360.mp4')

        video.dispatchEvent(new Event('loadedmetadata'))
        await flushPromises()

        expect(video.currentTime).toBe(12)
        expect(video.playbackRate).toBe(1.5)
        expect(play).toHaveBeenCalledTimes(1)

        video.currentTime = 40
        video.dispatchEvent(new Event('loadedmetadata'))
        await flushPromises()

        expect(video.currentTime).toBe(40)
        expect(play).toHaveBeenCalledTimes(1)
      })

    it('keeps a paused state across back-to-back switches', async () => {
      const wrapper = await mountPlayer({ qualities: QUALITIES })
      const video = getVideo(wrapper)
      const play = vi.spyOn(video, 'play').mockResolvedValue()

      video.currentTime = 30

      chooseMenuOption(wrapper, 'video-quality-options', '1080')
      await flushPromises()

      video.currentTime = 0

      chooseMenuOption(wrapper, 'video-quality-options', '360')
      await flushPromises()

      video.dispatchEvent(new Event('loadedmetadata'))
      await flushPromises()

      expect(video.currentTime).toBe(30)
      expect(play).not.toHaveBeenCalled()
    })

    it('ignores unknown quality values and the current quality',
      async () => {
        const wrapper = await mountPlayer({ qualities: QUALITIES })
        const video = getVideo(wrapper)

        chooseMenuOption(wrapper, 'video-quality-options', '480')
        chooseMenuOption(wrapper, 'video-quality-options', '720')
        await flushPromises()

        expect(video.getAttribute('src')).toBe('/videos/demo.mp4')
      })
  })

  describe('speed menu', () => {
    it('offers the fixed speed list with Normal as the default',
      async () => {
        const wrapper = await mountPlayer()

        expect(getTestIds(wrapper, 'video-speed-options')).toEqual(
          SPEED_RATES.map((rate) => {
            return `video-speed-${rate}`
          }),
        )
        expect(wrapper.get('[data-testid="video-speed-1"]').text())
          .toBe('Normal')
        expect(wrapper.get('[data-testid="video-speed-1.5"]').text())
          .toBe('1.5×')
        expect(wrapper.get('[data-testid="video-settings-speed"]').text())
          .toContain('Normal')
      })

    it('applies the picked speed to the video', async () => {
      const wrapper = await mountPlayer()
      const video = getVideo(wrapper)

      chooseMenuOption(wrapper, 'video-speed-options', '1.5')
      await flushPromises()

      expect(video.playbackRate).toBe(1.5)
      expect(video.defaultPlaybackRate).toBe(1.5)
    })

    it('reflects playback rate changes in the speed menu label',
      async () => {
        const wrapper = await mountPlayer()
        const video = getVideo(wrapper)

        video.playbackRate = 2
        video.dispatchEvent(new Event('ratechange'))
        await flushPromises()

        expect(wrapper.get('[data-testid="video-settings-speed"]').text())
          .toContain('2×')
      })

    it('shows the restored speed after a quality restore drops ratechange',
      async () => {
        localStorage.setItem('video-player', JSON.stringify({
          volume: 0.4,
          muted: false,
          speed: 1.5,
          quality: 1080,
          qualityChosen: true,
          captions: { enabled: false, language: null },
        }))

        const wrapper = await mountPlayer({ qualities: QUALITIES })
        const video = getVideo(wrapper)

        video.dispatchEvent(new Event('loadedmetadata'))
        await flushPromises()

        expect(video.playbackRate).toBe(1.5)
        expect(wrapper.get('[data-testid="video-settings-speed"]').text())
          .toContain('1.5×')
      })

    it('ignores speeds outside the fixed list', async () => {
      const wrapper = await mountPlayer()
      const video = getVideo(wrapper)

      chooseMenuOption(wrapper, 'video-speed-options', '3')
      await flushPromises()

      expect(video.playbackRate).toBe(1)
    })
  })

  describe('tracks', () => {
    it('keeps captions off at start by never marking a caption track '
      + 'as default', async () => {
      const wrapper = await mountPlayer({
        captions: [
          {
            src: '/videos/demo.en.vtt',
            srclang: 'en',
            label: 'English',
            default: true,
          },
          { src: '/videos/demo.uk.vtt', srclang: 'uk', label: 'Ukrainian' },
        ],
      })
      const captionTracks = wrapper.findAll('track[kind="captions"]')

      expect(captionTracks).toHaveLength(2)

      for (const captionTrack of captionTracks) {
        expect(captionTrack.element.hasAttribute('default')).toBe(false)
      }
    })

    it('builds a chapters track from sorted, parsed markers', async () => {
      const wrapper = await mountPlayer({
        markers: [
          { time: '0:08', label: 'End' },
          { time: '0:02', label: 'Start' },
          { time: 'bad', label: 'Ignored' },
        ],
      })
      const chapters = wrapper.get('track[kind="chapters"]')

      expect(chapters.attributes('default')).toBeDefined()

      const vtt = await environment.readBlobUrl(chapters.attributes('src')!)

      expect(vtt).toBe([
        'WEBVTT',
        '',
        '00:00:02.000 --> 00:00:08.000\nStart',
        '',
        '00:00:08.000 --> 99:59:59.000\nEnd',
        '',
      ].join('\n'))
    })

    it('renders no chapters track without markers', async () => {
      const wrapper = await mountPlayer()

      expect(wrapper.find('track[kind="chapters"]').exists()).toBe(false)
    })
  })

  describe('watch analytics', () => {
    it('reports a watch session on pause with the user trigger',
      async () => {
        const wrapper = await mountPlayer()
        const video = getVideo(wrapper)

        media.duration = 100
        video.dispatchEvent(new Event('play'))

        for (const second of [0.5, 1, 1.5, 2]) {
          video.currentTime = second
          video.dispatchEvent(new Event('timeupdate'))
        }

        video.dispatchEvent(new Event('pause'))

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

    it('reports ended once when pause fires at the end of playback',
      async () => {
        const wrapper = await mountPlayer()
        const video = getVideo(wrapper)

        media.duration = 3
        video.dispatchEvent(new Event('play'))

        for (const second of [1, 2, 3]) {
          video.currentTime = second
          video.dispatchEvent(new Event('timeupdate'))
        }

        media.ended = true
        video.dispatchEvent(new Event('pause'))
        video.dispatchEvent(new Event('ended'))

        const watchCalls = getWatchCalls()

        expect(watchCalls).toHaveLength(1)
        expect(watchCalls[0]![1]).toMatchObject({
          endReason: 'ended',
          completionPercent: 100,
        })
      })

    it('tracks a key guide play when a guide provider is set', async () => {
      const wrapper = await mountPlayer({
        src: '/videos/key.mp4',
        guideProvider: 'google',
      })
      const video = getVideo(wrapper)

      video.dispatchEvent(new Event('play'))
      video.dispatchEvent(new Event('ended'))

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
      const wrapper = await mountPlayer()
      const video = getVideo(wrapper)

      video.dispatchEvent(new Event('play'))
      video.dispatchEvent(new Event('play'))
      video.dispatchEvent(new Event('ended'))

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
  })

  describe('media element', () => {
    it('sets preload to metadata on the video element', async () => {
      const wrapper = await mountPlayer({ thumbnails: true })

      expect(getVideo(wrapper).getAttribute('preload')).toBe('metadata')
      expect(getVideo(wrapper).hasAttribute('playsinline')).toBe(true)
    })

    it('renders the player container with the landing hook class',
      async () => {
        const wrapper = await mountPlayer()
        const container = wrapper.get('[data-testid="video-player"]')

        expect(container.classes()).toContain('js-landing-player')
      })

    it('renders the full control set', async () => {
      const wrapper = await mountPlayer()

      for (const testId of [
        'video-play-button',
        'video-time-slider',
        'video-time',
        'video-mute-button',
        'video-volume-slider',
        'video-captions-button',
        'video-settings-button',
        'video-settings-menu',
        'video-pip-button',
        'video-airplay-button',
        'video-fullscreen-button',
      ]) {
        expect(wrapper.find(`[data-testid="${testId}"]`).exists(), testId)
          .toBe(true)
      }
    })
  })

  describe('lazy thumbnails', () => {
    it('does not generate thumbnails on mount', async () => {
      await mountPlayer({ thumbnails: true })

      expect(mocks.generate).not.toHaveBeenCalled()
    })

    it('does not generate thumbnails on play', async () => {
      const wrapper = await mountPlayer({ thumbnails: true })
      const video = getVideo(wrapper)

      video.dispatchEvent(new Event('play'))
      video.dispatchEvent(new Event('play'))
      await flushPromises()

      expect(mocks.generate).not.toHaveBeenCalled()
    })

    it('requests thumbnails from the 720p source with an abort signal '
      + 'on time slider pointerenter', async () => {
      const wrapper = await mountPlayer({
        qualities: QUALITIES,
        thumbnails: true,
      })

      getTimeSlider(wrapper).dispatchEvent(new Event('pointerenter'))
      await flushPromises()

      expect(mocks.generate).toHaveBeenCalledTimes(1)
      expect(mocks.generate).toHaveBeenCalledWith(
        '/videos/demo.mp4',
        { count: 12, signal: expect.any(AbortSignal) },
      )
    })

    it('falls back to the src when there is no 720p rendition', async () => {
      const wrapper = await mountPlayer({
        src: '/videos/fallback.mp4',
        qualities: [
          { src: '/videos/demo-1080.mp4', size: 1080 },
          { src: '/videos/demo-360.mp4', size: 360 },
        ],
        thumbnails: true,
      })

      getTimeSlider(wrapper).dispatchEvent(new Event('pointerenter'))
      await flushPromises()

      expect(mocks.generate).toHaveBeenCalledWith(
        '/videos/fallback.mp4',
        { count: 12, signal: expect.any(AbortSignal) },
      )
    })

    it('generates thumbnails once on the first pointerenter', async () => {
      const wrapper = await mountPlayer({ thumbnails: true })
      const slider = getTimeSlider(wrapper)

      slider.dispatchEvent(new Event('pointerenter'))
      slider.dispatchEvent(new Event('pointerenter'))
      slider.dispatchEvent(new Event('focusin'))
      await flushPromises()

      expect(mocks.generate).toHaveBeenCalledTimes(1)
    })

    it('generates thumbnails when the time slider receives focus',
      async () => {
        const wrapper = await mountPlayer({ thumbnails: true })

        getTimeSlider(wrapper).dispatchEvent(new Event('focusin'))
        await flushPromises()

        expect(mocks.generate).toHaveBeenCalledTimes(1)
      })

    it('exposes the generated sprite as a thumbnails track', async () => {
      const cleanup = vi.fn()

      mocks.generate.mockResolvedValue({
        url: 'blob:sprite',
        tileWidth: 160,
        tileHeight: 90,
        columns: 4,
        count: 12,
        duration: 60,
        cleanup,
      })

      const wrapper = await mountPlayer({ thumbnails: true })

      expect(wrapper.find('track[kind="metadata"]').exists()).toBe(false)

      getTimeSlider(wrapper).dispatchEvent(new Event('pointerenter'))
      await flushPromises()

      const thumbnails = wrapper.get('track[kind="metadata"]')
      const vtt = await environment.readBlobUrl(thumbnails.attributes('src')!)

      expect(vtt).toContain('blob:sprite#xywh=0,0,160,90')
      expect(vtt).toContain('blob:sprite#xywh=160,0,160,90')

      wrapper.unmount()

      expect(cleanup).toHaveBeenCalledTimes(1)
    })

    it('aborts thumbnail generation on unmount', async () => {
      const wrapper = await mountPlayer({ thumbnails: true })

      getTimeSlider(wrapper).dispatchEvent(new Event('pointerenter'))
      await flushPromises()

      const { signal } = mocks.generate.mock.calls[0]![1] as {
        signal: AbortSignal
      }

      expect(signal.aborted).toBe(false)

      wrapper.unmount()

      expect(signal.aborted).toBe(true)
    })

    it('skips thumbnail generation when disabled', async () => {
      const wrapper = await mountPlayer({ thumbnails: false })
      const slider = getTimeSlider(wrapper)

      slider.dispatchEvent(new Event('pointerenter'))
      slider.dispatchEvent(new Event('focusin'))
      await flushPromises()

      expect(mocks.generate).not.toHaveBeenCalled()
    })
  })

  describe('loading overlay', () => {
    beforeEach(() => {
      vi.spyOn(customElements, 'whenDefined')
        .mockReturnValue(new Promise(() => {}))
    })

    it('shows the poster under the spinner while loading', async () => {
      const wrapper = await mountSuspended(VideoPlayer, {
        props: { src: '/videos/demo.mp4', poster: '/videos/demo.webp' },
      })

      await flushPromises()

      const poster = wrapper.get('[data-testid="player-loading-poster"]')

      expect(poster.attributes('src')).toBe('/videos/demo.webp')
      expect(poster.attributes('alt')).toBe('')
      expect(poster.classes()).toContain('object-contain')
      expect(poster.classes()).not.toContain('object-cover')
      expect(wrapper.find('.skeleton').exists()).toBe(false)
      expect(wrapper.find('.animate-spin').exists()).toBe(true)
    })

    it('keeps the grey skeleton while loading without a poster',
      async () => {
        const wrapper = await mountSuspended(VideoPlayer, {
          props: { src: '/videos/demo.mp4' },
        })

        await flushPromises()

        expect(wrapper.find('[data-testid="player-loading-poster"]').exists())
          .toBe(false)
        expect(wrapper.get('[data-testid="player-loading"]').classes())
          .toContain('skeleton')
        expect(wrapper.find('.animate-spin').exists()).toBe(true)
      })
  })

  describe('loading overlay lifecycle', () => {
    it('removes the loading overlay once the player is ready', async () => {
      const wrapper = await mountPlayer({ poster: '/videos/demo.webp' })

      expect(wrapper.find('[data-testid="player-loading"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="player-loading-poster"]').exists())
        .toBe(false)
      expect(wrapper.find('.animate-spin').exists()).toBe(false)
    })
  })

  describe('native controls fallback', () => {
    it('falls back to native controls when the elements fail to load',
      async () => {
        vi.spyOn(customElements, 'whenDefined')
          .mockRejectedValue(new Error('elements failed'))

        const wrapper = await mountSuspended(VideoPlayer, {
          props: { src: '/videos/demo.mp4', thumbnails: false },
        })

        await flushPromises()

        const video = getVideo(wrapper)

        expect(video.controls).toBe(true)
        expect(wrapper.find('[data-testid="player-loading"]').exists())
          .toBe(false)
        expect(wrapper.find('[data-testid="video-play-button"]').exists())
          .toBe(false)
      })
  })

  describe('startAt', () => {
    beforeEach(() => {
      media.duration = 100
      media.readyState = 4
    })

    it('seeks to startAt once the player is ready without playing',
      async () => {
        const wrapper = await mountPlayer({
          src: '/videos/key.mp4',
          startAt: 7,
        })
        const video = getVideo(wrapper)

        expect(video.currentTime).toBe(7)
        expect(video.paused).toBe(true)
        expect(mocks.track).not.toHaveBeenCalledWith(
          'key_guide_video_play',
          expect.anything(),
        )
      })

    it('lands a restored quality on startAt instead of the old position',
      async () => {
        localStorage.setItem('video-player', JSON.stringify({
          volume: 1,
          muted: false,
          speed: 1,
          quality: 1080,
          qualityChosen: true,
          captions: { enabled: false, language: null },
        }))

        const wrapper = await mountPlayer({
          src: '/videos/key.mp4',
          qualities: QUALITIES,
          startAt: 7,
        })
        const video = getVideo(wrapper)
        const play = vi.spyOn(video, 'play').mockResolvedValue()

        expect(video.getAttribute('src')).toBe('/videos/demo-1080.mp4')

        media.duration = 34
        media.readyState = 1
        video.dispatchEvent(new Event('loadedmetadata'))
        await flushPromises()

        expect(video.currentTime).toBe(7)
        expect(play).not.toHaveBeenCalled()
      })

    it('stays at the start when startAt is beyond a restored rendition',
      async () => {
        localStorage.setItem('video-player', JSON.stringify({
          volume: 1,
          muted: false,
          speed: 1,
          quality: 1080,
          qualityChosen: true,
          captions: { enabled: false, language: null },
        }))
        media.duration = NaN
        media.readyState = 0

        const wrapper = await mountPlayer({
          src: '/videos/key.mp4',
          qualities: QUALITIES,
          startAt: 50,
        })
        const video = getVideo(wrapper)

        media.duration = 34
        media.readyState = 1
        video.dispatchEvent(new Event('loadedmetadata'))
        await flushPromises()

        expect(video.getAttribute('src')).toBe('/videos/demo-1080.mp4')
        expect(video.currentTime).toBe(0)
      })

    it('waits for loadedmetadata when the duration is not known at ready',
      async () => {
        media.duration = NaN
        media.readyState = 0

        const wrapper = await mountPlayer({
          src: '/videos/key.mp4',
          startAt: 12,
        })
        const video = getVideo(wrapper)

        expect(video.currentTime).toBe(0)

        media.duration = 34
        media.readyState = 1
        video.dispatchEvent(new Event('loadedmetadata'))

        expect(video.currentTime).toBe(12)
      })

    it('applies startAt only once', async () => {
      const wrapper = await mountPlayer({
        src: '/videos/key.mp4',
        startAt: 7,
      })
      const video = getVideo(wrapper)

      video.currentTime = 20
      video.dispatchEvent(new Event('loadedmetadata'))

      expect(video.currentTime).toBe(20)
    })

    it('treats startAt 0 as a valid start', async () => {
      media.duration = NaN
      media.readyState = 0

      const wrapper = await mountPlayer({
        src: '/videos/key.mp4',
        startAt: 0,
      })
      const video = getVideo(wrapper)

      video.currentTime = 5
      media.duration = 34
      media.readyState = 1
      video.dispatchEvent(new Event('loadedmetadata'))

      expect(video.currentTime).toBe(0)
    })

    it('does not seek when startAt is not below the real duration',
      async () => {
        const wrapper = await mountPlayer({
          src: '/videos/key.mp4',
          startAt: 100,
        })

        expect(getVideo(wrapper).currentTime).toBe(0)
      })

    it('does not seek without startAt', async () => {
      const wrapper = await mountSuspended(VideoPlayer, {
        props: { src: '/videos/key.mp4', thumbnails: false },
        attachTo: document.body,
      })
      const video = getVideo(wrapper)

      video.currentTime = 3

      await waitForPlayerReady(wrapper)
      video.dispatchEvent(new Event('loadedmetadata'))

      expect(video.currentTime).toBe(3)
    })
  })
})
