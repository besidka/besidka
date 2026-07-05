export type ChatShareDuration
  = | 'day'
    | 'week'
    | 'month'
    | 'year'
    | 'never'

export interface ChatShare {
  slug: string
  url: string | null
  expiresAt: string | null
  indexable: boolean
  showFiles: boolean
  showMetadata: boolean
  showAuthorAvatar: boolean
  allowBranch: boolean
}

export interface ChatShareOptions {
  duration: ChatShareDuration
  indexable: boolean
  showFiles: boolean
  showMetadata: boolean
  showAuthorAvatar: boolean
  allowBranch: boolean
}
