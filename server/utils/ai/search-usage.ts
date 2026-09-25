import type {
  SearchBillingUnit,
  SearchProvider,
} from '#shared/types/message-usage.d'
import type {
  ExternalSearchCostConfig,
  ExternalSearchRates,
} from '~~/server/utils/ai/external-search-cost'
import type {
  GoogleSearchCostConfig,
  GoogleSearchRates,
} from '~~/server/utils/ai/google-search-cost'
import type {
  WebSearchCostConfig,
  WebSearchRates,
  WebSearchStep,
} from '~~/server/utils/ai/web-search-cost'
import type { ExternalSearchProviderId } from '~~/server/utils/search/types.d'
import {
  getExternalSearchCost,
  getExternalSearchUsage,
  resolveExternalSearchRates,
} from '~~/server/utils/ai/external-search-cost'
import {
  getGoogleSearchBillableUnits,
  getGoogleSearchCost,
  getGoogleSearchGrounding,
  resolveGoogleSearchRates,
} from '~~/server/utils/ai/google-search-cost'
import {
  getWebSearchCost,
  getWebSearchUsage,
  resolveWebSearchRates,
} from '~~/server/utils/ai/web-search-cost'

export type SearchRates = {
  google: GoogleSearchRates
  web: WebSearchRates
  external: ExternalSearchRates
}

export type SearchUsage = {
  units: number
  billingUnit: SearchBillingUnit | undefined
  cost: number | undefined
  googleQueries: number | undefined
  googleGroundedSteps: number | undefined
  provider?: SearchProvider
}

export function resolveSearchRates(
  config: GoogleSearchCostConfig & WebSearchCostConfig
    & ExternalSearchCostConfig,
): SearchRates {
  return {
    google: resolveGoogleSearchRates(config),
    web: resolveWebSearchRates(config),
    external: resolveExternalSearchRates(config),
  }
}

/**
 * The single entry point for "did this turn use a separately-billed search
 * tool, and what did it cost." Every provider produces the same
 * provider-agnostic `{ units, billingUnit, cost }` triple so the app renders
 * one "Web search" line regardless of provider; the two `google*` fields
 * carry the Google-only breakdown that the Axiom wide event still reports
 * for continuity with PR #385/#386.
 *
 * `externalSearchProvider` is checked FIRST, before the `providerId`
 * branches: Brave and Exa are orthogonal to the direct provider running the
 * turn (any tool-calling model can use either), so their usage cannot be
 * gated on `providerId` the way Google/Anthropic/OpenAI are.
 */
export function resolveSearchUsage(input: {
  providerId: string
  modelId: string
  steps: ReadonlyArray<WebSearchStep>
  rates: SearchRates
  externalSearchProvider?: ExternalSearchProviderId
}): SearchUsage | undefined {
  if (input.externalSearchProvider) {
    const usage = getExternalSearchUsage(
      input.steps,
      input.externalSearchProvider,
    )

    if (!usage) {
      return undefined
    }

    return {
      units: usage.searches,
      billingUnit: usage.billingUnit,
      cost: getExternalSearchCost(
        usage,
        input.externalSearchProvider,
        input.rates.external,
      ),
      googleQueries: undefined,
      googleGroundedSteps: undefined,
      provider: input.externalSearchProvider,
    }
  }

  if (input.providerId === 'google') {
    const grounding = getGoogleSearchGrounding(input.steps, input.modelId)

    if (!grounding) {
      return undefined
    }

    return {
      units: getGoogleSearchBillableUnits(grounding),
      billingUnit: grounding.billingUnit,
      cost: getGoogleSearchCost(grounding, input.rates.google),
      googleQueries: grounding.queries,
      googleGroundedSteps: grounding.groundedSteps,
      provider: 'google',
    }
  }

  const usage = getWebSearchUsage(input.steps, input.providerId)

  if (!usage) {
    return undefined
  }

  return {
    units: usage.searches,
    billingUnit: usage.billingUnit,
    cost: getWebSearchCost(
      usage,
      input.providerId,
      input.rates.web,
    ),
    googleQueries: undefined,
    googleGroundedSteps: undefined,
    provider: (input.providerId === 'anthropic'
      || input.providerId === 'openai')
      ? input.providerId
      : undefined,
  }
}
