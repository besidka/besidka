import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { effectScope, nextTick, shallowRef } from 'vue'
import type { EffectScope } from 'vue'
import {
  buildChaptersVtt,
  buildThumbnailsVtt,
  computePreviewShift,
  useVideoTimeline,
} from '../../../app/composables/video-timeline'
import type { ThumbnailSprite } from '../../../app/composables/landing-video-thumbnails'
import { installVideoPlayerEnvironment } from '../../setup/helpers/video-player'
import type { MediaState } from '../../setup/helpers/video-player'

const mocks = vi.hoisted(() => {
  return { generate: vi.fn() }
})

mockNuxtImport('useLandingVideoThumbnails', () => {
  return () => {
    return { generate: mocks.generate }
  }
})

const SLIDER_WIDTH = 1000
const DURATION = 100

function createSprite(overrides: Partial<ThumbnailSprite> = {}) {
  return {
    url: 'blob:sprite',
    tileWidth: 160,
    tileHeight: 90,
    columns: 4,
    count: 12,
    duration: 60,
    cleanup: vi.fn(),
    ...overrides,
  } satisfies ThumbnailSprite
}

describe('buildChaptersVtt', () => {
  it('starts with the WEBVTT header and separates cues with blank lines',
    () => {
      const vtt = buildChaptersVtt([
        { time: 0, label: 'Intro' },
        { time: 12, label: 'Setup' },
      ])

      expect(vtt).toBe([
        'WEBVTT',
        '',
        '00:00:00.000 --> 00:00:12.000\nIntro',
        '',
        '00:00:12.000 --> 99:59:59.000\nSetup',
        '',
      ].join('\n'))
    })

  it('returns only the header for no markers', () => {
    expect(buildChaptersVtt([])).toBe('WEBVTT\n')
  })

  it('leaves the last chapter open-ended', () => {
    const vtt = buildChaptersVtt([{ time: 5, label: 'Only' }])

    expect(vtt).toContain('00:00:05.000 --> 99:59:59.000\nOnly')
  })

  it('formats hours, minutes, seconds and milliseconds', () => {
    const vtt = buildChaptersVtt([
      { time: 3725.5, label: 'Long' },
      { time: 3726.0004, label: 'Next' },
    ])

    expect(vtt).toContain('01:02:05.500 --> 01:02:06.000\nLong')
  })

  it('rounds timestamps to the nearest millisecond', () => {
    const vtt = buildChaptersVtt([
      { time: 1.2346, label: 'A' },
      { time: 2.9996, label: 'B' },
    ])

    expect(vtt).toContain('00:00:01.235 --> 00:00:03.000\nA')
  })

  it('drops zero-length cues from duplicate marker times', () => {
    const vtt = buildChaptersVtt([
      { time: 5, label: 'First' },
      { time: 5, label: 'Second' },
    ])

    expect(vtt).not.toContain('First')
    expect(vtt).toContain('00:00:05.000 --> 99:59:59.000\nSecond')
  })

  it('escapes markup characters and flattens newlines in labels', () => {
    const vtt = buildChaptersVtt([
      { time: 0, label: 'Tom & <Jerry>\r\nSecond line' },
    ])

    expect(vtt).toContain('Tom &amp; &lt;Jerry&gt; Second line')
    expect(vtt).not.toContain('<Jerry>')
  })
})

describe('buildThumbnailsVtt', () => {
  it('emits one xywh cue per tile in row-major order', () => {
    const vtt = buildThumbnailsVtt(createSprite({
      count: 4,
      columns: 2,
      duration: 40,
    }))

    expect(vtt).toBe([
      'WEBVTT',
      '',
      '00:00:00.000 --> 00:00:10.000\nblob:sprite#xywh=0,0,160,90',
      '',
      '00:00:10.000 --> 00:00:20.000\nblob:sprite#xywh=160,0,160,90',
      '',
      '00:00:20.000 --> 00:00:30.000\nblob:sprite#xywh=0,90,160,90',
      '',
      '00:00:30.000 --> 00:00:40.000\nblob:sprite#xywh=160,90,160,90',
      '',
    ].join('\n'))
  })

  it('ends the last cue exactly at the sprite duration', () => {
    const vtt = buildThumbnailsVtt(createSprite({
      count: 3,
      columns: 3,
      duration: 10,
    }))

    expect(vtt).toContain('00:00:00.000 --> 00:00:03.333')
    expect(vtt).toContain('00:00:06.667 --> 00:00:10.000')
  })
})

