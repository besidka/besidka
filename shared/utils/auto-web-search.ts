export const WEB_SEARCH_MODES = ['auto', 'always'] as const

export type WebSearchMode = typeof WEB_SEARCH_MODES[number]

export const DEFAULT_WEB_SEARCH_MODE: WebSearchMode = 'always'

export const AUTO_WEB_SEARCH_OUTCOMES = [
  'searched',
  'skipped',
  'forced',
  'fallback',
] as const

export type AutoWebSearchOutcome = typeof AUTO_WEB_SEARCH_OUTCOMES[number]

export const AUTO_WEB_SEARCH_PREFERENCE_KEY = 'settings_web_search_auto'

export const AUTO_WEB_SEARCH_PREFERENCE_ON = 'on'

export const AUTO_WEB_SEARCH_PREFERENCE_OFF = 'off'

export const AUTO_WEB_SEARCH_HINT = 'Searches only when a message needs it.'

export const AUTO_WEB_SEARCH_EXPLANATION = 'TypeSafe AI decides per message '
  + 'whether a web search is needed. Searches with the provider you picked. '
  + 'If TypeSafe AI doesn\'t answer, Besidka searches.'

export const AUTO_WEB_SEARCH_PICK_PROVIDER_HINT = 'Pick a provider above to '
  + 'use Auto.'

const SEARCHED_LABEL = 'Auto: searched the web'
const SKIPPED_LABEL = 'Auto: no web search needed'

export function isAutoWebSearchOutcome(
  value: unknown,
): value is AutoWebSearchOutcome {
  return AUTO_WEB_SEARCH_OUTCOMES.includes(value as AutoWebSearchOutcome)
}

export function didAutoWebSearchSearch(
  outcome: AutoWebSearchOutcome,
): boolean {
  return outcome !== 'skipped'
}

export function getAutoWebSearchChipLabel(
  outcome: AutoWebSearchOutcome,
): string {
  return didAutoWebSearchSearch(outcome) ? SEARCHED_LABEL : SKIPPED_LABEL
}
