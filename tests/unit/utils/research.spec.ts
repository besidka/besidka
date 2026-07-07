import { describe, expect, it } from 'vitest'
import {
  getResearchBudget,
  getResearchReasoningLevel,
  isDeepResearchActive,
  isResearchDepth,
  researchDepths,
} from '../../../shared/utils/research'

describe('research', () => {
  describe('isResearchDepth', () => {
    it('accepts each canonical research depth', () => {
      expect(isResearchDepth('quick')).toBe(true)
      expect(isResearchDepth('standard')).toBe(true)
      expect(isResearchDepth('thorough')).toBe(true)
    })

    it('rejects off and unknown values', () => {
      expect(isResearchDepth('off')).toBe(false)
      expect(isResearchDepth('unknown')).toBe(false)
      expect(isResearchDepth('')).toBe(false)
    })
  })

  describe('isDeepResearchActive', () => {
    it('is false when the setting is off', () => {
      expect(isDeepResearchActive('off')).toBe(false)
    })

    it('is true for each research depth', () => {
      for (const depth of researchDepths) {
        expect(isDeepResearchActive(depth)).toBe(true)
      }
    })
  })

  describe('getResearchBudget', () => {
    it('returns the quick budget', () => {
      expect(getResearchBudget('quick')).toEqual({
        maxSteps: 6,
        maxSearches: 4,
        targetSources: 10,
        label: 'Quick',
      })
    })

    it('returns the standard budget', () => {
      expect(getResearchBudget('standard')).toEqual({
        maxSteps: 12,
        maxSearches: 8,
        targetSources: 30,
        label: 'Standard',
      })
    })

    it('returns the thorough budget', () => {
      expect(getResearchBudget('thorough')).toEqual({
        maxSteps: 20,
        maxSearches: 14,
        targetSources: 55,
        label: 'Thorough',
      })
    })

    it('increases steps, searches and target sources with depth', () => {
      const quick = getResearchBudget('quick')
      const standard = getResearchBudget('standard')
      const thorough = getResearchBudget('thorough')

      expect(quick.maxSteps).toBeLessThan(standard.maxSteps)
      expect(standard.maxSteps).toBeLessThan(thorough.maxSteps)
      expect(quick.maxSearches).toBeLessThan(standard.maxSearches)
      expect(standard.maxSearches).toBeLessThan(thorough.maxSearches)
      expect(quick.targetSources).toBeLessThan(standard.targetSources)
      expect(standard.targetSources).toBeLessThan(thorough.targetSources)
    })
  })

  describe('getResearchReasoningLevel', () => {
    it('maps quick and standard to medium effort', () => {
      expect(getResearchReasoningLevel('quick')).toBe('medium')
      expect(getResearchReasoningLevel('standard')).toBe('medium')
    })

    it('maps thorough to high effort', () => {
      expect(getResearchReasoningLevel('thorough')).toBe('high')
    })
  })
})
