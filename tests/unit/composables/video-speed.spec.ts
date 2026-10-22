import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { effectScope, shallowRef } from 'vue'
import type { EffectScope } from 'vue'
import { useVideoSpeed } from '../../../app/composables/video-speed'

describe('useVideoSpeed', () => {
  let scope: EffectScope
  let video: HTMLVideoElement

  function mountSpeed(videoRef = shallowRef<HTMLVideoElement | null>(video)) {
    return scope.run(() => {
      return useVideoSpeed(videoRef)
    })!
  }

  beforeEach(() => {
    scope = effectScope()
    video = document.createElement('video')
  })

  afterEach(() => {
    scope.stop()
  })

  it('starts at the default speed', () => {
    expect(mountSpeed().currentSpeed.value).toBe(1)
  })

  it('applies a known rate to both playback rates', () => {
    const { applySpeed } = mountSpeed()

    applySpeed(1.5)

    expect(video.playbackRate).toBe(1.5)
    expect(video.defaultPlaybackRate).toBe(1.5)
  })

  it.each([3, 0, -1, Number.NaN])('ignores the unsupported rate %s',
    (rate) => {
      const { applySpeed } = mountSpeed()

      applySpeed(rate)

      expect(video.playbackRate).toBe(1)
      expect(video.defaultPlaybackRate).toBe(1)
    })

  it('does nothing without a video element', () => {
    const { applySpeed, syncSpeed, currentSpeed } = mountSpeed(
      shallowRef<HTMLVideoElement | null>(null),
    )

    expect(() => {
      applySpeed(2)
    }).not.toThrow()

    syncSpeed()

    expect(currentSpeed.value).toBe(1)
  })

  it('follows ratechange events', () => {
    const { currentSpeed } = mountSpeed()

    video.playbackRate = 2
    video.dispatchEvent(new Event('ratechange'))

    expect(currentSpeed.value).toBe(2)
  })

  it('resyncs on loadedmetadata when a source switch drops ratechange',
    () => {
      const { currentSpeed } = mountSpeed()

      video.playbackRate = 0.75
      video.dispatchEvent(new Event('loadedmetadata'))

      expect(currentSpeed.value).toBe(0.75)
    })

  it('syncs on demand', () => {
    const { currentSpeed, syncSpeed } = mountSpeed()

    video.playbackRate = 1.25
    syncSpeed()

    expect(currentSpeed.value).toBe(1.25)
  })

  it('stops listening once the scope is disposed', () => {
    const { currentSpeed } = mountSpeed()

    scope.stop()
    video.playbackRate = 2
    video.dispatchEvent(new Event('ratechange'))

    expect(currentSpeed.value).toBe(1)
  })
})
