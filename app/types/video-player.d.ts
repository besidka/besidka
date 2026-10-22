import type { VideoPlayerElement } from '@videojs/html/video'

export interface VideoMenuOption {
  value: string
  label: string
}

export interface VideoShellReadyPayload {
  player: VideoPlayerElement
  timeSlider: HTMLElement | null
}

export interface NetworkConnectionHints {
  saveData?: boolean
  effectiveType?: string
}

export interface NavigatorWithConnection extends Navigator {
  connection?: NetworkConnectionHints
}
