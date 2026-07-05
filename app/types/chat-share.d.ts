export type ChatShareDuration = 'week' | 'month' | 'year' | 'forever'

export interface ChatShare {
  slug: string
  url: string | null
  expiresAt: string | null
  indexable: boolean
  showFiles: boolean
  showMetadata: boolean
}

export interface ChatShareOptions {
  duration: ChatShareDuration
  indexable: boolean
  showFiles: boolean
  showMetadata: boolean
}
