import type {
  ResearchDepth, ResearchBudget, ResearchDepthSetting,
} from '#shared/types/research.d'
import type { ReasoningEnabledLevel } from '#shared/types/reasoning.d'

export const researchDepths: ResearchDepth[] = [
  'quick', 'standard', 'thorough',
]

export function isResearchDepth(value: string): value is ResearchDepth {
  return (researchDepths as string[]).includes(value)
}

export function isDeepResearchActive(
  depth: ResearchDepthSetting,
): depth is ResearchDepth {
  return depth !== 'off'
}

export function normalizeResearchDepthSetting(
  value: string | null,
): ResearchDepthSetting {
  if (value && isResearchDepth(value)) {
    return value
  }

  return 'off'
}

export function getResearchBudget(depth: ResearchDepth): ResearchBudget {
  switch (depth) {
    case 'quick':
      return {
        maxSteps: 6,
        maxSearches: 4,
        targetSources: 10,
        label: 'Quick',
      }
    case 'standard':
      return {
        maxSteps: 12,
        maxSearches: 8,
        targetSources: 30,
        label: 'Standard',
      }
    case 'thorough':
      return {
        maxSteps: 20,
        maxSearches: 14,
        targetSources: 55,
        label: 'Thorough',
      }
  }
}

export function getResearchReasoningLevel(
  depth: ResearchDepth,
): ReasoningEnabledLevel {
  return depth === 'thorough'
    ? 'high'
    : 'medium'
}
