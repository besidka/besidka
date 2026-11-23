import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sensitiveWordStart } from '~~/server/utils/memory/sensitivity-rules'

type RuleExpressionConstruction = [source: string, flags: string]

const OriginalRegExp = globalThis.RegExp

function createRuleExpressionCounter() {
  const constructions: RuleExpressionConstruction[] = []

  class CountingRegExp extends OriginalRegExp {
    constructor(pattern: string | RegExp, flags?: string) {
      super(pattern, flags)

      if (
        typeof pattern === 'string'
        && flags === 'u'
        && pattern.startsWith(sensitiveWordStart)
      ) {
        constructions.push([pattern, flags])
      }
    }
  }

  vi.stubGlobal('RegExp', CountingRegExp)

  return constructions
}

describe('lazy compilation of the memory rule expressions', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('sensitivity', () => {
    it('compiles nothing on import', async () => {
      const constructions = createRuleExpressionCounter()

      await import('~~/server/utils/memory/sensitivity')

      expect(constructions).toHaveLength(0)
    })

    it('compiles every rule once on the first call and never again', async () => {
      const constructions = createRuleExpressionCounter()
      const {
        classifySensitiveCategories,
        classifySensitiveText,
        sensitiveTextRules,
      } = await import('~~/server/utils/memory/sensitivity')

      classifySensitiveText('I am allergic to penicillin')

      const compiledAfterFirstCall = constructions.length

      expect(compiledAfterFirstCall).toBe(sensitiveTextRules.length * 2)

      classifySensitiveText('I am a practicing Muslim')
      classifySensitiveCategories('I voted for the Labour candidate')
      classifySensitiveCategories('')

      expect(constructions).toHaveLength(compiledAfterFirstCall)
    })

    it('does not compile for empty text', async () => {
      const constructions = createRuleExpressionCounter()
      const {
        classifySensitiveCategories,
        classifySensitiveText,
      } = await import('~~/server/utils/memory/sensitivity')

      expect(classifySensitiveText('')).toBeNull()
      expect(classifySensitiveCategories('')).toEqual([])
      expect(constructions).toHaveLength(0)
    })

    it('keeps the classification of fixed samples', async () => {
      const {
        classifySensitiveCategories,
        classifySensitiveText,
      } = await import('~~/server/utils/memory/sensitivity')

      expect(classifySensitiveText('I am allergic to penicillin'))
        .toBe('health')
      expect(classifySensitiveText('I am a practicing Muslim'))
        .toBe('religion-or-belief')
      expect(classifySensitiveText('I voted for the Labour candidate'))
        .toBe('political-opinion')
      expect(classifySensitiveText('I am a member of a trade union'))
        .toBe('trade-union')
      expect(classifySensitiveText('The weather is nice today')).toBeNull()
      expect(classifySensitiveCategories('The weather is nice today'))
        .toEqual([])
      expect(classifySensitiveCategories('I am allergic to penicillin'))
        .toContain('health')
    })
  })

  describe('topical never-store', () => {
    it('compiles nothing on import', async () => {
      const constructions = createRuleExpressionCounter()

      await import('~~/server/utils/memory/topical-never-store')

      expect(constructions).toHaveLength(0)
    })

    it('compiles once on the first call and never again', async () => {
      const constructions = createRuleExpressionCounter()
      const {
        detectTopicalNeverStoreKinds,
      } = await import('~~/server/utils/memory/topical-never-store')

      detectTopicalNeverStoreKinds('I served time in prison')

      const compiledAfterFirstCall = constructions.length

      expect(compiledAfterFirstCall).toBeGreaterThan(0)

      detectTopicalNeverStoreKinds('I have a criminal record')
      detectTopicalNeverStoreKinds('Nothing to see here')
      detectTopicalNeverStoreKinds('')

      expect(constructions).toHaveLength(compiledAfterFirstCall)
    })

    it('does not compile for empty text', async () => {
      const constructions = createRuleExpressionCounter()
      const {
        detectTopicalNeverStoreKinds,
      } = await import('~~/server/utils/memory/topical-never-store')

      expect(detectTopicalNeverStoreKinds('')).toEqual([])
      expect(constructions).toHaveLength(0)
    })

    it('keeps the detection of fixed samples', async () => {
      const {
        detectTopicalNeverStoreKinds,
      } = await import('~~/server/utils/memory/topical-never-store')

      expect(detectTopicalNeverStoreKinds('I served time in prison'))
        .toContain('criminal-history')
      expect(detectTopicalNeverStoreKinds('I have a criminal record'))
        .toContain('criminal-history')
      expect(detectTopicalNeverStoreKinds('I like pizza')).toEqual([])
    })
  })
})
