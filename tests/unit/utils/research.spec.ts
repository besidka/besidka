import { describe, expect, it } from 'vitest'
import type { Provider } from '#shared/types/providers.d'
import {
  getProviderResearch,
  isDeepResearchActive,
  isResearchLevel,
  normalizeResearchLevelSetting,
  researchLevels,
  resolveResearchModel,
} from '../../../shared/utils/research'

function createProvider(withResearch = true): Provider {
  return {
    id: 'openai',
    name: 'OpenAI',
    models: [],
    research: withResearch
      ? {
        assistModel: 'gpt-5.4-nano',
        levels: {
          quick: {
            modelId: 'o4-mini-deep-research',
            label: 'Quick',
            costEstimate: '~$1',
            timeEstimate: '5-15 min',
          },
          thorough: {
            modelId: 'o3-deep-research',
            label: 'Thorough',
            costEstimate: '~$10',
            timeEstimate: '10-30 min',
          },
        },
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

  describe('isDeepResearchActive', () => {
    it('is false for off', () => {
      expect(isDeepResearchActive('off')).toBe(false)
    })

    it('is true for quick and thorough', () => {
      expect(isDeepResearchActive('quick')).toBe(true)
      expect(isDeepResearchActive('thorough')).toBe(true)
    })
  })

  describe('normalizeResearchLevelSetting', () => {
    it('falls back to off for null/undefined/empty', () => {
      expect(normalizeResearchLevelSetting(null)).toBe('off')
      expect(normalizeResearchLevelSetting(undefined)).toBe('off')
      expect(normalizeResearchLevelSetting('')).toBe('off')
    })

    it('falls back to off for an unknown value', () => {
      expect(normalizeResearchLevelSetting('standard')).toBe('off')
    })

    it('passes through valid levels', () => {
      expect(normalizeResearchLevelSetting('quick')).toBe('quick')
      expect(normalizeResearchLevelSetting('thorough')).toBe('thorough')
    })

    it('passes through off explicitly', () => {
      expect(normalizeResearchLevelSetting('off')).toBe('off')
    })
  })

  describe('getProviderResearch', () => {
    it('returns null for a null/undefined provider', () => {
      expect(getProviderResearch(null)).toBeNull()
      expect(getProviderResearch(undefined)).toBeNull()
    })

    it('returns null when the provider has no research capability', () => {
      expect(getProviderResearch(createProvider(false))).toBeNull()
    })

    it('returns the capability when present', () => {
      const capability = getProviderResearch(createProvider(true))

      expect(capability?.assistModel).toBe('gpt-5.4-nano')
      expect(capability?.levels.quick.modelId).toBe('o4-mini-deep-research')
      expect(capability?.levels.thorough.modelId).toBe('o3-deep-research')
    })
  })

  describe('resolveResearchModel', () => {
    it('returns null when the setting is off', () => {
      expect(resolveResearchModel(createProvider(true), 'off')).toBeNull()
    })

    it('returns null when the provider has no research capability', () => {
      expect(
        resolveResearchModel(createProvider(false), 'quick'),
      ).toBeNull()
    })

    it('returns null for a null provider', () => {
      expect(resolveResearchModel(null, 'quick')).toBeNull()
    })

    it('resolves the level config for an active level', () => {
      const config = resolveResearchModel(createProvider(true), 'thorough')

      expect(config?.modelId).toBe('o3-deep-research')
      expect(config?.label).toBe('Thorough')
    })
  })
})
