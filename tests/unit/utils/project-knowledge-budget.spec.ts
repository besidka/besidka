import { describe, expect, it } from 'vitest'
import type {
  KnowledgeDecisionInput,
} from '#shared/types/project-knowledge.d'
import {
  addKnowledgeCharCounts,
  computeKnowledgeBudget,
  computeReservedOutputTokens,
  countKnowledgeChars,
  decideKnowledgeMode,
  estimateKnowledgeTextTokens,
  estimateKnowledgeTokens,
  measuredHistoryTokens,
  resolveKnowledgeTokenFamily,
} from '#shared/utils/project-knowledge-budget'
import {
  KNOWLEDGE_BUDGET,
  KNOWLEDGE_CHARS_PER_TOKEN,
  KNOWLEDGE_LIMITS,
  knowledgeTokenFamilies,
} from '#shared/utils/project-knowledge-policy'

const zeroCounts = { latinChars: 0, cyrillicChars: 0, otherChars: 0 }

function buildInput(
  overrides: Partial<KnowledgeDecisionInput> = {},
): KnowledgeDecisionInput {
  return {
    mode: 'auto',
    knowledgeTokens: 1000,
    contextWindow: 1_000_000,
    maxOutputTokens: null,
    messageTokens: 0,
    measuredHistoryTokens: null,
    estimatedSystemTokens: 0,
    estimatedHistoryTokens: 0,
    toolTokens: 0,
    ...overrides,
  }
}

describe('countKnowledgeChars', () => {
  it('returns zeros for an empty string', () => {
    expect(countKnowledgeChars('')).toEqual(zeroCounts)
  })

  it('counts Latin, Cyrillic and other characters', () => {
    expect(countKnowledgeChars('abcя漢')).toEqual({
      latinChars: 3,
      cyrillicChars: 1,
      otherChars: 1,
    })
  })

  it('counts accented Latin as Latin', () => {
    expect(countKnowledgeChars('ąćęłńóśźż').latinChars).toBe(9)
  })

  it('counts the Cyrillic supplement and Ukrainian letters as Cyrillic', () => {
    expect(countKnowledgeChars('їєґІ')).toEqual({
      latinChars: 0,
      cyrillicChars: 4,
      otherChars: 0,
    })
  })

  it('counts an emoji surrogate pair as one other character', () => {
    expect(countKnowledgeChars('😀😀')).toEqual({
      latinChars: 0,
      cyrillicChars: 0,
      otherChars: 2,
    })
  })

  it('treats typographic punctuation as other characters', () => {
    expect(countKnowledgeChars('—…').otherChars).toBe(2)
  })

  it('counts whitespace and digits as Latin', () => {
    expect(countKnowledgeChars('1 2\n3').latinChars).toBe(5)
  })

  it('keeps the default family at least as conservative as every non-anthropic family', () => {
    const nonAnthropicFamilies = knowledgeTokenFamilies.filter((family) => {
      return family !== 'default' && family !== 'anthropic'
    })

    for (const family of nonAnthropicFamilies) {
      expect(KNOWLEDGE_CHARS_PER_TOKEN.default.latin)
        .toBeLessThanOrEqual(KNOWLEDGE_CHARS_PER_TOKEN[family].latin)
      expect(KNOWLEDGE_CHARS_PER_TOKEN.default.cyrillic)
        .toBeLessThanOrEqual(KNOWLEDGE_CHARS_PER_TOKEN[family].cyrillic)
    }
  })
})

describe('addKnowledgeCharCounts', () => {
  it('returns zeros for no arguments', () => {
    expect(addKnowledgeCharCounts()).toEqual(zeroCounts)
  })

  it('sums every class', () => {
    expect(addKnowledgeCharCounts(
      { latinChars: 1, cyrillicChars: 2, otherChars: 3 },
      { latinChars: 10, cyrillicChars: 20, otherChars: 30 },
      { latinChars: 100, cyrillicChars: 200, otherChars: 300 },
    )).toEqual({ latinChars: 111, cyrillicChars: 222, otherChars: 333 })
  })

  it('does not mutate its arguments', () => {
    const first = { latinChars: 1, cyrillicChars: 1, otherChars: 1 }

    addKnowledgeCharCounts(first, first)

    expect(first).toEqual({ latinChars: 1, cyrillicChars: 1, otherChars: 1 })
  })
})

