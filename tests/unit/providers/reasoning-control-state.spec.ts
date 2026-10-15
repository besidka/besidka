import { describe, expect, it } from 'vitest'
import type { Model } from '#shared/types/providers.d'
import type { ReasoningControlState } from '#shared/types/reasoning.d'
import { providers } from '../../../providers'
import {
  canDisableReasoning,
  getReasoningCapability,
  getReasoningControlState,
  getReasoningDropdownLevels,
  getReasoningMenuLevels,
  hasReasoningBadge,
  shouldSendReasoning,
} from '../../../shared/utils/reasoning'
import {
  resolveReasoningLevelForModel,
} from '../../../server/utils/providers/reasoning'

const catalog = providers.flatMap((provider) => {
  return provider.models.map((model) => {
    return { providerId: provider.id, model }
  })
})

const representativeStates: Record<string, ReasoningControlState> = {
  'claude-opus-5-5': 'configurable',
  'claude-haiku-4-5': 'configurable',
  'gemini-3.8-flash': 'configurable',
  'deep-research-preview-04-2026': 'none',
  'gemini-3.1-flash-image': 'none',
  'gpt-6.1-sol': 'configurable',
  'gpt-4.1': 'none',
  'gpt-image-2': 'none',
  'grok-4.20-0309-reasoning': 'always-on',
  'grok-4.20-0309-non-reasoning': 'none',
  'grok-4.5': 'configurable',
  'grok-build-0.1': 'always-on',
  'deepseek-flash': 'configurable',
  'kimi-k2.6': 'configurable',
  'kimi-k3': 'configurable',
  'kimi-k2.7-code': 'always-on',
  'kimi-k2.7-code-highspeed': 'always-on',
  'qwen3.7-plus': 'configurable',
  'qwq-plus': 'always-on',
  'qwen3-max': 'none',
}

/**
 * Models whose provider documents that reasoning cannot be switched off.
 * Their menu offers no `off` and an `off` request resolves to the listed
 * provider default. Sources are cited in docs/chat-reasoning.md.
 */
const cannotDisableDefaults: Record<string, 'low' | 'medium' | 'high'> = {
  'grok-4.7': 'high',
  'grok-4.6': 'high',
  'grok-4.5': 'high',
  'gpt-6.1-sol': 'medium',
  'gpt-5': 'medium',
  'gpt-5-mini': 'medium',
  'gpt-5-nano': 'medium',
  'o3': 'medium',
  'o4-mini': 'medium',
  'gemini-3.8-flash': 'medium',
  'gemini-3.6-flash': 'medium',
  'gemini-3.5-flash': 'medium',
  'gemini-3.1-pro-preview': 'high',
  'gemini-3-pro-preview': 'high',
  'gemini-3-flash-preview': 'high',
  'gemini-2.5-pro': 'medium',
  'claude-opus-5-5': 'medium',
  'kimi-k3': 'high',
}

function findModel(modelId: string): Model {
  const entry = catalog.find((candidate) => {
    return candidate.model.id === modelId
  })

  if (!entry) {
    throw new Error(`Model "${modelId}" is not in the merged catalog`)
  }

  return entry.model
}

function hasCuratedReasoningFlag(model: Model): boolean {
  return !!model.reasoning || !!model.reasoningAlwaysOn
}

describe('reasoning control state across the merged catalog', () => {
  it.each(Object.entries(representativeStates))(
    'resolves %s to %s',
    (modelId, expectedState) => {
      expect(getReasoningControlState(findModel(modelId)))
        .toBe(expectedState)
    },
  )

  it.each(catalog)(
    '$providerId/$model.id: picker badge and input control agree',
    ({ model }) => {
      const state = getReasoningControlState(model)
      const inputLevels = getReasoningMenuLevels(
        getReasoningCapability(model),
      )

      expect(hasReasoningBadge(state)).toBe(hasCuratedReasoningFlag(model))
      expect(state === 'configurable').toBe(inputLevels.length > 0)
    },
  )

  it.each(catalog)(
    '$providerId/$model.id: never curates both a reasoning capability and '
    + 'always-on reasoning',
    ({ model }) => {
      expect(!!model.reasoning && !!model.reasoningAlwaysOn).toBe(false)
    },
  )

  it('sends no effort for always-on models but still forwards their '
    + 'reasoning text', () => {
    const alwaysOnModels = catalog.filter(({ model }) => {
      return getReasoningControlState(model) === 'always-on'
    })

    expect(alwaysOnModels.length).toBeGreaterThan(0)

    for (const { model } of alwaysOnModels) {
      const resolvedLevel = resolveReasoningLevelForModel(model, 'high')

      expect(resolvedLevel).toBe('off')
      expect(shouldSendReasoning(
        resolvedLevel,
        getReasoningControlState(model),
      )).toBe(true)
    }
  })

  it.each(Object.entries(cannotDisableDefaults))(
    '%s cannot disable reasoning and defaults to %s',
    (modelId, defaultLevel) => {
      const model = findModel(modelId)
      const capability = getReasoningCapability(model)

      expect(canDisableReasoning(capability)).toBe(false)
      expect(getReasoningDropdownLevels(capability)).not.toContain('off')
      expect(resolveReasoningLevelForModel(model, 'off')).toBe(defaultLevel)
    },
  )

  it.each(catalog)(
    '$providerId/$model.id: only audited models drop the off level',
    ({ model }) => {
      const capability = getReasoningCapability(model)

      expect(!canDisableReasoning(capability))
        .toBe(model.id in cannotDisableDefaults)
    },
  )
})
