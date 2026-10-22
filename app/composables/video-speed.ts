import {
  DEFAULT_VIDEO_SPEED,
  VIDEO_SPEED_RATES,
} from '~/utils/video-speed'

/**
 * Tracks the native playback rate of a `<video>` and applies a menu choice
 * to both `playbackRate` and `defaultPlaybackRate`, so the rate survives a
 * source switch. The rate is read from the element, never from the Video.js
 * store, which keeps a stale value after a source change.
 */
export function useVideoSpeed(
  videoRef: Readonly<ShallowRef<HTMLVideoElement | null>>,
) {
  const currentSpeed = shallowRef<number>(DEFAULT_VIDEO_SPEED)

  function syncSpeed() {
    currentSpeed.value = videoRef.value?.playbackRate ?? DEFAULT_VIDEO_SPEED
  }

  function applySpeed(rate: number) {
    const video = videoRef.value

    if (!video || !VIDEO_SPEED_RATES.includes(rate)) {
      return
    }

    video.defaultPlaybackRate = rate
    video.playbackRate = rate
  }

  useEventListener(videoRef, 'loadedmetadata', syncSpeed)
  useEventListener(videoRef, 'ratechange', syncSpeed)

  return { currentSpeed, applySpeed, syncSpeed }
}