describe('resolveKnowledgeTokenFamily', () => {
  it.each(knowledgeTokenFamilies)(
    'resolves the direct provider %s to itself',
    (providerId) => {
      expect(resolveKnowledgeTokenFamily({ providerId })).toBe(providerId)
    },
  )

  it('falls back to default for an unknown direct provider', () => {
    expect(resolveKnowledgeTokenFamily({ providerId: 'mistral' }))
      .toBe('default')
    expect(resolveKnowledgeTokenFamily({ providerId: '' })).toBe('default')
  })

  it('ignores the model id for a direct provider', () => {
    expect(resolveKnowledgeTokenFamily({
      providerId: 'openai',
      modelId: 'anthropic/claude-sonnet-5-5',
    })).toBe('openai')
  })

  it.each([
    ['anthropic/claude-sonnet-5-5', 'anthropic'],
    ['openai/gpt-6.1', 'openai'],
    ['google/gemini-3.8-flash', 'google'],
    ['x-ai/grok-4.7', 'xai'],
    ['deepseek/deepseek-flash', 'deepseek'],
    ['deepseek-ai/deepseek-v4', 'deepseek'],
    ['@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', 'deepseek'],
    ['moonshotai/kimi-k2.6', 'moonshotai'],
    ['@cf/moonshotai/kimi-k2.6', 'moonshotai'],
    ['qwen/qwen3.5-plus', 'qwen'],
    ['@cf/qwen/qwen3-30b', 'qwen'],
    ['alibaba/qwen-max', 'qwen'],
    ['@cf/openai/gpt-oss-120b', 'openai'],
    ['@cf/google/gemma-3-12b-it', 'google'],
    ['meta-llama/llama-4', 'default'],
    ['@cf/meta/llama-3.3-70b', 'default'],
    ['mistralai/mistral-large', 'default'],
    ['no-slash-model', 'default'],
    ['constructor/x', 'default'],
    ['__proto__/x', 'default'],
    ['toString', 'default'],
    ['hasOwnProperty/x', 'default'],
  ])('resolves gateway id %s to %s', (modelId, family) => {
    expect(resolveKnowledgeTokenFamily({
      providerId: 'openrouter',
      modelId,
      gateway: true,
    })).toBe(family)
  })

  it.each(['constructor/x', '__proto__/x', 'toString'])(
    'never crashes the token estimate for the gateway id %s',
    (modelId) => {
      const family = resolveKnowledgeTokenFamily({
        providerId: 'openrouter',
        modelId,
        gateway: true,
      })

      expect(() => estimateKnowledgeTextTokens(
        { latinChars: 100, cyrillicChars: 100, otherChars: 100 },
        family,
      )).not.toThrow()
    },
  )

  it('returns default for a gateway without a model id', () => {
    expect(resolveKnowledgeTokenFamily({
      providerId: 'openrouter',
      gateway: true,
    })).toBe('default')
    expect(resolveKnowledgeTokenFamily({
      providerId: 'openrouter',
      modelId: null,
      gateway: true,
    })).toBe('default')
  })

  it('does not treat the gateway provider id as a family', () => {
    expect(resolveKnowledgeTokenFamily({
      providerId: 'anthropic',
      modelId: 'meta-llama/llama-4',
      gateway: true,
    })).toBe('default')
  })
})

