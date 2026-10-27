import {
  getGoogleSearchBillingUnit,
  type GoogleSearchBillingUnit,
} from '#shared/utils/google-search-billing-unit'

export type GoogleSearchGrounding = {
  queries: number
  groundedSteps: number
  billingUnit: GoogleSearchBillingUnit | undefined
}

export type GoogleSearchRates = {
  perQueryUsd: number | undefined
  perGroundedPromptUsd: number | undefined
}

export type GoogleSearchCostConfig = {
  googleSearchCostPerThousandQueriesUsd?: string | number
  googleSearchCostPerThousandGroundedPromptsUsd?: string | number
}

type GroundingStep = { providerMetadata?: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Walks a generation's steps and reports whether Google Search grounding
 * ran, and how much of it. `queries` counts deduplicated, trimmed non-empty
 * `webSearchQueries` entries across all steps — the invoiced signal for the
 * `'query'` billing unit. `groundedSteps` counts steps that carried any
 * `groundingMetadata` at all, including one with zero queries — the invoiced
 * signal for the `'grounded-prompt'` billing unit. `imageSearchQueries` and
 * `retrievalQueries` are deliberately ignored: neither is part of the
 * invoiced Google Search SKU. Returns `undefined` when no step grounded at
 * all, so a turn that merely supports search without using it never gains a
 * fabricated grounding record.
 */
export function getGoogleSearchGrounding(
  steps: ReadonlyArray<GroundingStep>,
  modelId: string,
): GoogleSearchGrounding | undefined {
  const queries = new Set<string>()
  let groundedSteps = 0

  for (const step of steps) {
    const providerMetadata = step.providerMetadata

    if (!isRecord(providerMetadata) || !isRecord(providerMetadata.google)) {
      continue
    }

    const groundingMetadata = providerMetadata.google.groundingMetadata

    if (!isRecord(groundingMetadata)) {
      continue
    }

    groundedSteps += 1

    const webSearchQueries = groundingMetadata.webSearchQueries

    if (!Array.isArray(webSearchQueries)) {
      continue
    }

    for (const query of webSearchQueries) {
      if (typeof query !== 'string') {
        continue
      }

      const trimmedQuery = query.trim()

      if (trimmedQuery) {
        queries.add(trimmedQuery)
      }
    }
  }

  if (groundedSteps === 0) {
    return undefined
  }

  return {
    queries: queries.size,
    groundedSteps,
    billingUnit: getGoogleSearchBillingUnit(modelId),
  }
}

export function getGoogleSearchBillableUnits(
  grounding: GoogleSearchGrounding,
): number {
  return grounding.billingUnit === 'grounded-prompt'
    ? grounding.groundedSteps
    : grounding.queries
}

function parsePerThousandRate(
  value: string | number | undefined,
): number | undefined {
  if (value === undefined || value === '') {
    return undefined
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) && parsed > 0 ? parsed / 1000 : undefined
}

export function resolveGoogleSearchRates(
  config: GoogleSearchCostConfig,
): GoogleSearchRates {
  return {
    perQueryUsd: parsePerThousandRate(
      config.googleSearchCostPerThousandQueriesUsd,
    ),
    perGroundedPromptUsd: parsePerThousandRate(
      config.googleSearchCostPerThousandGroundedPromptsUsd,
    ),
  }
}

/**
 * Mirrors buildMessageUsage()'s contract: an unconfigured or unresolvable
 * rate yields no cost field, never a fabricated `0`.
 */
export function getGoogleSearchCost(
  grounding: GoogleSearchGrounding | undefined,
  rates: GoogleSearchRates,
): number | undefined {
  if (!grounding || grounding.billingUnit === undefined) {
    return undefined
  }

  const rate = grounding.billingUnit === 'grounded-prompt'
    ? rates.perGroundedPromptUsd
    : rates.perQueryUsd

  if (rate === undefined) {
    return undefined
  }

  const units = getGoogleSearchBillableUnits(grounding)

  if (units === 0) {
    return undefined
  }

  return units * rate
}
