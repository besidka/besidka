import type { VideoPlayerElement } from '@videojs/html/video'

export interface VideoMenuOption {
  value: string
  label: string
}

export interface VideoShellReadyPayload {
  player: VideoPlayerElement
  timeSlider: HTMLElement | null
}