describe('estimateKnowledgeTextTokens', () => {
  it('returns 0 for no characters', () => {
    expect(estimateKnowledgeTextTokens(zeroCounts, 'default')).toBe(0)
    expect(estimateKnowledgeTextTokens(zeroCounts, 'anthropic')).toBe(0)
  })

  it('uses the default family figures', () => {
    expect(estimateKnowledgeTextTokens(
      { latinChars: 350, cyrillicChars: 150, otherChars: 150 },
      'default',
    )).toBe(100 + 100 + 100)
  })

  it('uses the denser Anthropic figures', () => {
    expect(estimateKnowledgeTextTokens(
      { latinChars: 320, cyrillicChars: 110, otherChars: 100 },
      'anthropic',
    )).toBe(100 + 100 + 100)
  })

  it('estimates Cyrillic higher on Anthropic than on the default', () => {
    const counts = { latinChars: 0, cyrillicChars: 1000, otherChars: 0 }

    expect(estimateKnowledgeTextTokens(counts, 'anthropic'))
      .toBeGreaterThan(estimateKnowledgeTextTokens(counts, 'default'))
    expect(estimateKnowledgeTextTokens(counts, 'anthropic')).toBe(910)
    expect(estimateKnowledgeTextTokens(counts, 'default')).toBe(667)
  })

  it('rounds the summed quotients up once, not per class', () => {
    expect(estimateKnowledgeTextTokens(
      { latinChars: 1, cyrillicChars: 1, otherChars: 0 },
      'default',
    )).toBe(1)
    expect(estimateKnowledgeTextTokens(
      { latinChars: 2, cyrillicChars: 2, otherChars: 0 },
      'default',
    )).toBe(2)
  })

  it('rounds a single character up to one token', () => {
    expect(estimateKnowledgeTextTokens(
      { latinChars: 1, cyrillicChars: 0, otherChars: 0 },
      'default',
    )).toBe(1)
  })

  it('does not round up exact float quotients', () => {
    expect(estimateKnowledgeTextTokens(
      { latinChars: 32, cyrillicChars: 0, otherChars: 0 },
      'anthropic',
    )).toBe(10)
  })
})

describe('estimateKnowledgeTokens', () => {
  const counts = { latinChars: 350, cyrillicChars: 0, otherChars: 0 }

  it('equals the text estimate without media', () => {
    expect(estimateKnowledgeTokens({ counts, family: 'default' })).toBe(100)
  })

  it('adds image tokens', () => {
    expect(estimateKnowledgeTokens({
      counts,
      family: 'default',
      media: { images: 2, nativePdfPages: 0 },
    })).toBe(100 + 2 * KNOWLEDGE_LIMITS.imageTokens)
  })

  it('adds native PDF page tokens', () => {
    expect(estimateKnowledgeTokens({
      counts,
      family: 'default',
      media: { images: 0, nativePdfPages: 3 },
    })).toBe(100 + 3 * KNOWLEDGE_LIMITS.nativePdfPageTokens)
  })

  it('adds both media kinds to the text', () => {
    expect(estimateKnowledgeTokens({
      counts,
      family: 'default',
      media: { images: 1, nativePdfPages: 1 },
    })).toBe(100 + 1600 + 2500)
  })

  it('works with media only', () => {
    expect(estimateKnowledgeTokens({
      counts: zeroCounts,
      family: 'anthropic',
      media: { images: 1, nativePdfPages: 0 },
    })).toBe(1600)
  })
})

