import { getGoogleSearchBillingUnit } from '#shared/utils/google-search-billing-unit'

export type BuiltInSearchPriceUnit = 'searches' | 'prompts'

export interface BuiltInSearchPrice {
  perThousandUsd: number
  unit: BuiltInSearchPriceUnit
}

type RateConfig = Record<string, unknown>

function parseConfiguredRate(
  config: RateConfig,
  key: string,
): number | undefined {
  const value = config[key]

  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined
  }

  return parseRatePerThousandUsd(value)
}

function resolveGooglePrice(
  modelId: string,
  config: RateConfig,
): BuiltInSearchPrice | undefined {
  const billingUnit = getGoogleSearchBillingUnit(modelId)

  if (billingUnit === undefined) {
    return undefined
  }

  const isPerPrompt = billingUnit === 'grounded-prompt'
  const perThousandUsd = parseConfiguredRate(
    config,
    isPerPrompt
      ? 'googleSearchCostPerThousandGroundedPromptsUsd'
      : 'googleSearchCostPerThousandQueriesUsd',
  )

  if (perThousandUsd === undefined) {
    return undefined
  }

  return { perThousandUsd, unit: isPerPrompt ? 'prompts' : 'searches' }
}

const flatRateConfigKeys: Record<string, string> = {
  anthropic: 'anthropicWebSearchCostPerThousandSearchesUsd',
  openai: 'openaiWebSearchCostPerThousandCallsUsd',
  deepseek: 'deepseekSearchCostPerThousandRequestsUsd',
}

/**
 * The list price of the model's own web search, for display only. Mirrors
 * the server's cost accounting (`google-search-cost.ts`,
 * `web-search-cost.ts`): Google picks its rate and unit from the model id,
 * Anthropic, OpenAI and DeepSeek bill a flat per-search rate, and every
 * other provider or gateway returns `undefined` so no price is ever guessed.
 */
export function resolveBuiltInSearchPrice(
  providerId: string | null | undefined,
  modelId: string | null | undefined,
  config: RateConfig,
): BuiltInSearchPrice | undefined {
  if (!providerId) {
    return undefined
  }

  if (providerId === 'google') {
    return modelId ? resolveGooglePrice(modelId, config) : undefined
  }

  const configKey = flatRateConfigKeys[providerId]

  if (!configKey) {
    return undefined
  }

  const perThousandUsd = parseConfiguredRate(config, configKey)

  return perThousandUsd === undefined
    ? undefined
    : { perThousandUsd, unit: 'searches' }
}
