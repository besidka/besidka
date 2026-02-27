import { describe, expect, it } from 'vitest'
import {
  getReasoningCapability,
  isReasoningLevelSupported,
  normalizeReasoningLevel,
} from '../../../shared/utils/reasoning'
import {
  resolveReasoningLevelForModel,
  toGoogleGemini25ReasoningBudget,
  toGoogleReasoningLevel,
  toOpenAiReasoningEffort,
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

  it('maps openai effort from canonical levels', () => {
    expect(toOpenAiReasoningEffort('off')).toBeNull()
    expect(toOpenAiReasoningEffort('low')).toBe('low')
    expect(toOpenAiReasoningEffort('medium')).toBe('medium')
    expect(toOpenAiReasoningEffort('high')).toBe('high')
  })

  it('maps google gemini reasoning options', () => {
    expect(
      toGoogleReasoningLevel('gemini-3-pro-preview', 'medium'),
    ).toBe('high')
    expect(
      toGoogleReasoningLevel('gemini-3-flash-preview', 'medium'),
    ).toBe('medium')
    expect(toGoogleGemini25ReasoningBudget('low')).toBe(1024)
    expect(toGoogleGemini25ReasoningBudget('medium')).toBe(8192)
    expect(toGoogleGemini25ReasoningBudget('high')).toBe(24576)
    expect(toGoogleGemini25ReasoningBudget('off')).toBeNull()
  })
})
