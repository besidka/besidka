export type LandingEventName
  = | 'landing_page_view'
    | 'cta_click'
    | 'header_cta_click'
    | 'footer_link_click'
    | 'video_play'
    | 'video_complete'
    | 'github_click'
    | 'new_chat_created'

export type ClientLandingEventName = Exclude<
  LandingEventName,
  'new_chat_created'
>

export interface LandingEventData {
  path?: string
  target?: string
  value?: number
}
