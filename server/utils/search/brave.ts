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
  toBraveFreshnessCode,
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

const BRAVE_SEARCH_API_URL = 'https://api.search.brave.com/res/v1/llm/context'
const BRAVE_SEARCH_REQUEST_TIMEOUT_MS = 10_000
const BRAVE_SEARCH_RESULT_COUNT = 8
const BRAVE_SEARCH_MAX_TOKENS = 3072
const BRAVE_SEARCH_MAX_TOKENS_PER_URL = 1024
const BRAVE_SEARCH_QUERY_MAX_LENGTH = 400
const BRAVE_SEARCH_SNIPPET_SEPARATOR = '\n'
const ISO_DATE_PATTERN
  = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

interface BraveGroundingResult {
  url?: string
  title?: string
  snippets?: string[]
}

interface BraveSourceMetadata {
  title?: string
  hostname?: string
  age?: Array<string | null> | null
}

interface BraveLlmContextResponse {
  grounding?: {
    generic?: BraveGroundingResult[]
  }
  sources?: Record<string, BraveSourceMetadata>
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

function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE_PATTERN.test(value)
}

/**
 * Brave's `age` array is `[display text, ISO date, relative text, ISO
 * timestamp]`. The full timestamp (index 3) is preferred over the date-only
 * entry (index 1); anything that is not an ISO date or datetime is dropped
 * rather than parsed leniently, so free text never reaches the model as a
 * "date".
 */
function readPublishedDate(
  source: BraveSourceMetadata | undefined,
): string | undefined {
  const age = source?.age

  if (isIsoDateString(age?.[3])) {
    return age[3]
  }

  if (isIsoDateString(age?.[1])) {
    return age[1]
  }

  return undefined
}

function normalizeBraveResults(
  response: BraveLlmContextResponse,
): ExternalSearchResult[] {
  const results = response.grounding?.generic ?? []
  const sources = response.sources ?? {}

  return results.slice(0, BRAVE_SEARCH_RESULT_COUNT).map((result) => {
    const source = result.url ? sources[result.url] : undefined
    const publishedDate = readPublishedDate(source)

    return {
      title: result.title
        || source?.title
        || source?.hostname
        || hostnameFallback(result.url),
      url: result.url ?? '',
      snippet: (result.snippets ?? []).join(BRAVE_SEARCH_SNIPPET_SEPARATOR),
      ...(publishedDate === undefined ? {} : { publishedDate }),
    }
  })
}

/**
 * Calls Brave's LLM Context endpoint, which returns page-content snippets
 * extracted for LLM consumption instead of the short `description` the Web
 * Search endpoint gives. The request shape is fixed and not
 * model-configurable apart from `freshness`: `count=8` results, a
 * `maximum_number_of_tokens=3072` total budget and
 * `maximum_number_of_tokens_per_url=1024` bound the content the model has to
 * read (and that is resent on every later loop step), and
 * `enable_source_metadata=true` adds per-URL title, hostname and age. It is
 * billed as one Search-plan request, the same unit as Web Search. Auth is
 * `X-Subscription-Token`, not `Bearer` — Brave's one deviation from the
 * pattern every other provider in this app uses.
 */
async function executeBraveSearch(
  apiKey: string,
  query: string,
  freshness: SearchFreshness | undefined,
  abortSignal: AbortSignal | undefined,
  logger?: LoggerLike,
): Promise<ExternalSearchToolOutput> {
  const url = new URL(BRAVE_SEARCH_API_URL)

  url.searchParams.set('q', query)
  url.searchParams.set('count', String(BRAVE_SEARCH_RESULT_COUNT))
  url.searchParams.set(
    'maximum_number_of_tokens',
    String(BRAVE_SEARCH_MAX_TOKENS),
  )
  url.searchParams.set(
    'maximum_number_of_tokens_per_url',
    String(BRAVE_SEARCH_MAX_TOKENS_PER_URL),
  )
  url.searchParams.set('enable_source_metadata', 'true')

  if (freshness) {
    url.searchParams.set('freshness', toBraveFreshnessCode(freshness))
  }

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

  const body = await response.json() as BraveLlmContextResponse
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
 * persisted message parts. Every `execute` spends one call from the
 * per-request `searchBudget` before any provider request, so parallel calls
 * in one step cannot exceed `EXTERNAL_SEARCH_MAX_CALLS_PER_TURN`.
 */
export async function getBraveWebSearchTools(
  apiKey: string,
  searchBudget: ExternalSearchBudget = createExternalSearchBudget(),
  logger?: LoggerLike,
): Promise<FormattedTools> {
  return {
    tools: {
      web_search_brave: withFollowUpTurn(tool({
        description: 'Search the web using Brave Search. Call this when '
          + 'the question depends on current information, recent events, '
          + 'or anything you are not confident about. Start with one '
          + 'broad query that covers the whole question; search again '
          + 'only if the results are insufficient or the question has '
          + 'clearly separate parts. Set freshness for news and recent '
          + 'events.',
        inputSchema: z.object({
          query: z.string().min(1).max(BRAVE_SEARCH_QUERY_MAX_LENGTH),
          freshness: searchFreshnessSchema,
        }),
        async execute(input, options) {
          consumeExternalSearchCall(searchBudget)

          return await executeBraveSearch(
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
