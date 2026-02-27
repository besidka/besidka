import type { ReasoningLevel } from '#shared/types/reasoning.d'

export function getReasoningStepsCount(
  effort: ReasoningLevel,
): number {
  if (effort === 'off') {
    return 0
  }

  if (effort === 'low') {
    return 2
  }

  if (effort === 'high') {
    return 6
  }

  return 4
}
