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

const EXA_SEARCH_API_URL = 'https://api.exa.ai/search'
const EXA_SEARCH_REQUEST_TIMEOUT_MS = 15_000
const EXA_SEARCH_NUM_RESULTS = 10
const EXA_SEARCH_QUERY_MAX_LENGTH = 400

interface ExaSearchResult {
  title?: string | null
  url?: string
  publishedDate?: string
  author?: string
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

function normalizeExaResults(
  response: ExaSearchResponse,
): ExternalSearchResult[] {
  const results = response.results ?? []

  return results.map((result) => {
    return {
      title: result.title ?? hostnameFallback(result.url),
      url: result.url ?? '',
      snippet: (result.highlights ?? []).join(' '),
      ...(result.publishedDate === undefined
        ? {}
        : { publishedDate: result.publishedDate }),
      ...(result.author === undefined ? {} : { author: result.author }),
    }
  })
}

/**
 * Calls Exa's `/search` endpoint with a fixed, non-user-configurable request
 * body: `type: 'auto'`, `numResults: 10` and `contents.highlights: true`.
 * `contents.highlights` is mandatory, not optional — a bare Exa query
 * returns no body text at all, only title/url/date/author. The exact shape
 * is a module constant rather than model-configurable because
 * `NUXT_EXA_SEARCH_COST_PER_THOUSAND_REQUESTS_USD`'s fallback rate (see
 * `external-search-cost.ts`) is derived from this exact request shape; a
 * different `numResults` or content mode would silently invalidate it. Auth
 * is `x-api-key`, not `Bearer`.
 */
async function executeExaSearch(
  apiKey: string,
  query: string,
  abortSignal: AbortSignal | undefined,
  logger?: LoggerLike,
): Promise<ExternalSearchToolOutput> {
  const timeoutSignal = AbortSignal.timeout(EXA_SEARCH_REQUEST_TIMEOUT_MS)
  const signal = abortSignal
    ? AbortSignal.any([abortSignal, timeoutSignal])
    : timeoutSignal

  const response = await fetch(EXA_SEARCH_API_URL, {
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
        highlights: true,
      },
    }),
    signal,
  })

  if (!response.ok) {
    throw createError({
      message: 'Exa search is temporarily unavailable.',
      status: 502,
      why: `Exa's search endpoint responded with HTTP ${response.status}.`,
      fix: 'Try again shortly, or send the message without web search.',
    })
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
 * persisted message parts.
 */
export async function getExaWebSearchTools(
  apiKey: string,
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
        }),
        async execute(input, options) {
          return await executeExaSearch(
            apiKey,
            input.query,
            options.abortSignal,
            logger,
          )
        },
      })),
    },
  }
}
