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
): 'low' | 'medium' | 'high' | undefined {
  if (reasoningLevel === 'off') {
    return undefined
  }

  return reasoningLevel
}
