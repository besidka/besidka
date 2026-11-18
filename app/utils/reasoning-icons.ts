import type { ReasoningLevel } from '#shared/types/reasoning.d'

export const REASONING_SECTION_ICON_COMPONENT = 'SvgoThinkHigh'
export const STEPS_SECTION_ICON = 'lucide:list-checks'
export const STEPS_EXPANDED_ICON = 'lucide:list-tree'
export const STEPS_AUTO_HIDE_ICON = 'lucide:timer-reset'

export function getReasoningLevelIconComponent(level: ReasoningLevel): string {
  return `SvgoThink${level.charAt(0).toUpperCase()}${level.slice(1)}`
}
