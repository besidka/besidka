import type {
  ResearchDepth, ResearchBudget, ResearchDepthSetting,
} from '#shared/types/research.d'

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
      return { maxSteps: 5, maxSearches: 3, label: 'Quick' }
    case 'standard':
      return { maxSteps: 9, maxSearches: 6, label: 'Standard' }
    case 'thorough':
      return { maxSteps: 14, maxSearches: 10, label: 'Thorough' }
  }
}
