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
  buildSearchProviderNetworkError,
  buildSearchProviderStatusError,
  isUserAbortError,
} from '~~/server/utils/search/search-error'

const BRAVE_SEARCH_API_URL = 'https://api.search.brave.com/res/v1/web/search'
const BRAVE_SEARCH_REQUEST_TIMEOUT_MS = 10_000
const BRAVE_SEARCH_RESULT_COUNT = 10
const BRAVE_SEARCH_QUERY_MAX_LENGTH = 400

interface BraveWebResult {
  title?: string
  url?: string
  description?: string
}

interface BraveSearchResponse {
  web?: {
    results?: BraveWebResult[]
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

function normalizeBraveResults(
  response: BraveSearchResponse,
): ExternalSearchResult[] {
  const results = response.web?.results ?? []

  return results.slice(0, BRAVE_SEARCH_RESULT_COUNT).map((result) => {
    return {
      title: result.title ?? hostnameFallback(result.url),
      url: result.url ?? '',
      snippet: result.description ?? '',
    }
  })
}

/**
 * Calls Brave's Web Search endpoint with a fixed, non-user-configurable
 * request shape: `result_filter=web` keeps the response to the single `web`
 * vertical (Brave nests `news`/`videos`/`locations`/`infobox` otherwise), and
 * `count=10` bounds the result set the model has to read. Auth is
 * `X-Subscription-Token`, not `Bearer` — Brave's one deviation from the
 * pattern every other provider in this app uses.
 */
async function executeBraveSearch(
  apiKey: string,
  query: string,
  abortSignal: AbortSignal | undefined,
  logger?: LoggerLike,
): Promise<ExternalSearchToolOutput> {
  const url = new URL(BRAVE_SEARCH_API_URL)

  url.searchParams.set('q', query)
  url.searchParams.set('count', String(BRAVE_SEARCH_RESULT_COUNT))
  url.searchParams.set('result_filter', 'web')

  const timeoutSignal = AbortSignal.timeout(BRAVE_SEARCH_REQUEST_TIMEOUT_MS)
  const signal = abortSignal
    ? AbortSignal.any([abortSignal, timeoutSignal])
    : timeoutSignal

  let response: Response

  try {
    response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey,
      },
      signal,
    })
  } catch (exception) {
    if (isUserAbortError(exception)) {
      throw exception
    }

    throw createError(buildSearchProviderNetworkError({
      providerLabel: 'Brave Search',
      exception,
    }))
  }

  if (!response.ok) {
    throw createError(buildSearchProviderStatusError({
      providerLabel: 'Brave Search',
      status: response.status,
    }))
  }

  const body = await response.json() as BraveSearchResponse
  const results = normalizeBraveResults(body)

  logger?.set({
    attributes: {
      braveWebSearch: {
        resultCount: results.length,
      },
    },
  })

  return {
    results,
    provider: 'brave',
  }
}

/**
 * Builds Brave's `web_search_brave` tool, marked with `withFollowUpTurn()`
 * so the model gets a second turn to answer once results come back. Never
 * pair this with a forced `toolChoice`: see `server/utils/ai/tool-loop.ts`'s
 * doc comment on why that would loop the tool forever instead of answering.
 * Registered under a name distinct from every native `web_search*` tool key
 * so external and native search stay distinguishable in telemetry and in
 * persisted message parts.
 */
export async function getBraveWebSearchTools(
  apiKey: string,
  logger?: LoggerLike,
): Promise<FormattedTools> {
  return {
    tools: {
      web_search_brave: withFollowUpTurn(tool({
        description: 'Search the web using Brave Search. Call this when '
          + 'the question depends on current information, recent events, '
          + 'or anything you are not confident about. Issue one focused '
          + 'query per call.',
        inputSchema: z.object({
          query: z.string().min(1).max(BRAVE_SEARCH_QUERY_MAX_LENGTH),
        }),
        async execute(input, options) {
          return await executeBraveSearch(
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
