import { describe, expect, it } from 'vitest'
import type { Model } from '#shared/types/providers.d'
import {
  getModelResearch,
  isDeepResearchModel,
  isResearchLevel,
  researchLevels,
} from '../../../shared/utils/research'

function createModel(withResearch = true): Model {
  return {
    id: 'o4-mini-deep-research',
    name: 'o4-mini Deep Research',
    description: 'Deep research model',
    contextLength: 200_000,
    maxOutputTokens: 100_000,
    price: {
      tokens: 1_000_000,
      input: '$2.00',
      output: '$8.00',
    },
    modalities: {
      input: ['text'],
      output: ['text'],
    },
    tools: [],
    research: withResearch
      ? {
        tier: 'quick',
        assistModel: 'gpt-5.4-nano',
        costEstimate: '~$1 / task',
        timeEstimate: '5–15 min',
        maxToolCalls: 30,
      }
      : undefined,
  }
}

describe('shared/utils/research', () => {
  describe('researchLevels', () => {
    it('is ordered quick then thorough', () => {
      expect(researchLevels).toEqual(['quick', 'thorough'])
    })
  })

  describe('isResearchLevel', () => {
    it('accepts known levels', () => {
      expect(isResearchLevel('quick')).toBe(true)
      expect(isResearchLevel('thorough')).toBe(true)
    })

    it('rejects unknown values', () => {
      expect(isResearchLevel('off')).toBe(false)
      expect(isResearchLevel('standard')).toBe(false)
      expect(isResearchLevel('')).toBe(false)
    })
  })

  describe('getModelResearch', () => {
    it('returns null for a null/undefined model', () => {
      expect(getModelResearch(null)).toBeNull()
      expect(getModelResearch(undefined)).toBeNull()
    })

    it('returns null when the model has no research config', () => {
      expect(getModelResearch(createModel(false))).toBeNull()
    })

    it('returns the research config when present', () => {
      const research = getModelResearch(createModel(true))

      expect(research?.tier).toBe('quick')
      expect(research?.assistModel).toBe('gpt-5.4-nano')
      expect(research?.costEstimate).toBe('~$1 / task')
      expect(research?.maxToolCalls).toBe(30)
    })
  })

  describe('isDeepResearchModel', () => {
    it('is false for a null/undefined model', () => {
      expect(isDeepResearchModel(null)).toBe(false)
      expect(isDeepResearchModel(undefined)).toBe(false)
    })

    it('is false for a model without research config', () => {
      expect(isDeepResearchModel(createModel(false))).toBe(false)
    })

    it('is true for a model with research config', () => {
      expect(isDeepResearchModel(createModel(true))).toBe(true)
    })
  })
})