describe('computePreviewShift', () => {
  const CARD_WIDTH = 172
  const player = { containerLeft: 0, containerWidth: 343 }

  function shiftFor(pointerX: number, slider = { left: 60, width: 90 }) {
    return computePreviewShift({
      pointerX,
      sliderLeft: slider.left,
      sliderWidth: slider.width,
      cardWidth: CARD_WIDTH,
      ...player,
    })
  }

  it('does not move a card that fits inside the player', () => {
    expect(computePreviewShift({
      pointerX: 400,
      sliderLeft: 60,
      sliderWidth: 700,
      cardWidth: CARD_WIDTH,
      containerLeft: 0,
      containerWidth: 820,
    })).toBe(0)
  })

  it('pulls the card back inside the left edge with an 8px inset', () => {
    const centeredLeft = 60 - CARD_WIDTH / 2

    expect(shiftFor(60) + centeredLeft).toBe(8)
  })

  it('pulls the card back inside the right edge with an 8px inset', () => {
    const wide = { left: 200, width: 140 }
    const centeredLeft = 340 - CARD_WIDTH / 2

    expect(shiftFor(340, wide) + centeredLeft).toBe(343 - CARD_WIDTH - 8)
  })

  it('clamps the pointer to the slider before measuring', () => {
    expect(shiftFor(-500)).toBe(shiftFor(60))
    expect(shiftFor(9000)).toBe(shiftFor(150))
  })

  it('respects the player offset on the page', () => {
    const shift = computePreviewShift({
      pointerX: 90,
      sliderLeft: 80,
      sliderWidth: 90,
      cardWidth: CARD_WIDTH,
      containerLeft: 20,
      containerWidth: 343,
    })

    expect(90 - CARD_WIDTH / 2 + shift).toBe(28)
  })

  it('returns zero for a collapsed slider or card', () => {
    expect(shiftFor(60, { left: 60, width: 0 })).toBe(0)
    expect(computePreviewShift({
      pointerX: 10,
      sliderLeft: 0,
      sliderWidth: 100,
      cardWidth: 0,
      ...player,
    })).toBe(0)
  })

  it('prefers the left inset when the card is wider than the player', () => {
    const shift = computePreviewShift({
      pointerX: 50,
      sliderLeft: 0,
      sliderWidth: 100,
      cardWidth: 400,
      containerLeft: 0,
      containerWidth: 300,
    })

    expect(50 - 200 + shift).toBe(8)
  })
})

