import type { SearchBillingUnit } from '#shared/types/message-usage.d'
import type { ExternalSearchProviderId } from '~~/server/utils/search/types.d'

export type ExternalSearchUsage = {
  searches: number
  billingUnit: SearchBillingUnit
  reportedCostDollars: number | undefined
}

export type ExternalSearchRates = {
  bravePerSearchUsd: number | undefined
  exaPerSearchUsd: number | undefined
}

export type ExternalSearchCostConfig = {
  braveSearchCostPerThousandRequestsUsd?: string | number
  exaSearchCostPerThousandRequestsUsd?: string | number
}

export type ExternalSearchStep = {
  content?: unknown
}

const EXTERNAL_SEARCH_TOOL_NAMES: Record<ExternalSearchProviderId, string> = {
  brave: 'web_search_brave',
  exa: 'web_search_exa',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Counts billable Brave/Exa tool calls for one provider and, when present,
 * sums the vendor-reported `costDollars` those calls carried on their tool
 * output. Only `tool-result` parts are counted — the AI SDK converts a
 * failed provider tool call into a `tool-error` part type, so a failed
 * search structurally never contributes a billable unit here. A turn can
 * call the tool more than once (`stepCountIs(3)` allows it), so this walks
 * every step rather than assuming at most one call. Returns `undefined` when
 * zero calls ran, so a turn that merely offers the tool never gains a
 * fabricated usage record.
 */
export function getExternalSearchUsage(
  steps: ReadonlyArray<ExternalSearchStep>,
  provider: ExternalSearchProviderId,
): ExternalSearchUsage | undefined {
  const toolName = EXTERNAL_SEARCH_TOOL_NAMES[provider]

  let searches = 0
  let reportedCostDollarsTotal = 0
  let sawReportedCostDollars = false

  for (const step of steps) {
    const content = step.content

    if (!Array.isArray(content)) {
      continue
    }

    for (const part of content) {
      if (
        !isRecord(part)
        || part.type !== 'tool-result'
        || part.toolName !== toolName
      ) {
        continue
      }

      searches += 1

      const output = part.output

      if (!isRecord(output)) {
        continue
      }

      const costDollars = output.costDollars

      if (typeof costDollars === 'number' && Number.isFinite(costDollars)) {
        sawReportedCostDollars = true
        reportedCostDollarsTotal += costDollars
      }
    }
  }

  if (searches === 0) {
    return undefined
  }

  return {
    searches,
    billingUnit: 'search',
    reportedCostDollars: sawReportedCostDollars
      ? reportedCostDollarsTotal
      : undefined,
  }
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

export function resolveExternalSearchRates(
  config: ExternalSearchCostConfig,
): ExternalSearchRates {
  return {
    bravePerSearchUsd: parsePerThousandRate(
      config.braveSearchCostPerThousandRequestsUsd,
    ),
    exaPerSearchUsd: parsePerThousandRate(
      config.exaSearchCostPerThousandRequestsUsd,
    ),
  }
}

/**
 * Prefers a vendor-reported cost (Exa's `costDollars`, summed across every
 * call in the turn by `getExternalSearchUsage`) over the configured rate,
 * because a reported cost is a real invoiced figure and the rate is a
 * documentation-derived fallback. Falls back to `searches × rate` when no
 * cost was reported (Brave never reports one; Exa only if the field was
 * absent). Mirrors `getGoogleSearchCost()`/`getWebSearchCost()`'s contract:
 * an unresolvable cost is `undefined`, never a fabricated `0`.
 */
export function getExternalSearchCost(
  usage: ExternalSearchUsage | undefined,
  provider: ExternalSearchProviderId,
  rates: ExternalSearchRates,
): number | undefined {
  if (!usage || usage.searches === 0) {
    return undefined
  }

  if (usage.reportedCostDollars !== undefined) {
    return usage.reportedCostDollars
  }

  const rate = provider === 'brave'
    ? rates.bravePerSearchUsd
    : rates.exaPerSearchUsd

  if (rate === undefined) {
    return undefined
  }

  return usage.searches * rate
}
