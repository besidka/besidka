export type ExternalSearchProviderId = 'brave' | 'exa'

export interface ExternalSearchResult {
  title: string
  url: string
  snippet: string
  publishedDate?: string
  author?: string
}

export interface ExternalSearchToolOutput {
  results: ExternalSearchResult[]
  provider: ExternalSearchProviderId
  costDollars?: number
}
