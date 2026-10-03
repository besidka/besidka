export type WebSearchSelection
  = 'off'
    | 'web_search'
    | 'web_search_brave'
    | 'web_search_exa'

export interface WebSearchOption {
  value: 'web_search' | 'web_search_brave' | 'web_search_exa'
  label: string
  providerId?: string
  enabled: boolean
  disabledReason?: string
  addKeyHref?: string
}
