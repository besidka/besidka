import type { UtmParams } from '#shared/utils/utm'

export type LandingEventName
  = | 'landing_page_view'
    | 'cta_click'
    | 'header_cta_click'
    | 'footer_link_click'
    | 'video_play'
    | 'video_complete'
    | 'github_click'
    | 'key_guide_open'
    | 'key_guide_video_play'
    | 'video_watch'
    | 'new_chat_created'

export type ClientLandingEventName = Exclude<
  LandingEventName,
  'new_chat_created'
>

export type VideoTrigger = 'autoplay' | 'user'

export type KeyGuideOpenTrigger = 'auto' | 'user'

export type ClientEventTrigger = VideoTrigger | KeyGuideOpenTrigger

export type VideoWatchEndReason
  = | 'pause'
    | 'ended'
    | 'hidden'
    | 'offscreen'
    | 'unmount'

export type AnalyticsSurface = 'home' | 'keys' | 'guide' | 'byok' | 'legal'

export interface LandingEventData {
  path?: string
  target?: string
  value?: number
  utm?: UtmParams
  trigger?: ClientEventTrigger
  watchedSeconds?: number
  durationSeconds?: number
  completionPercent?: number
  endReason?: VideoWatchEndReason
}

export interface LandingTrackOptions {
  keepalive?: boolean
}

export type ActivationEventName
  = | 'signup_completed'
    | 'first_provider_key_added'
    | 'first_chat_message'
