import type { Model } from '#shared/types/providers.d'
import type {
  ReasoningLevel,
  ReasoningEnabledLevel,
  ReasoningCapability,
} from '#shared/types/reasoning.d'

export const reasoningEnabledLevels: ReasoningEnabledLevel[] = [
  'low',
  'medium',
  'high',
]

export function normalizeReasoningLevel(
  value: unknown,
): ReasoningLevel {
  if (value === true) {
    return 'medium'
  }

  if (value === false || value == null) {
    return 'off'
  }

  if (value === 'hard' || value === 'xhigh') {
    return 'high'
  }

  if (value === 'off' || value === 'low'
    || value === 'medium' || value === 'high') {
    return value
  }

  return 'off'
}

export function getReasoningCapability(
  model: Pick<Model, 'reasoning'> | null | undefined,
): ReasoningCapability | null {
  if (!model?.reasoning) {
    return null
  }

  if (model.reasoning.mode === 'toggle') {
    return model.reasoning
  }

  const levels = reasoningEnabledLevels.filter((level) => {
    return model.reasoning?.mode === 'levels'
      && model.reasoning.levels.includes(level)
  })

  if (levels.length === 0) {
    return null
  }

  return {
    mode: 'levels',
    levels,
  }
}

export function isReasoningEnabled(
  level: ReasoningLevel,
): boolean {
  return level !== 'off'
}

export function isReasoningLevelSupported(
  level: ReasoningLevel,
  capability: ReasoningCapability | null,
): boolean {
  if (level === 'off') {
    return true
  }

  if (!capability) {
    return false
  }

  if (capability.mode === 'toggle') {
    return true
  }

  return capability.levels.includes(level)
}

export function getReasoningDropdownLevels(
  capability: ReasoningCapability | null,
): ReasoningLevel[] {
  if (!capability) {
    return ['off']
  }

  if (capability.mode === 'toggle') {
    return ['off', 'medium']
  }

  return ['off', ...capability.levels]
}
