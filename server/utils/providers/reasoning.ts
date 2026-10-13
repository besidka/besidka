import type { Model } from '#shared/types/providers.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import {
  getReasoningCapability,
  resolveSupportedReasoningLevel,
} from '#shared/utils/reasoning'

export function resolveReasoningLevelForModel(
  model: Model | null,
  requestedReasoning: ReasoningLevel,
): ReasoningLevel {
  return resolveSupportedReasoningLevel(
    requestedReasoning,
    getReasoningCapability(model),
  )
}

export function toReasoningEffort(
  reasoningLevel: ReasoningLevel,
): 'low' | 'medium' | 'high' | undefined {
  if (reasoningLevel === 'off') {
    return undefined
  }

  return reasoningLevel
}
