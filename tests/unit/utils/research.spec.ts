import { describe, expect, it } from 'vitest'
import {
  getResearchBudget,
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
        maxSteps: 5,
        maxSearches: 3,
        label: 'Quick',
      })
    })

    it('returns the standard budget', () => {
      expect(getResearchBudget('standard')).toEqual({
        maxSteps: 9,
        maxSearches: 6,
        label: 'Standard',
      })
    })

    it('returns the thorough budget', () => {
      expect(getResearchBudget('thorough')).toEqual({
        maxSteps: 14,
        maxSearches: 10,
        label: 'Thorough',
      })
    })

    it('increases steps and searches with depth', () => {
      const quick = getResearchBudget('quick')
      const standard = getResearchBudget('standard')
      const thorough = getResearchBudget('thorough')

      expect(quick.maxSteps).toBeLessThan(standard.maxSteps)
      expect(standard.maxSteps).toBeLessThan(thorough.maxSteps)
      expect(quick.maxSearches).toBeLessThan(standard.maxSearches)
      expect(standard.maxSearches).toBeLessThan(thorough.maxSearches)
    })
  })
})
