import type { SearchBillingUnit } from '#shared/types/message-usage.d'

export type WebSearchUsage = {
  searches: number
  billingUnit: SearchBillingUnit
}

export type WebSearchRates = {
  anthropicPerSearchUsd: number | undefined
  openaiPerCallUsd: number | undefined
}

export type WebSearchCostConfig = {
  anthropicWebSearchCostPerThousandSearchesUsd?: string | number
  openaiWebSearchCostPerThousandCallsUsd?: string | number
}

export type WebSearchStep = {
  providerMetadata?: unknown
  content?: unknown
}

// The app-registered key (server/utils/providers/{anthropic,openai}.ts) plus
// the provider-native fallback name, so a future rename of the registered
// key degrades to still-counting rather than silently zeroing.
const WEB_SEARCH_TOOL_NAMES = new Set([
  'web_search_preview',
  'web_search',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Counts billable web-search tool uses for Anthropic and OpenAI. Returns
 * `undefined` for any other provider — Google's grounding is counted
 * separately by `getGoogleSearchGrounding` in `google-search-cost.ts`, and
 * Google registers its tool under the SAME `web_search_preview` key, so an
 * ungated structural count here would double-report it if this function
 * weren't gated to Anthropic/OpenAI only. Returns `undefined` when zero
 * searches ran, so a turn that merely offers web search never gains a
 * fabricated usage record.
 */
export function getWebSearchUsage(
  steps: ReadonlyArray<WebSearchStep>,
  providerId: string,
): WebSearchUsage | undefined {
  if (providerId !== 'anthropic' && providerId !== 'openai') {
    return undefined
  }

  if (providerId === 'anthropic') {
    let metadataTotal = 0
    let sawMetadata = false

    for (const step of steps) {
      const providerMetadata = step.providerMetadata

      if (
        !isRecord(providerMetadata)
        || !isRecord(providerMetadata.anthropic)
      ) {
        continue
      }

      const usage = providerMetadata.anthropic.usage

      if (!isRecord(usage) || !isRecord(usage.server_tool_use)) {
        continue
      }

      const webSearchRequests = usage.server_tool_use.web_search_requests

      if (
        typeof webSearchRequests === 'number'
        && Number.isFinite(webSearchRequests)
        && webSearchRequests >= 0
      ) {
        sawMetadata = true
        metadataTotal += webSearchRequests
      }
    }

    if (sawMetadata) {
      return metadataTotal === 0
        ? undefined
        : { searches: metadataTotal, billingUnit: 'search' }
    }
  }

  let structuralTotal = 0

  for (const step of steps) {
    const content = step.content

    if (!Array.isArray(content)) {
      continue
    }

    for (const part of content) {
      if (!isRecord(part)) {
        continue
      }

      if (
        part.type === 'tool-result'
        && typeof part.toolName === 'string'
        && WEB_SEARCH_TOOL_NAMES.has(part.toolName)
      ) {
        structuralTotal += 1
      }
    }
  }

  return structuralTotal === 0
    ? undefined
    : { searches: structuralTotal, billingUnit: 'search' }
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

export function resolveWebSearchRates(
  config: WebSearchCostConfig,
): WebSearchRates {
  return {
    anthropicPerSearchUsd: parsePerThousandRate(
      config.anthropicWebSearchCostPerThousandSearchesUsd,
    ),
    openaiPerCallUsd: parsePerThousandRate(
      config.openaiWebSearchCostPerThousandCallsUsd,
    ),
  }
}

/**
 * Mirrors getGoogleSearchCost()'s contract: an unconfigured or unresolvable
 * rate yields no cost field, never a fabricated `0`.
 *
 * This app registers OpenAI's tool via `openai.tools.webSearch({})`
 * (`server/utils/providers/openai.ts`), which the AI SDK resolves to the
 * non-preview `web_search` Responses tool (`id: "openai.web_search"`, API
 * `type: "web_search"`) — NOT `web_search_preview`. The non-preview tool
 * bills a single flat $10 / 1,000 calls for every model, with no
 * reasoning-vs-non-reasoning split and no per-model exemption; the fixed
 * 8,000-input-token block that gpt-4o-mini/gpt-4.1-mini consume per call is
 * a content-token detail that already flows through the normal
 * `computeModelCost` token-cost path and needs no handling here. The
 * *preview* tool this app does not use has a different, tiered price list
 * (reasoning vs. non-reasoning, $10 vs. $25 / 1,000 calls) — do not "fix"
 * this back to tiered pricing by reading that section of OpenAI's docs.
 * Source: developers.openai.com/api/docs/pricing (as of 2026-09-22).
 */
export function getWebSearchCost(
  usage: WebSearchUsage | undefined,
  providerId: string,
  rates: WebSearchRates,
): number | undefined {
  if (!usage || usage.searches === 0) {
    return undefined
  }

  let rate: number | undefined

  if (providerId === 'anthropic') {
    rate = rates.anthropicPerSearchUsd
  } else if (providerId === 'openai') {
    rate = rates.openaiPerCallUsd
  } else {
    return undefined
  }

  if (rate === undefined) {
    return undefined
  }

  return usage.searches * rate
}
