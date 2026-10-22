import type { VideoMenuOption } from '~/types/video-player.d'

export const DEFAULT_VIDEO_SPEED = 1
export const VIDEO_SPEED_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]
export const VIDEO_SPEED_OPTIONS: VideoMenuOption[] = VIDEO_SPEED_RATES.map(
  (rate) => {
    return {
      value: String(rate),
      label: rate === DEFAULT_VIDEO_SPEED ? 'Normal' : `${rate}×`,
    }
  },
)