describe('computeKnowledgeBudget', () => {
  it.each([
    [1_000_000, 64_000],
    [1_048_576, 64_000],
    [1_050_000, 64_000],
    [500_000, 35_000],
    [400_000, 28_000],
    [262_144, 18_350],
    [200_000, 14_000],
    [128_000, 8_960],
    [32_768, 2_293],
    [8_192, 573],
  ])('computes B for W = %i as %i', (contextWindow, budgetTokens) => {
    expect(computeKnowledgeBudget(contextWindow)).toEqual({
      budgetTokens,
      contextWindow,
      contextWindowKnown: true,
    })
  })

  it('applies the absolute cap exactly at the crossover window', () => {
    expect(computeKnowledgeBudget(914_285).budgetTokens).toBe(63_999)
    expect(computeKnowledgeBudget(914_286).budgetTokens).toBe(64_000)
    expect(computeKnowledgeBudget(5_000_000).budgetTokens).toBe(64_000)
  })

  it.each([null, undefined, 0, -1, Number.NaN, Infinity])(
    'falls back to 128k for an unknown window (%s)',
    (contextWindow) => {
      expect(computeKnowledgeBudget(contextWindow)).toEqual({
        budgetTokens: 8_960,
        contextWindow: KNOWLEDGE_BUDGET.unknownContextWindowTokens,
        contextWindowKnown: false,
      })
    },
  )
})

describe('computeReservedOutputTokens', () => {
  it('defaults to 16384 when unknown', () => {
    expect(computeReservedOutputTokens(null)).toBe(16_384)
    expect(computeReservedOutputTokens(undefined)).toBe(16_384)
    expect(computeReservedOutputTokens(0)).toBe(16_384)
  })

  it('uses the model maximum when it is below the clamp', () => {
    expect(computeReservedOutputTokens(8_192)).toBe(8_192)
    expect(computeReservedOutputTokens(32_768)).toBe(32_768)
  })

  it('clamps large maxima to 32768', () => {
    expect(computeReservedOutputTokens(65_536)).toBe(32_768)
    expect(computeReservedOutputTokens(128_000)).toBe(32_768)
  })
})

describe('measuredHistoryTokens', () => {
  it('returns null without a previous message', () => {
    expect(measuredHistoryTokens(null)).toBeNull()
    expect(measuredHistoryTokens(undefined)).toBeNull()
  })

  it('returns null for unusable input tokens', () => {
    for (const inputTokens of [0, -5, Number.NaN, Infinity]) {
      expect(measuredHistoryTokens({
        inputTokens,
        outputTokens: 100,
        knowledgeTokens: 0,
      })).toBeNull()
    }
  })

  it('adds the output and subtracts the knowledge', () => {
    expect(measuredHistoryTokens({
      inputTokens: 100_000,
      outputTokens: 2_000,
      knowledgeTokens: 64_000,
    })).toBe(38_000)
  })

  it('treats missing knowledge tokens as zero', () => {
    expect(measuredHistoryTokens({
      inputTokens: 5_000,
      outputTokens: 500,
      knowledgeTokens: null,
    })).toBe(5_500)
  })

  it('never goes below zero', () => {
    expect(measuredHistoryTokens({
      inputTokens: 1_000,
      outputTokens: 0,
      knowledgeTokens: 5_000,
    })).toBe(0)
  })
})