describe('useVideoTimeline', () => {
  let environment: ReturnType<typeof installVideoPlayerEnvironment>
  let media: MediaState
  let scope: EffectScope
  let video: HTMLVideoElement
  let currentTimeSetter: ReturnType<typeof vi.fn>

  function mountTimeline(
    options: {
      markerPoints?: Array<{ time: number, label: string }>
      isThumbnailsEnabled?: boolean
      source?: string
    } = {},
  ) {
    const videoRef = shallowRef<HTMLVideoElement | null>(video)

    return scope.run(() => {
      return useVideoTimeline({
        videoRef,
        markerPoints: options.markerPoints ?? [],
        isThumbnailsEnabled: options.isThumbnailsEnabled ?? true,
        getThumbnailSource: () => {
          return options.source ?? '/videos/demo.mp4'
        },
      })
    })!
  }

  function createSlider(): HTMLElement {
    const slider = document.createElement('div')

    slider.getBoundingClientRect = () => {
      return {
        left: 0,
        width: SLIDER_WIDTH,
        right: SLIDER_WIDTH,
        top: 0,
        bottom: 10,
        height: 10,
        x: 0,
        y: 0,
        toJSON: () => {
          return {}
        },
      }
    }

    return slider
  }

  function click(slider: HTMLElement, downX: number, upX = downX) {
    slider.dispatchEvent(new MouseEvent('pointerdown', { clientX: downX }))
    slider.dispatchEvent(new MouseEvent('pointerup', { clientX: upX }))
  }

  function secondsToX(seconds: number): number {
    return seconds / DURATION * SLIDER_WIDTH
  }

  beforeEach(() => {
    environment = installVideoPlayerEnvironment()
    media = environment.media
    media.duration = DURATION
    scope = effectScope()
    video = document.createElement('video')
    currentTimeSetter = vi.fn()
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => {
        return 0
      },
      set: currentTimeSetter,
    })
    mocks.generate.mockReset().mockResolvedValue(null)
    vi.useFakeTimers()
  })

  afterEach(() => {
    scope.stop()
    vi.useRealTimers()
  })

  describe('chapters track', () => {
    it('creates a chapters track url from marker points', async () => {
      const { chaptersTrackUrl } = mountTimeline({
        markerPoints: [{ time: 2, label: 'Start' }],
      })

      expect(chaptersTrackUrl.value).toMatch(/^blob:/)
      expect(await environment.readBlobUrl(chaptersTrackUrl.value!))
        .toContain('00:00:02.000 --> 99:59:59.000\nStart')
    })

    it('creates no chapters track without markers', () => {
      const { chaptersTrackUrl } = mountTimeline()

      expect(chaptersTrackUrl.value).toBeNull()
      expect(environment.createObjectURL).not.toHaveBeenCalled()
    })

    it('revokes the chapters url when the scope is disposed', () => {
      const { chaptersTrackUrl } = mountTimeline({
        markerPoints: [{ time: 2, label: 'Start' }],
      })
      const url = chaptersTrackUrl.value

      scope.stop()

      expect(environment.revokeObjectURL).toHaveBeenCalledWith(url)
      expect(chaptersTrackUrl.value).toBeNull()
    })

    it('switches disabled chapters and metadata tracks to hidden',
      async () => {
        const textTracks = new Map<string, { mode: string }>()

        for (const kind of ['chapters', 'metadata', 'captions']) {
          const trackElement = document.createElement('track')
          const textTrack = { mode: 'disabled' }

          trackElement.kind = kind
          Object.defineProperty(trackElement, 'track', {
            configurable: true,
            get: () => {
              return textTrack
            },
          })
          textTracks.set(kind, textTrack)
          video.append(trackElement)
        }

        textTracks.get('metadata')!.mode = 'showing'

        mountTimeline()
        await nextTick()

        expect(textTracks.get('chapters')!.mode).toBe('hidden')
        expect(textTracks.get('metadata')!.mode).toBe('showing')
        expect(textTracks.get('captions')!.mode).toBe('disabled')
      })
  })

  describe('chapter snap-seek', () => {
    const markerPoints = [
      { time: 10, label: 'Intro' },
      { time: 50, label: 'Middle' },
    ]

    it('snaps a click near a marker to the marker time', () => {
      const { attach } = mountTimeline({ markerPoints })
      const slider = createSlider()

      attach(slider)
      click(slider, secondsToX(12))

      expect(currentTimeSetter).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)

      expect(currentTimeSetter).toHaveBeenCalledExactlyOnceWith(10)
    })

    it('snaps to the nearest marker when several are in range', () => {
      const { attach } = mountTimeline({
        markerPoints: [
          { time: 10, label: 'A' },
          { time: 14, label: 'B' },
        ],
      })
      const slider = createSlider()

      attach(slider)
      click(slider, secondsToX(13))
      vi.advanceTimersByTime(1)

      expect(currentTimeSetter).toHaveBeenCalledExactlyOnceWith(14)
    })

    it('snaps within 4% of the duration and not beyond it', () => {
      const { attach } = mountTimeline({ markerPoints })
      const slider = createSlider()

      attach(slider)
      click(slider, secondsToX(53.9))
      vi.advanceTimersByTime(1)

      expect(currentTimeSetter).toHaveBeenLastCalledWith(50)

      currentTimeSetter.mockClear()
      click(slider, secondsToX(54.5))
      vi.advanceTimersByTime(1)

      expect(currentTimeSetter).not.toHaveBeenCalled()
    })

    it('does not snap a click far from every marker', () => {
      const { attach } = mountTimeline({ markerPoints })
      const slider = createSlider()

      attach(slider)
      click(slider, secondsToX(30))
      vi.advanceTimersByTime(1)

      expect(currentTimeSetter).not.toHaveBeenCalled()
    })

    it('keeps a minimum snap radius of 0.4 seconds on short videos', () => {
      media.duration = 5

      const { attach } = mountTimeline({
        markerPoints: [{ time: 2, label: 'Mid' }],
      })
      const slider = createSlider()

      attach(slider)
      click(slider, 2.3 / 5 * SLIDER_WIDTH)
      vi.advanceTimersByTime(1)

      expect(currentTimeSetter).toHaveBeenLastCalledWith(2)

      currentTimeSetter.mockClear()
      click(slider, 2.5 / 5 * SLIDER_WIDTH)
      vi.advanceTimersByTime(1)

      expect(currentTimeSetter).not.toHaveBeenCalled()
    })

    it('treats a pointer travel of 5px as a click', () => {
      const { attach } = mountTimeline({ markerPoints })
      const slider = createSlider()

      attach(slider)
      click(slider, secondsToX(10), secondsToX(10) + 5)
      vi.advanceTimersByTime(1)

      expect(currentTimeSetter).toHaveBeenCalledExactlyOnceWith(10)
    })

    it('treats a pointer travel of 6px or more as a drag', () => {
      const { attach } = mountTimeline({ markerPoints })
      const slider = createSlider()

      attach(slider)
      click(slider, secondsToX(10), secondsToX(10) + 6)
      click(slider, secondsToX(10), secondsToX(10) - 6)
      vi.advanceTimersByTime(1)

      expect(currentTimeSetter).not.toHaveBeenCalled()
    })

    it('clamps clicks beyond the slider edges', () => {
      const { attach } = mountTimeline({
        markerPoints: [{ time: 99, label: 'End' }],
      })
      const slider = createSlider()

      attach(slider)
      click(slider, SLIDER_WIDTH + 200)
      vi.advanceTimersByTime(1)

      expect(currentTimeSetter).toHaveBeenCalledExactlyOnceWith(99)
    })

    it('applies only the last of two quick clicks', () => {
      const { attach } = mountTimeline({ markerPoints })
      const slider = createSlider()

      attach(slider)
      click(slider, secondsToX(10))
      click(slider, secondsToX(50))
      vi.advanceTimersByTime(1)

      expect(currentTimeSetter).toHaveBeenCalledExactlyOnceWith(50)
    })

    it('does nothing without markers', () => {
      const { attach } = mountTimeline()
      const slider = createSlider()

      attach(slider)
      click(slider, secondsToX(10))
      vi.advanceTimersByTime(1)

      expect(currentTimeSetter).not.toHaveBeenCalled()
    })

    it('does nothing while the duration is unknown', () => {
      media.duration = NaN

      const { attach } = mountTimeline({ markerPoints })
      const slider = createSlider()

      attach(slider)
      click(slider, secondsToX(10))
      vi.advanceTimersByTime(1)

      expect(currentTimeSetter).not.toHaveBeenCalled()
    })

    it('cancels a pending snap when disposed', () => {
      const { attach } = mountTimeline({ markerPoints })
      const slider = createSlider()

      attach(slider)
      click(slider, secondsToX(10))
      scope.stop()
      vi.advanceTimersByTime(1)

      expect(currentTimeSetter).not.toHaveBeenCalled()
    })

    it('stops listening to the slider after dispose', () => {
      const { attach } = mountTimeline({ markerPoints })
      const slider = createSlider()

      attach(slider)
      scope.stop()
      click(slider, secondsToX(10))
      vi.advanceTimersByTime(1)

      expect(currentTimeSetter).not.toHaveBeenCalled()
    })
  })

  describe('preview clamp', () => {
    const PREVIEW_WIDTH = 172
    const PLAYER_WIDTH = 343

    function rect(left: number, width: number): DOMRect {
      return {
        left,
        width,
        right: left + width,
        top: 0,
        bottom: 10,
        height: 10,
        x: left,
        y: 0,
        toJSON: () => {
          return {}
        },
      }
    }

    function createPlayerSlider(left = 60, width = 90) {
      const container = document.createElement('media-container')
      const slider = document.createElement('div')
      const preview = document.createElement('media-slider-preview')

      container.getBoundingClientRect = () => {
        return rect(0, PLAYER_WIDTH)
      }
      slider.getBoundingClientRect = () => {
        return rect(left, width)
      }
      Object.defineProperty(preview, 'offsetWidth', {
        configurable: true,
        value: PREVIEW_WIDTH,
      })
      slider.append(preview)
      container.append(slider)

      return slider
    }

    function readShift(slider: HTMLElement): string {
      return slider.style.getPropertyValue('--video-preview-shift')
    }

    function move(slider: HTMLElement, clientX: number) {
      slider.dispatchEvent(new MouseEvent('pointermove', { clientX }))
    }

    it('pulls the card inside the left edge while the pointer moves', () => {
      const { attach } = mountTimeline()
      const slider = createPlayerSlider()

      attach(slider)
      move(slider, 60)

      expect(readShift(slider)).toBe(`${8 - (60 - PREVIEW_WIDTH / 2)}px`)
    })

    it('pulls the card inside the right edge while the pointer moves', () => {
      const { attach } = mountTimeline()
      const slider = createPlayerSlider(200, 140)

      attach(slider)
      move(slider, 340)

      expect(readShift(slider)).toBe(
        `${PLAYER_WIDTH - PREVIEW_WIDTH - 8 - (340 - PREVIEW_WIDTH / 2)}px`,
      )
    })

    it('keeps the card centered on the pointer in the middle', () => {
      const { attach } = mountTimeline()
      const slider = createPlayerSlider()

      attach(slider)
      move(slider, 120)

      expect(readShift(slider)).toBe('0px')
    })

    it('measures on pointerenter and pointerdown as well', () => {
      const { attach } = mountTimeline()
      const slider = createPlayerSlider()

      attach(slider)
      slider.dispatchEvent(new MouseEvent('pointerenter', { clientX: 60 }))

      expect(readShift(slider)).not.toBe('')

      slider.style.removeProperty('--video-preview-shift')
      slider.dispatchEvent(new MouseEvent('pointerdown', { clientX: 60 }))

      expect(readShift(slider)).not.toBe('')
    })

    it('writes nothing without a preview or a player container', () => {
      const { attach } = mountTimeline()
      const slider = createSlider()

      attach(slider)
      move(slider, 100)

      expect(readShift(slider)).toBe('')
    })

    it('stops moving the card and clears the shift after dispose', () => {
      const { attach } = mountTimeline()
      const slider = createPlayerSlider()

      attach(slider)
      move(slider, 60)
      scope.stop()

      expect(readShift(slider)).toBe('')

      move(slider, 80)

      expect(readShift(slider)).toBe('')
    })

    it('recomputes when the preview card resizes under a held pointer',
      () => {
        const callbacks: Array<() => void> = []
        const disconnect = vi.fn()

        vi.stubGlobal('ResizeObserver', class {
          constructor(callback: () => void) {
            callbacks.push(callback)
          }

          observe() {}

          disconnect = disconnect
        })

        const { attach } = mountTimeline()
        const slider = createPlayerSlider()

        attach(slider)
        move(slider, 60)

        const narrow = readShift(slider)
        const preview = slider.querySelector('media-slider-preview')!

        Object.defineProperty(preview, 'offsetWidth', {
          configurable: true,
          value: 60,
        })
        callbacks[0]!()

        expect(readShift(slider)).not.toBe(narrow)

        scope.stop()

        expect(disconnect).toHaveBeenCalled()
        vi.unstubAllGlobals()
      })
  })

  describe('lazy thumbnails', () => {
    it('does not generate thumbnails on attach', () => {
      const { attach } = mountTimeline()

      attach(createSlider())

      expect(mocks.generate).not.toHaveBeenCalled()
    })

    it('generates once on the first pointerenter or focusin', async () => {
      const { attach } = mountTimeline({ source: '/videos/key.mp4' })
      const slider = createSlider()

      attach(slider)
      slider.dispatchEvent(new Event('pointerenter'))
      slider.dispatchEvent(new Event('focusin'))
      slider.dispatchEvent(new Event('pointerenter'))

      expect(mocks.generate).toHaveBeenCalledExactlyOnceWith(
        '/videos/key.mp4',
        { count: 12, signal: expect.any(AbortSignal) },
      )
    })

    it('never generates when thumbnails are disabled', () => {
      const { attach } = mountTimeline({ isThumbnailsEnabled: false })
      const slider = createSlider()

      attach(slider)
      slider.dispatchEvent(new Event('pointerenter'))
      slider.dispatchEvent(new Event('focusin'))

      expect(mocks.generate).not.toHaveBeenCalled()
    })

    it('ignores a missing slider element', () => {
      const { attach, thumbnailsTrackUrl } = mountTimeline()

      attach(null)

      expect(mocks.generate).not.toHaveBeenCalled()
      expect(thumbnailsTrackUrl.value).toBeNull()
    })

    it('exposes the sprite as a thumbnails track and cleans up on dispose',
      async () => {
        const sprite = createSprite({
          count: 2,
          columns: 2,
          duration: 20,
        })

        mocks.generate.mockResolvedValue(sprite)

        const { attach, thumbnailsTrackUrl } = mountTimeline()
        const slider = createSlider()

        attach(slider)
        slider.dispatchEvent(new Event('pointerenter'))
        await vi.waitFor(() => {
          expect(thumbnailsTrackUrl.value).toMatch(/^blob:/)
        })

        const url = thumbnailsTrackUrl.value!

        expect(await environment.readBlobUrl(url)).toContain(
          '00:00:10.000 --> 00:00:20.000\nblob:sprite#xywh=160,0,160,90',
        )

        scope.stop()

        expect(environment.revokeObjectURL).toHaveBeenCalledWith(url)
        expect(sprite.cleanup).toHaveBeenCalledTimes(1)
        expect(thumbnailsTrackUrl.value).toBeNull()
      })

    it('creates no thumbnails track when generation yields nothing',
      async () => {
        const { attach, thumbnailsTrackUrl } = mountTimeline()
        const slider = createSlider()

        attach(slider)
        slider.dispatchEvent(new Event('pointerenter'))
        await vi.waitFor(() => {
          expect(mocks.generate).toHaveBeenCalledTimes(1)
        })
        await Promise.resolve()

        expect(thumbnailsTrackUrl.value).toBeNull()
      })

    it('aborts generation and releases a late sprite after dispose',
      async () => {
        const sprite = createSprite()
        let resolveGeneration: (value: ThumbnailSprite) => void = () => {}

        mocks.generate.mockReturnValue(new Promise((resolve) => {
          resolveGeneration = resolve
        }))

        const { attach, thumbnailsTrackUrl } = mountTimeline()
        const slider = createSlider()

        attach(slider)
        slider.dispatchEvent(new Event('pointerenter'))

        const { signal } = mocks.generate.mock.calls[0]![1] as {
          signal: AbortSignal
        }

        expect(signal.aborted).toBe(false)

        scope.stop()

        expect(signal.aborted).toBe(true)

        resolveGeneration(sprite)
        await vi.waitFor(() => {
          expect(sprite.cleanup).toHaveBeenCalledTimes(1)
        })

        expect(thumbnailsTrackUrl.value).toBeNull()
      })
  })
})
