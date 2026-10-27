import type { SharePiiCheckResult } from '#shared/types/share-pii.d'

export type ChatShareDuration
  = | 'hour'
    | 'day'
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

export type ChatShareCheckStatus = 'idle' | 'pending' | 'done' | 'error'

export interface ChatShareCheckState {
  status: ChatShareCheckStatus
  result: SharePiiCheckResult | null
}

export interface ChatShareCheckOptions {
  showFiles: boolean
  showMetadata: boolean
}
