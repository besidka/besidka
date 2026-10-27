import { describe, expect, it } from 'vitest'
import { resolveBuiltInSearchPrice } from '../../../app/utils/web-search-price'

const config = {
  googleSearchCostPerThousandQueriesUsd: '14',
  googleSearchCostPerThousandGroundedPromptsUsd: '35',
  anthropicWebSearchCostPerThousandSearchesUsd: '10',
  openaiWebSearchCostPerThousandCallsUsd: '10',
  deepseekSearchCostPerThousandRequestsUsd: '0.75',
}

describe('resolveBuiltInSearchPrice', () => {
  it('bills Gemini 3.x per query and older Gemini per prompt', () => {
    expect(resolveBuiltInSearchPrice('google', 'gemini-3.1-pro', config))
      .toEqual({ perThousandUsd: 14, unit: 'searches' })
    expect(resolveBuiltInSearchPrice('google', 'gemini-2.5-flash', config))
      .toEqual({ perThousandUsd: 35, unit: 'prompts' })
  })

  it('returns nothing for a Google model id it cannot classify', () => {
    expect(resolveBuiltInSearchPrice('google', 'gemma-4', config))
      .toBeUndefined()
    expect(resolveBuiltInSearchPrice('google', '', config)).toBeUndefined()
  })

  it('uses the flat rate of Anthropic, OpenAI and DeepSeek', () => {
    expect(resolveBuiltInSearchPrice('anthropic', 'claude', config))
      .toEqual({ perThousandUsd: 10, unit: 'searches' })
    expect(resolveBuiltInSearchPrice('openai', 'gpt', config))
      .toEqual({ perThousandUsd: 10, unit: 'searches' })
    expect(resolveBuiltInSearchPrice('deepseek', 'deepseek', config))
      .toEqual({ perThousandUsd: 0.75, unit: 'searches' })
  })

  it('never guesses a price for other providers or gateways', () => {
    expect(resolveBuiltInSearchPrice('xai', 'grok-4', config)).toBeUndefined()
    expect(resolveBuiltInSearchPrice('openrouter', 'x', config))
      .toBeUndefined()
    expect(resolveBuiltInSearchPrice(null, 'x', config)).toBeUndefined()
  })

  it('returns nothing when the rate is blank or invalid', () => {
    expect(resolveBuiltInSearchPrice('anthropic', 'claude', {
      anthropicWebSearchCostPerThousandSearchesUsd: '',
    })).toBeUndefined()
    expect(resolveBuiltInSearchPrice('anthropic', 'claude', {
      anthropicWebSearchCostPerThousandSearchesUsd: 'abc',
    })).toBeUndefined()
    expect(resolveBuiltInSearchPrice('anthropic', 'claude', {}))
      .toBeUndefined()
  })
})
