import type { LoggerLike } from '~~/server/utils/files/logger'
import type { FormattedTools } from '~~/server/types/tools.d'
import type {
  ExternalSearchResult,
  ExternalSearchToolOutput,
} from '~~/server/utils/search/types.d'
import { createError } from 'evlog'
import { tool } from 'ai'
import { z } from 'zod'
import { withFollowUpTurn } from '~~/server/utils/ai/tool-loop'
import {
  searchFreshnessSchema,
  toExaStartPublishedDate,
} from '~~/server/utils/search/freshness'
import type { SearchFreshness } from '~~/server/utils/search/freshness'
import {
  buildSearchProviderNetworkError,
  buildSearchProviderStatusError,
  isUserAbortError,
} from '~~/server/utils/search/search-error'
import {
  consumeExternalSearchCall,
  createExternalSearchBudget,
} from '~~/server/utils/search/search-budget'
import type {
  ExternalSearchBudget,
} from '~~/server/utils/search/search-budget'

const EXA_SEARCH_API_URL = 'https://api.exa.ai/search'
const EXA_SEARCH_REQUEST_TIMEOUT_MS = 15_000
const EXA_SEARCH_NUM_RESULTS = 10
const EXA_SEARCH_TEXT_MAX_CHARACTERS = 1500
const EXA_SEARCH_QUERY_MAX_LENGTH = 400
const EXA_SEARCH_HIGHLIGHT_SEPARATOR = ' '

interface ExaSearchResult {
  title?: string | null
  url?: string
  publishedDate?: string
  author?: string
  text?: string
  highlights?: string[]
}

interface ExaSearchResponse {
  results?: ExaSearchResult[]
  costDollars?: {
    total?: number
  }
}

function hostnameFallback(url: string | undefined): string {
  if (!url) {
    return ''
  }

  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function readSnippet(result: ExaSearchResult): string {
  if (result.text) {
    return result.text
  }

  return (result.highlights ?? []).join(EXA_SEARCH_HIGHLIGHT_SEPARATOR)
}

function normalizeExaResults(
  response: ExaSearchResponse,
): ExternalSearchResult[] {
  const results = response.results ?? []

  return results.map((result) => {
    return {
      title: result.title ?? hostnameFallback(result.url),
      url: result.url ?? '',
      snippet: readSnippet(result),
      ...(result.publishedDate === undefined
        ? {}
        : { publishedDate: result.publishedDate }),
      ...(result.author === undefined ? {} : { author: result.author }),
    }
  })
}

/**
 * Calls Exa's `/search` endpoint with a fixed request body that the model
 * cannot configure apart from `freshness` (mapped to `startPublishedDate`):
 * `type: 'auto'`, `numResults: 10` and `contents.text.maxCharacters: 1500`.
 * `contents` is mandatory, not optional — a bare Exa query returns no body
 * text at all, only title/url/date/author. The exact shape is a module
 * constant because `NUXT_PUBLIC_EXA_SEARCH_COST_PER_THOUSAND_REQUESTS_USD`'s
 * fallback rate (see `external-search-cost.ts`) is derived from this exact
 * request shape; a different `numResults` or content mode would silently
 * invalidate it. Text with `maxCharacters: 1500` was verified live on
 * 2026-10-04 to be bundled in the search price (`costDollars.total: 0.007`).
 * Auth is `x-api-key`, not `Bearer`.
 */
async function executeExaSearch(
  apiKey: string,
  query: string,
  freshness: SearchFreshness | undefined,
  abortSignal: AbortSignal | undefined,
  logger?: LoggerLike,
): Promise<ExternalSearchToolOutput> {
  const timeoutSignal = AbortSignal.timeout(EXA_SEARCH_REQUEST_TIMEOUT_MS)
  const signal = abortSignal
    ? AbortSignal.any([abortSignal, timeoutSignal])
    : timeoutSignal

  let response: Response

  try {
    response = await fetch(EXA_SEARCH_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        query,
        type: 'auto',
        numResults: EXA_SEARCH_NUM_RESULTS,
        contents: {
          text: { maxCharacters: EXA_SEARCH_TEXT_MAX_CHARACTERS },
        },
        ...(freshness
          ? { startPublishedDate: toExaStartPublishedDate(freshness) }
          : {}),
      }),
      signal,
    })
  } catch (exception) {
    if (isUserAbortError(exception)) {
      throw exception
    }

    throw createError(buildSearchProviderNetworkError({
      providerLabel: 'Exa',
      exception,
    }))
  }

  if (!response.ok) {
    throw createError(buildSearchProviderStatusError({
      providerLabel: 'Exa',
      status: response.status,
    }))
  }

  const body = await response.json() as ExaSearchResponse
  const results = normalizeExaResults(body)
  const costDollars = body.costDollars?.total

  logger?.set({
    attributes: {
      exaWebSearch: {
        resultCount: results.length,
        ...(costDollars === undefined ? {} : { costDollars }),
      },
    },
  })

  return {
    results,
    provider: 'exa',
    ...(costDollars === undefined ? {} : { costDollars }),
  }
}

/**
 * Builds Exa's `web_search_exa` tool, marked with `withFollowUpTurn()` so
 * the model gets a second turn to answer once results come back. Never pair
 * this with a forced `toolChoice`: see `server/utils/ai/tool-loop.ts`'s doc
 * comment on why that would loop the tool forever instead of answering.
 * Registered under a name distinct from every native `web_search*` tool key
 * so external and native search stay distinguishable in telemetry and in
 * persisted message parts. Every `execute` spends one call from the
 * per-request `searchBudget` before any provider request, so parallel calls
 * in one step cannot exceed `EXTERNAL_SEARCH_MAX_CALLS_PER_TURN`.
 */
export async function getExaWebSearchTools(
  apiKey: string,
  searchBudget: ExternalSearchBudget = createExternalSearchBudget(),
  logger?: LoggerLike,
): Promise<FormattedTools> {
  return {
    tools: {
      web_search_exa: withFollowUpTurn(tool({
        description: 'Search the web using Exa. Call this when the '
          + 'question depends on current information, recent events, or '
          + 'anything you are not confident about. Issue one focused query '
          + 'per call.',
        inputSchema: z.object({
          query: z.string().min(1).max(EXA_SEARCH_QUERY_MAX_LENGTH),
          freshness: searchFreshnessSchema,
        }),
        async execute(input, options) {
          consumeExternalSearchCall(searchBudget)

          return await executeExaSearch(
            apiKey,
            input.query,
            input.freshness,
            options.abortSignal,
            logger,
          )
        },
      })),
    },
  }
}
