import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'
import type { EffectScope } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { useVideoQuality } from '../../../app/composables/video-quality'

const QUALITIES = [
  { src: '/videos/key-guide-google-360.mp4', size: 360 },
  { src: '/videos/key-guide-google-1080.mp4', size: 1080 },
  { src: '/videos/key-guide-google.mp4?v=2', size: 720 },
]

const FALLBACK_SRC = '/videos/key-guide-google.mp4?v=2'

interface MountOptions {
  qualities?: typeof QUALITIES
  pendingStartAt?: number
  onRestored?: () => void
  onSettled?: () => void
}

describe('useVideoQuality', () => {
  let scope: EffectScope
  let video: HTMLVideoElement
  let measureElement: HTMLElement

  function mountQuality(options: MountOptions = {}) {
    const videoRef = shallowRef<HTMLVideoElement | null>(video)

    return scope.run(() => {
      return useVideoQuality({
        videoRef,
        qualities: () => {
          return options.qualities ?? QUALITIES
        },
        fallbackSrc: () => {
          return FALLBACK_SRC
        },
        measureElement: () => {
          return measureElement
        },
        getPendingStartAt: () => {
          return options.pendingStartAt
        },
        onRestored: options.onRestored,
        onSettled: options.onSettled,
      })
    })!
  }

  function stubStartEnvironment(
    width: number,
    devicePixelRatio = 1,
    connection?: { saveData?: boolean, effectiveType?: string },
  ) {
    vi.spyOn(measureElement, 'getBoundingClientRect').mockReturnValue({
      width,
    } as DOMRect)
    vi.stubGlobal('devicePixelRatio', devicePixelRatio)
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: connection,
    })
  }

  function stubPlaying(isPlaying: boolean) {
    vi.spyOn(video, 'paused', 'get').mockReturnValue(!isPlaying)
  }

  beforeEach(() => {
    scope = effectScope()
    video = document.createElement('video')
    measureElement = document.createElement('div')
    stubStartEnvironment(0)
  })

  afterEach(() => {
    scope.stop()
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: undefined,
    })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('options', () => {
    it('lists the renditions from highest to lowest as menu options',
      () => {
        const { qualityOptions } = mountQuality()

        expect(qualityOptions.value).toEqual([
          { value: '1080', label: '1080p' },
          { value: '720', label: '720p' },
          { value: '360', label: '360p' },
        ])
      })

    it('has no options without renditions', () => {
      const { qualityOptions } = mountQuality({ qualities: [] })

      expect(qualityOptions.value).toEqual([])
    })
  })

  describe('start rendition', () => {
    it('has no source until the start rendition is resolved', () => {
      const { currentSrc, selectedQualityValue } = mountQuality()

      expect(currentSrc.value).toBeUndefined()
      expect(selectedQualityValue.value).toBe('')
    })

    it('uses the fallback source when there are no renditions', () => {
      const { currentSrc, resolveStartQuality } = mountQuality({
        qualities: [],
      })

      expect(currentSrc.value).toBe(FALLBACK_SRC)

      resolveStartQuality()

      expect(currentSrc.value).toBe(FALLBACK_SRC)
    })

    it.each([
      [343, 1, undefined, '360'],
      [343, 3, undefined, '720'],
      [672, 1, undefined, '720'],
      [672, 2, undefined, '1080'],
      [1400, 2, undefined, '1080'],
      [672, 2, { saveData: true }, '360'],
      [672, 2, { effectiveType: '3g' }, '360'],
    ])('picks by the measured width %s at %sx with %j: %sp',
      (width, ratio, connection, expected) => {
        stubStartEnvironment(width, ratio, connection)

        const { resolveStartQuality, selectedQualityValue } = mountQuality()

        resolveStartQuality()

        expect(selectedQualityValue.value).toBe(expected)
      })

    it('falls back to 720 when the element cannot be measured', () => {
      const { resolveStartQuality, selectedQualityValue, currentSrc }
        = mountQuality()

      resolveStartQuality()

      expect(selectedQualityValue.value).toBe('720')
      expect(currentSrc.value).toBe('/videos/key-guide-google.mp4?v=2')
    })

    it('falls back to the largest rendition without a 720 one', () => {
      const { resolveStartQuality, selectedQualityValue } = mountQuality({
        qualities: [QUALITIES[0]!, QUALITIES[1]!],
      })

      resolveStartQuality()

      expect(selectedQualityValue.value).toBe('1080')
    })

    it('lets a saved quality win over the heuristic', () => {
      stubStartEnvironment(343, 1)

      const { resolveStartQuality, selectedQualityValue, getUserQuality }
        = mountQuality()

      resolveStartQuality(1080)

      expect(selectedQualityValue.value).toBe('1080')
      expect(getUserQuality()).toBe(1080)
    })

    it('ignores a saved quality that is not offered', () => {
      const { resolveStartQuality, selectedQualityValue, getUserQuality }
        = mountQuality()

      resolveStartQuality(480)

      expect(selectedQualityValue.value).toBe('720')
      expect(getUserQuality()).toBeNull()
    })

    it('never counts the heuristic pick as a user choice', () => {
      stubStartEnvironment(343, 1)

      const { resolveStartQuality, getUserQuality } = mountQuality()

      resolveStartQuality()

      expect(getUserQuality()).toBeNull()
    })

    it('does not touch the video element while resolving', () => {
      const load = vi.spyOn(video, 'load')
      const play = vi.spyOn(video, 'play')
      const { resolveStartQuality } = mountQuality()

      resolveStartQuality()

      expect(load).not.toHaveBeenCalled()
      expect(play).not.toHaveBeenCalled()
    })
  })

  describe('user quality', () => {
    it('remembers only offered renditions', () => {
      const { rememberUserQuality, getUserQuality } = mountQuality()

      rememberUserQuality(480)

      expect(getUserQuality()).toBeNull()

      rememberUserQuality(360)

      expect(getUserQuality()).toBe(360)
    })
  })

  describe('thumbnail source', () => {
    it('is the 720 rendition, query included', () => {
      expect(mountQuality().thumbnailSource())
        .toBe('/videos/key-guide-google.mp4?v=2')
    })

    it('falls back to the source without a 720 rendition', () => {
      expect(mountQuality({ qualities: [QUALITIES[1]!] }).thumbnailSource())
        .toBe(FALLBACK_SRC)
    })
  })

  describe('selectQuality', () => {
    it('swaps the source and restores time, rate and play state on '
      + 'loadedmetadata', async () => {
      const onRestored = vi.fn()
      const onSettled = vi.fn()
      const quality = mountQuality({ onRestored, onSettled })
      const play = vi.spyOn(video, 'play').mockResolvedValue()

      quality.resolveStartQuality()
      video.currentTime = 12
      video.playbackRate = 1.5
      stubPlaying(true)
      quality.selectQuality(1080)

      expect(quality.currentSrc.value).toBe(
        '/videos/key-guide-google-1080.mp4',
      )
      expect(quality.isResumingAfterSwitch()).toBe(true)

      video.currentTime = 0
      video.playbackRate = 1
      video.dispatchEvent(new Event('loadedmetadata'))
      await flushPromises()

      expect(video.currentTime).toBe(12)
      expect(video.playbackRate).toBe(1.5)
      expect(video.defaultPlaybackRate).toBe(1.5)
      expect(onRestored).toHaveBeenCalledTimes(1)
      expect(play).toHaveBeenCalledTimes(1)
      expect(quality.isResumingAfterSwitch()).toBe(false)
      expect(onSettled).toHaveBeenCalledTimes(1)
    })

    it('keeps a paused video paused and never reports a resume', async () => {
      const onSettled = vi.fn()
      const quality = mountQuality({ onSettled })
      const play = vi.spyOn(video, 'play').mockResolvedValue()

      quality.resolveStartQuality()
      video.currentTime = 30
      quality.selectQuality(360)

      expect(quality.isResumingAfterSwitch()).toBe(false)

      video.currentTime = 0
      video.dispatchEvent(new Event('loadedmetadata'))
      await flushPromises()

      expect(video.currentTime).toBe(30)
      expect(play).not.toHaveBeenCalled()
      expect(onSettled).not.toHaveBeenCalled()
    })

    it('keeps the original resume point across back-to-back switches',
      async () => {
        const onSettled = vi.fn()
        const quality = mountQuality({ onSettled })
        const play = vi.spyOn(video, 'play').mockResolvedValue()

        quality.resolveStartQuality()
        video.currentTime = 12
        video.playbackRate = 1.5
        stubPlaying(true)
        quality.selectQuality(1080)
        video.currentTime = 0
        video.playbackRate = 1
        stubPlaying(false)
        quality.selectQuality(360)

        expect(quality.isResumingAfterSwitch()).toBe(true)

        video.dispatchEvent(new Event('loadedmetadata'))
        await flushPromises()

        expect(video.currentTime).toBe(12)
        expect(video.playbackRate).toBe(1.5)
        expect(play).toHaveBeenCalledTimes(1)
        expect(onSettled).toHaveBeenCalledTimes(1)

        video.currentTime = 40
        video.dispatchEvent(new Event('loadedmetadata'))
        await flushPromises()

        expect(video.currentTime).toBe(40)
        expect(play).toHaveBeenCalledTimes(1)
      })

    it('keeps a paused state across back-to-back switches', async () => {
      const quality = mountQuality()
      const play = vi.spyOn(video, 'play').mockResolvedValue()

      quality.resolveStartQuality()
      video.currentTime = 30
      quality.selectQuality(1080)
      video.currentTime = 0
      quality.selectQuality(360)
      video.dispatchEvent(new Event('loadedmetadata'))
      await flushPromises()

      expect(video.currentTime).toBe(30)
      expect(play).not.toHaveBeenCalled()
    })

    it('seeds the resume point with a pending startAt', async () => {
      const quality = mountQuality({ pendingStartAt: 20 })

      quality.resolveStartQuality()
      video.currentTime = 0
      quality.selectQuality(1080)
      video.dispatchEvent(new Event('loadedmetadata'))
      await flushPromises()

      expect(video.currentTime).toBe(20)
    })

    it('falls back to the start when the resume point is past the new '
      + 'duration', async () => {
      const quality = mountQuality()

      quality.resolveStartQuality()
      video.currentTime = 60
      quality.selectQuality(1080)
      vi.spyOn(video, 'duration', 'get').mockReturnValue(34)
      video.dispatchEvent(new Event('loadedmetadata'))
      await flushPromises()

      expect(video.currentTime).toBe(0)
    })

    it('settles when the resumed play is rejected', async () => {
      const onSettled = vi.fn()
      const quality = mountQuality({ onSettled })

      vi.spyOn(video, 'play').mockRejectedValue(new Error('blocked'))
      quality.resolveStartQuality()
      stubPlaying(true)
      quality.selectQuality(1080)
      video.dispatchEvent(new Event('loadedmetadata'))
      await flushPromises()

      expect(quality.isResumingAfterSwitch()).toBe(false)
      expect(onSettled).toHaveBeenCalledTimes(1)
    })

    it('stops waiting for a resume when the new source errors', async () => {
      const onSettled = vi.fn()
      const quality = mountQuality({ onSettled })
      const play = vi.spyOn(video, 'play').mockResolvedValue()

      quality.resolveStartQuality()
      stubPlaying(true)
      quality.selectQuality(1080)
      video.dispatchEvent(new Event('error'))
      video.dispatchEvent(new Event('loadedmetadata'))
      await flushPromises()

      expect(quality.isResumingAfterSwitch()).toBe(false)
      expect(play).not.toHaveBeenCalled()
      expect(onSettled).not.toHaveBeenCalled()
    })

    it('stops waiting for a resume once the scope is disposed', async () => {
      const quality = mountQuality()
      const play = vi.spyOn(video, 'play').mockResolvedValue()

      quality.resolveStartQuality()
      stubPlaying(true)
      quality.selectQuality(1080)
      scope.stop()
      video.dispatchEvent(new Event('loadedmetadata'))
      await flushPromises()

      expect(quality.isResumingAfterSwitch()).toBe(false)
      expect(play).not.toHaveBeenCalled()
    })

    it('ignores unknown sizes and the current rendition', async () => {
      const quality = mountQuality()

      quality.resolveStartQuality()
      quality.selectQuality(480)
      quality.selectQuality(720)
      await nextTick()

      expect(quality.currentSrc.value).toBe(
        '/videos/key-guide-google.mp4?v=2',
      )
      expect(quality.isResumingAfterSwitch()).toBe(false)
    })

    it('does nothing without a video element', () => {
      const quality = scope.run(() => {
        return useVideoQuality({
          videoRef: shallowRef<HTMLVideoElement | null>(null),
          qualities: () => {
            return QUALITIES
          },
          fallbackSrc: () => {
            return FALLBACK_SRC
          },
          measureElement: () => {
            return null
          },
        })
      })!

      quality.resolveStartQuality()
      quality.selectQuality(1080)

      expect(quality.selectedQualityValue.value).toBe('720')
    })

    it('lifts preload none so the resume point can be restored', () => {
      const quality = mountQuality()

      video.preload = 'none'
      quality.resolveStartQuality()
      quality.selectQuality(1080)

      expect(video.preload).toBe('metadata')
    })

    it('leaves a metadata preload alone', () => {
      const quality = mountQuality()

      video.preload = 'auto'
      quality.resolveStartQuality()
      quality.selectQuality(1080)

      expect(video.preload).toBe('auto')
    })
  })
})
