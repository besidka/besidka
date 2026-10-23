import type { ExaSearchLevel } from '#shared/utils/exa-search-level'

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
  searchLevel?: ExaSearchLevel
  costDollars?: number
}
