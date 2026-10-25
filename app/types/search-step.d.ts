export type SearchStepFreshness = 'day' | 'week' | 'month' | 'year'

export type SearchStepState
  = 'pending'
    | 'done'
    | 'failed'

export interface SearchStepResult {
  title: string
  url: string
  publishedDate?: string
  internalPath?: string
}

export interface SearchStepData {
  toolName:
    | 'web_search_brave'
    | 'web_search_exa'
    | 'web_search'
    | 'search_chats'
    | 'read_chat'
  state: SearchStepState
  query: string
  freshness?: SearchStepFreshness
  results: SearchStepResult[]
  hasOutput: boolean
  errorReason: string
}