describe('decideKnowledgeMode', () => {
  describe('empty knowledge', () => {
    it.each(['auto', 'full', 'search'] as const)(
      'returns none/empty in %s mode',
      (mode) => {
        const decision = decideKnowledgeMode(
          buildInput({ mode, knowledgeTokens: 0 }),
        )

        expect(decision.mode).toBe('none')
        expect(decision.reason).toBe('empty')
        expect(decision.notice).toBeNull()
      },
    )

    it('returns none for negative knowledge tokens', () => {
      expect(decideKnowledgeMode(buildInput({ knowledgeTokens: -1 })).mode)
        .toBe('none')
    })

    it('still reports the budget fields', () => {
      const decision = decideKnowledgeMode(buildInput({ knowledgeTokens: 0 }))

      expect(decision.budgetTokens).toBe(64_000)
      expect(decision.contextWindow).toBe(1_000_000)
      expect(decision.contextWindowKnown).toBe(true)
      expect(decision.reservedOutputTokens).toBe(16_384)
    })
  })

  describe('search mode', () => {
    it('forces search regardless of the fit', () => {
      const decision = decideKnowledgeMode(buildInput({ mode: 'search' }))

      expect(decision.mode).toBe('search')
      expect(decision.reason).toBe('forced-search')
      expect(decision.notice).toBeNull()
      expect(decision.fits).toBe(true)
    })

    it('forces search even when the knowledge would not fit', () => {
      const decision = decideKnowledgeMode(buildInput({
        mode: 'search',
        knowledgeTokens: 500_000,
        contextWindow: 8_192,
      }))

      expect(decision.mode).toBe('search')
      expect(decision.reason).toBe('forced-search')
      expect(decision.fits).toBe(false)
    })
  })

  describe('full mode', () => {
    it('injects everything when it fits, even above the budget', () => {
      const decision = decideKnowledgeMode(buildInput({
        mode: 'full',
        knowledgeTokens: 200_000,
      }))

      expect(decision.mode).toBe('full')
      expect(decision.reason).toBe('within-budget')
      expect(decision.notice).toBeNull()
      expect(decision.fits).toBe(true)
    })

    it('falls back to search with a notice when it does not fit', () => {
      const decision = decideKnowledgeMode(buildInput({
        mode: 'full',
        knowledgeTokens: 20_000,
        contextWindow: 32_768,
      }))

      expect(decision.mode).toBe('search')
      expect(decision.reason).toBe('does-not-fit')
      expect(decision.notice).toBe('full-does-not-fit')
      expect(decision.fits).toBe(false)
    })
  })

  describe('auto mode', () => {
    it('injects everything within the budget when it fits', () => {
      const decision = decideKnowledgeMode(buildInput({
        knowledgeTokens: 64_000,
      }))

      expect(decision.mode).toBe('full')
      expect(decision.reason).toBe('within-budget')
      expect(decision.notice).toBeNull()
    })

    it('searches when the knowledge is above the budget', () => {
      const decision = decideKnowledgeMode(buildInput({
        knowledgeTokens: 64_001,
      }))

      expect(decision.mode).toBe('search')
      expect(decision.reason).toBe('over-budget')
      expect(decision.notice).toBeNull()
      expect(decision.fits).toBe(true)
    })

    it('treats K equal to B as within the budget', () => {
      const decision = decideKnowledgeMode(buildInput({
        knowledgeTokens: 2_293,
        contextWindow: 32_768,
      }))

      expect(decision.budgetTokens).toBe(2_293)
      expect(decision.mode).toBe('full')
    })

    describe('hysteresis', () => {
      const BUDGET = 64_000
      const RETURN_LIMIT = 54_400

      function decideWith(
        knowledgeTokens: number,
        previousMode: KnowledgeDecisionInput['previousMode'],
        overrides: Partial<KnowledgeDecisionInput> = {},
      ) {
        return decideKnowledgeMode(buildInput({
          knowledgeTokens,
          previousMode,
          ...overrides,
        }))
      }

      it('keeps full at the budget and leaves it above 100%', () => {
        expect(decideWith(BUDGET, 'full').mode).toBe('full')

        const decision = decideWith(BUDGET + 1, 'full')

        expect(decision.mode).toBe('search')
        expect(decision.reason).toBe('over-budget')
      })

      it('stays on search inside the 85% to 100% band', () => {
        for (const tokens of [RETURN_LIMIT + 1, 57_600, BUDGET]) {
          const decision = decideWith(tokens, 'search')

          expect(decision.mode).toBe('search')
          expect(decision.reason).toBe('hysteresis')
          expect(decision.notice).toBeNull()
        }
      })

      it('returns to full at or below 85% of the budget', () => {
        const atLimit = decideWith(RETURN_LIMIT, 'search')
        const below = decideWith(54_000, 'search')

        expect(atLimit.mode).toBe('full')
        expect(atLimit.reason).toBe('within-budget')
        expect(below.mode).toBe('full')
        expect(below.reason).toBe('within-budget')
      })

      it('searches above the budget whatever the previous mode', () => {
        for (const previousMode of ['search', 'full', 'none', null] as const) {
          expect(decideWith(BUDGET + 1, previousMode).reason)
            .toBe('over-budget')
        }
      })

      it('uses the plain 100% rule without a previous search', () => {
        for (const previousMode of ['full', 'none', null, undefined] as const) {
          const decision = decideWith(57_600, previousMode)

          expect(decision.mode).toBe('full')
          expect(decision.reason).toBe('within-budget')
        }
      })

      it('does not flip full, search, full across one large insert', () => {
        const sends = [50_000, 70_000, 60_000, 58_000, 50_000]
        const modes: string[] = []
        let previousMode: KnowledgeDecisionInput['previousMode'] = null

        for (const tokens of sends) {
          const decision = decideWith(tokens, previousMode)

          modes.push(decision.mode)
          previousMode = decision.mode
        }

        expect(modes).toEqual(['full', 'search', 'search', 'search', 'full'])
      })

      it('scales the band with the model budget', () => {
        const smallWindow = { contextWindow: 200_000 }

        expect(decideWith(11_901, 'search', smallWindow).reason)
          .toBe('hysteresis')
        expect(decideWith(11_900, 'search', smallWindow).mode).toBe('full')
      })

      it('reports does-not-fit before the hysteresis hold', () => {
        const decision = decideWith(57_600, 'search', {
          estimatedHistoryTokens: 950_000,
        })

        expect(decision.mode).toBe('search')
        expect(decision.reason).toBe('does-not-fit')
      })

      it('ignores the previous mode when a mode is forced', () => {
        const forcedFull = decideWith(57_600, 'search', { mode: 'full' })
        const forcedSearch = decideWith(1_000, 'full', { mode: 'search' })

        expect(forcedFull.mode).toBe('full')
        expect(forcedFull.reason).toBe('within-budget')
        expect(forcedSearch.mode).toBe('search')
        expect(forcedSearch.reason).toBe('forced-search')
      })

      it('still returns none for empty knowledge after a search', () => {
        expect(decideWith(0, 'search').mode).toBe('none')
      })
    })

    it('searches with over-budget on a tiny window', () => {
      const decision = decideKnowledgeMode(buildInput({
        knowledgeTokens: 574,
        contextWindow: 8_192,
        maxOutputTokens: 1_024,
      }))

      expect(decision.budgetTokens).toBe(573)
      expect(decision.mode).toBe('search')
      expect(decision.reason).toBe('over-budget')
    })

    it('searches with does-not-fit when within budget but too big', () => {
      const decision = decideKnowledgeMode(buildInput({
        knowledgeTokens: 1_000,
        contextWindow: 32_768,
        estimatedSystemTokens: 10_000,
        estimatedHistoryTokens: 10_000,
      }))

      expect(decision.mode).toBe('search')
      expect(decision.reason).toBe('does-not-fit')
      expect(decision.notice).toBeNull()
      expect(decision.fits).toBe(false)
    })

    it('prefers over-budget when both conditions hold', () => {
      const decision = decideKnowledgeMode(buildInput({
        knowledgeTokens: 100_000,
        contextWindow: 100_000,
      }))

      expect(decision.reason).toBe('over-budget')
    })
  })

  describe('the fit inequality', () => {
    it('sums S, H, M, margin K, R and T on the estimated path', () => {
      const decision = decideKnowledgeMode(buildInput({
        knowledgeTokens: 1_000,
        messageTokens: 300,
        maxOutputTokens: 4_000,
        estimatedSystemTokens: 100,
        estimatedHistoryTokens: 2_000,
        toolTokens: 400,
      }))

      expect(decision.requiredTokens)
        .toBe(100 + 2_000 + 300 + 1_150 + 4_000 + 400)
    })

    it('replaces S, H and T with the measured history', () => {
      const decision = decideKnowledgeMode(buildInput({
        knowledgeTokens: 1_000,
        messageTokens: 300,
        maxOutputTokens: 4_000,
        measuredHistoryTokens: 5_000,
        estimatedSystemTokens: 999_999,
        estimatedHistoryTokens: 999_999,
        toolTokens: 999_999,
      }))

      expect(decision.requiredTokens).toBe(5_000 + 300 + 1_150 + 4_000)
      expect(decision.fits).toBe(true)
    })

    it('treats an undefined measured history as not measured', () => {
      const decision = decideKnowledgeMode(buildInput({
        knowledgeTokens: 1_000,
        messageTokens: 300,
        maxOutputTokens: 4_000,
        measuredHistoryTokens: undefined as unknown as null,
        estimatedSystemTokens: 100,
        estimatedHistoryTokens: 2_000,
        toolTokens: 400,
      }))

      expect(decision.requiredTokens)
        .toBe(100 + 2_000 + 300 + 1_150 + 4_000 + 400)
    })

    it('uses a measured history of zero instead of the estimates', () => {
      const decision = decideKnowledgeMode(buildInput({
        knowledgeTokens: 0,
        maxOutputTokens: 1_000,
        measuredHistoryTokens: 0,
        estimatedSystemTokens: 50_000,
      }))

      expect(decision.requiredTokens).toBe(1_000)
    })

    it('fits exactly at the window and fails one token above', () => {
      const atLimit = decideKnowledgeMode(buildInput({
        knowledgeTokens: 1_000,
        contextWindow: 10_000,
        maxOutputTokens: 1_000,
        messageTokens: 7_850,
      }))
      const aboveLimit = decideKnowledgeMode(buildInput({
        knowledgeTokens: 1_000,
        contextWindow: 10_000,
        maxOutputTokens: 1_000,
        messageTokens: 7_851,
      }))

      expect(atLimit.requiredTokens).toBe(10_000)
      expect(atLimit.fits).toBe(true)
      expect(aboveLimit.requiredTokens).toBe(10_001)
      expect(aboveLimit.fits).toBe(false)
    })

    it('rounds the margin up', () => {
      expect(decideKnowledgeMode(buildInput({
        knowledgeTokens: 1,
        maxOutputTokens: 1,
      })).requiredTokens).toBe(2 + 1)
      expect(decideKnowledgeMode(buildInput({
        knowledgeTokens: 10,
        maxOutputTokens: 1,
      })).requiredTokens).toBe(12 + 1)
      expect(decideKnowledgeMode(buildInput({
        knowledgeTokens: 100,
        maxOutputTokens: 1,
      })).requiredTokens).toBe(115 + 1)
      expect(decideKnowledgeMode(buildInput({
        knowledgeTokens: 20_000,
        maxOutputTokens: 1,
      })).requiredTokens).toBe(23_000 + 1)
    })

    it('clamps the reserved output in the requirement', () => {
      const decision = decideKnowledgeMode(buildInput({
        knowledgeTokens: 0,
        maxOutputTokens: 128_000,
      }))

      expect(decision.reservedOutputTokens).toBe(32_768)
      expect(decision.requiredTokens).toBe(32_768)
    })

    it('uses the default reserved output when the model has none', () => {
      const decision = decideKnowledgeMode(buildInput({
        knowledgeTokens: 0,
        maxOutputTokens: undefined,
      }))

      expect(decision.reservedOutputTokens).toBe(16_384)
      expect(decision.requiredTokens).toBe(16_384)
    })
  })

  describe('unknown context window', () => {
    it('assumes 128k and flags it', () => {
      const decision = decideKnowledgeMode(buildInput({
        contextWindow: null,
        knowledgeTokens: 8_960,
      }))

      expect(decision.contextWindow).toBe(128_000)
      expect(decision.contextWindowKnown).toBe(false)
      expect(decision.budgetTokens).toBe(8_960)
      expect(decision.mode).toBe('full')
    })

    it('searches above the 128k budget', () => {
      const decision = decideKnowledgeMode(buildInput({
        contextWindow: undefined,
        knowledgeTokens: 8_961,
      }))

      expect(decision.reason).toBe('over-budget')
    })
  })
})
