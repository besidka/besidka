import { describe, expect, it } from 'vitest'
import {
  getGatewayReasoningControlState,
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

  it('drops unsupported model reasoning levels to off', () => {
    const model = {
      reasoning: {
        mode: 'levels',
        levels: ['low', 'high'],
      },
    } as any

    expect(resolveReasoningLevelForModel(model, 'medium')).toBe('off')
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
})
