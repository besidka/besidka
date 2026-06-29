import type { Model } from '#shared/types/providers.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import {
  getReasoningCapability,
  isReasoningLevelSupported,
} from '#shared/utils/reasoning'

export function resolveReasoningLevelForModel(
  model: Model | null,
  requestedReasoning: ReasoningLevel,
): ReasoningLevel {
  const reasoningCapability = getReasoningCapability(model)

  if (!isReasoningLevelSupported(requestedReasoning, reasoningCapability)) {
    return 'off'
  }

  return requestedReasoning
}

export function toReasoningEffort(
  reasoningLevel: ReasoningLevel,
): 'none' | 'low' | 'medium' | 'high' {
  if (reasoningLevel === 'off') {
    return 'none'
  }

  return reasoningLevel
}
