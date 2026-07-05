import type { ResearchDepth } from '#shared/types/research.d'

export function getResearchStepsCount(
  depth: ResearchDepth,
): number {
  if (depth === 'quick') {
    return 5
  }

  if (depth === 'thorough') {
    return 9
  }

  return 7
}
