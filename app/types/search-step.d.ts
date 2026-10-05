export type SearchStepFreshness = 'day' | 'week' | 'month' | 'year'

export type SearchStepState
  = 'pending'
    | 'done'
    | 'failed'

export interface SearchStepResult {
  title: string
  url: string
  publishedDate?: string
}

export interface SearchStepData {
  toolName: 'web_search_brave' | 'web_search_exa'
  state: SearchStepState
  query: string
  freshness?: SearchStepFreshness
  results: SearchStepResult[]
  hasOutput: boolean
  errorReason: string
}
