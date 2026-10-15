import { describe, expect, it } from 'vitest'
import {
  canDisableReasoning,
  getDefaultReasoningLevel,
  getGatewayReasoningControlState,
  getReplayReasoningControlState,
  getReasoningDropdownLevels,
  resolveSupportedReasoningLevel,
  roundUpReasoningLevel,
  getReasoningBadgeLabel,
  getReasoningCapability,
  getReasoningControlState,
  hasReasoningBadge,
  isReasoningLevelSupported,
  normalizeReasoningLevel,
  shouldSendReasoning,
} from '../../../shared/utils/reasoning'
import {
  resolveReasoningLevelForModel,
  toReasoningEffort,
} from '../../../server/utils/providers/reasoning'

describe('reasoning levels', () => {
  it('normalizes legacy and unsupported values', () => {
    expect(normalizeReasoningLevel(true)).toBe('medium')
    expect(normalizeReasoningLevel(false)).toBe('off')
    expect(normalizeReasoningLevel('hard')).toBe('high')
    expect(normalizeReasoningLevel('xhigh')).toBe('high')
    expect(normalizeReasoningLevel('unknown')).toBe('off')
  })

  it('resolves capability and support checks', () => {
    const capability = getReasoningCapability({
      reasoning: {
        mode: 'levels',
        levels: ['low', 'high'],
      },
    } as any)

    expect(capability).toEqual({
      mode: 'levels',
      levels: ['low', 'high'],
    })
    expect(isReasoningLevelSupported('off', capability)).toBe(true)
    expect(isReasoningLevelSupported('low', capability)).toBe(true)
    expect(isReasoningLevelSupported('medium', capability)).toBe(false)
  })

  it('rounds unsupported model reasoning levels up', () => {
    const model = {
      reasoning: {
        mode: 'levels',
        levels: ['low', 'high'],
      },
    } as any

    expect(resolveReasoningLevelForModel(model, 'medium')).toBe('high')
    expect(resolveReasoningLevelForModel(model, 'high')).toBe('high')
  })

  it('maps canonical levels to the provider-agnostic reasoning effort', () => {
    expect(toReasoningEffort('off')).toBeUndefined()
    expect(toReasoningEffort('low')).toBe('low')
    expect(toReasoningEffort('medium')).toBe('medium')
    expect(toReasoningEffort('high')).toBe('high')
  })

  describe('reasoning control state', () => {
    it('is configurable for a levels or toggle capability', () => {
      expect(getReasoningControlState({
        reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'] },
      })).toBe('configurable')
      expect(getReasoningControlState({
        reasoning: { mode: 'toggle' },
      })).toBe('configurable')
    })

    it('is always-on for a model curated with reasoningAlwaysOn', () => {
      expect(getReasoningControlState({ reasoningAlwaysOn: true }))
        .toBe('always-on')
    })

    it('is none for a model without reasoning, and for a missing model',
      () => {
        expect(getReasoningControlState({})).toBe('none')
        expect(getReasoningControlState(null)).toBe('none')
        expect(getReasoningControlState(undefined)).toBe('none')
      })

    it('is none for a levels capability with no supported level', () => {
      expect(getReasoningControlState({
        reasoning: { mode: 'levels', levels: [] },
      })).toBe('none')
    })

    it('resolves gateway models by gateway reasoning policy', () => {
      expect(getGatewayReasoningControlState('openrouter', true))
        .toBe('configurable')
      expect(getGatewayReasoningControlState('vercel', true))
        .toBe('configurable')
      expect(getGatewayReasoningControlState('cloudflare', true))
        .toBe('always-on')
      expect(getGatewayReasoningControlState('openrouter', false))
        .toBe('none')
      expect(getGatewayReasoningControlState('cloudflare', undefined))
        .toBe('none')
    })

    it('shows the picker badge for every state except none', () => {
      expect(hasReasoningBadge('configurable')).toBe(true)
      expect(hasReasoningBadge('always-on')).toBe(true)
      expect(hasReasoningBadge('none')).toBe(false)
    })

    it('labels always-on models as always reasoning', () => {
      expect(getReasoningBadgeLabel('always-on')).toBe('Always reasons')
      expect(getReasoningBadgeLabel('configurable')).toBe('Reasoning')
    })

    it('forwards reasoning text when a level is chosen or the model '
      + 'always reasons', () => {
      expect(shouldSendReasoning('medium', 'configurable')).toBe(true)
      expect(shouldSendReasoning('off', 'configurable')).toBe(false)
      expect(shouldSendReasoning('off', 'always-on')).toBe(true)
      expect(shouldSendReasoning('off', 'none')).toBe(false)
    })
  })

  it('drops off and falls back to the default for cannot-disable models',
    () => {
      const capability = getReasoningCapability({
        reasoning: {
          mode: 'levels',
          levels: ['low', 'medium', 'high'],
          cannotDisable: true,
          defaultLevel: 'medium',
        },
      })

      expect(canDisableReasoning(capability)).toBe(false)
      expect(isReasoningLevelSupported('off', capability)).toBe(false)
      expect(getReasoningDropdownLevels(capability))
        .toEqual(['low', 'medium', 'high'])
      expect(getDefaultReasoningLevel(capability)).toBe('medium')
      expect(resolveSupportedReasoningLevel('off', capability))
        .toBe('medium')
      expect(resolveSupportedReasoningLevel('high', capability))
        .toBe('high')
    })

  it('rounds the curated default up when the model does not offer it',
    () => {
      const capability = getReasoningCapability({
        reasoning: {
          mode: 'levels',
          levels: ['low', 'high'],
          cannotDisable: true,
          defaultLevel: 'medium',
        },
      })

      expect(getDefaultReasoningLevel(capability)).toBe('high')
    })

  it('defaults to medium rounded up when no default is curated', () => {
    const lowHigh = getReasoningCapability({
      reasoning: {
        mode: 'levels',
        levels: ['low', 'high'],
        cannotDisable: true,
      },
    })
    const allLevels = getReasoningCapability({
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
        cannotDisable: true,
      },
    })

    expect(getDefaultReasoningLevel(lowHigh)).toBe('high')
    expect(resolveSupportedReasoningLevel('off', lowHigh)).toBe('high')
    expect(getDefaultReasoningLevel(allLevels)).toBe('medium')
  })

  describe('roundUpReasoningLevel', () => {
    it('returns the level itself when supported', () => {
      expect(roundUpReasoningLevel('medium', ['low', 'medium', 'high']))
        .toBe('medium')
    })

    it('rounds up to the next supported level', () => {
      expect(roundUpReasoningLevel('medium', ['low', 'high'])).toBe('high')
      expect(roundUpReasoningLevel('low', ['medium', 'high']))
        .toBe('medium')
    })

    it('falls back to the highest level below when none is above', () => {
      expect(roundUpReasoningLevel('high', ['low', 'medium']))
        .toBe('medium')
    })

    it('returns null when no level is offered', () => {
      expect(roundUpReasoningLevel('medium', [])).toBeNull()
    })
  })

  describe('resolveSupportedReasoningLevel rounding', () => {
    it('rounds an unsupported middle level up on a levels model', () => {
      const capability = getReasoningCapability({
        reasoning: { mode: 'levels', levels: ['low', 'high'] },
      })

      expect(resolveSupportedReasoningLevel('medium', capability))
        .toBe('high')
      expect(resolveSupportedReasoningLevel('off', capability)).toBe('off')
    })

    it('rounds down only when nothing above is supported', () => {
      const capability = getReasoningCapability({
        reasoning: { mode: 'levels', levels: ['low', 'medium'] },
      })

      expect(resolveSupportedReasoningLevel('high', capability))
        .toBe('medium')
    })

    it('keeps every non-off level for a toggle model', () => {
      const capability = getReasoningCapability({
        reasoning: { mode: 'toggle' },
      })

      expect(resolveSupportedReasoningLevel('low', capability)).toBe('low')
      expect(resolveSupportedReasoningLevel('off', capability)).toBe('off')
    })

    it('resolves a non-off level to off when the model has no reasoning',
      () => {
        expect(resolveSupportedReasoningLevel('high', null)).toBe('off')
      })
  })

  it('keeps off for models that can disable reasoning', () => {
    const capability = getReasoningCapability({
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    })

    expect(canDisableReasoning(capability)).toBe(true)
    expect(getReasoningDropdownLevels(capability)[0]).toBe('off')
    expect(resolveSupportedReasoningLevel('off', capability)).toBe('off')
  })

  it('replays gateway reasoning by gateway, not by catalog', () => {
    expect(getReplayReasoningControlState('cloudflare', undefined))
      .toBe('always-on')
    expect(getReplayReasoningControlState('openrouter', undefined))
      .toBe('configurable')
    expect(getReplayReasoningControlState(undefined, undefined))
      .toBe('none')
  })
})
