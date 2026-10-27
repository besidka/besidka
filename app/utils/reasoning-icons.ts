import type { ReasoningLevel } from '#shared/types/reasoning.d'

export const REASONING_SECTION_ICON_COMPONENT = 'SvgoThinkHigh'
export const REASONING_EXPANDED_ICON = 'lucide:list-tree'
export const REASONING_AUTO_HIDE_ICON = 'lucide:timer-reset'

export function getReasoningLevelIconComponent(level: ReasoningLevel): string {
  return `SvgoThink${level.charAt(0).toUpperCase()}${level.slice(1)}`
}
