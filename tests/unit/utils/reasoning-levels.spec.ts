import { describe, expect, it } from 'vitest'
import {
  getReasoningCapability,
  isReasoningLevelSupported,
  normalizeReasoningLevel,
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
    expect(toReasoningEffort('off')).toBe('none')
    expect(toReasoningEffort('low')).toBe('low')
    expect(toReasoningEffort('medium')).toBe('medium')
    expect(toReasoningEffort('high')).toBe('high')
  })
})
