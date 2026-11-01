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

const SEARCHED_LABEL = 'Auto: searched the web'
const SKIPPED_LABEL = 'Auto: no web search needed'
const NOT_USED_LABEL = 'Auto: search allowed, not used'

const SEARCH_TOOL_PART_TYPES = new Set([
  'tool-web_search',
  'tool-web_search_preview',
  'tool-web_search_brave',
  'tool-web_search_exa',
])

const SEARCH_SOURCE_PART_TYPES = new Set([
  'source-url',
  'source-document',
])

export type AutoWebSearchChipState = {
  label: string
  icon: string
  searched: boolean
}

export function isAutoWebSearchOutcome(
  value: unknown,
): value is AutoWebSearchOutcome {
  return AUTO_WEB_SEARCH_OUTCOMES.includes(value as AutoWebSearchOutcome)
}

export function didMessageSearchTheWeb(
  parts: unknown,
  searchUnits: unknown,
): boolean {
  if (typeof searchUnits === 'number' && searchUnits > 0) {
    return true
  }

  if (!Array.isArray(parts)) {
    return false
  }

  return parts.some((part) => {
    if (typeof part !== 'object' || part === null || !('type' in part)) {
      return false
    }

    if (SEARCH_SOURCE_PART_TYPES.has(part.type as string)) {
      return true
    }

    return SEARCH_TOOL_PART_TYPES.has(part.type as string)
      && 'state' in part
      && part.state === 'output-available'
  })
}

export function getAutoWebSearchChipState(
  outcome: AutoWebSearchOutcome,
  didSearch: boolean,
): AutoWebSearchChipState {
  if (outcome === 'skipped') {
    return {
      label: SKIPPED_LABEL,
      icon: 'lucide:circle-slash-2',
      searched: false,
    }
  }

  if (didSearch) {
    return { label: SEARCHED_LABEL, icon: 'lucide:globe', searched: true }
  }

  return { label: NOT_USED_LABEL, icon: 'lucide:search-x', searched: false }
}
