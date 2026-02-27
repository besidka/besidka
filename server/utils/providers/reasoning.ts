import type { Model } from '#shared/types/providers.d'
import type {
  ReasoningLevel,
  ReasoningEnabledLevel,
} from '#shared/types/reasoning.d'
import {
  getReasoningCapability,
  isReasoningLevelSupported,
} from '#shared/utils/reasoning'

const googleGemini25ReasoningBudget: Record<ReasoningEnabledLevel, number> = {
  low: 1024,
  medium: 8192,
  high: 24576,
}

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

export function toOpenAiReasoningEffort(
  reasoningLevel: ReasoningLevel,
): 'low' | 'medium' | 'high' | null {
  if (reasoningLevel === 'off') {
    return null
  }

  return reasoningLevel
}

export function toGoogleReasoningLevel(
  modelId: string,
  reasoningLevel: ReasoningLevel,
): 'low' | 'medium' | 'high' | null {
  if (reasoningLevel === 'off') {
    return null
  }

  if (
    ['gemini-3-pro-preview', 'gemini-3.1-pro-preview'].includes(modelId)
    && reasoningLevel === 'medium'
  ) {
    return 'high'
  }

  return reasoningLevel
}

export function toGoogleGemini25ReasoningBudget(
  reasoningLevel: ReasoningLevel,
): number | null {
  if (reasoningLevel === 'off') {
    return null
  }

  return googleGemini25ReasoningBudget[reasoningLevel]
}
