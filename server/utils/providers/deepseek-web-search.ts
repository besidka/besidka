import type { LoggerLike } from '~~/server/utils/files/logger'
import type { FormattedTools } from '~~/server/types/tools.d'
import { createError } from 'evlog'
import { isHttpUrl } from '#shared/utils/http-url'
import { tool } from 'ai'
import { z } from 'zod'
import { withFollowUpTurn } from '~~/server/utils/ai/tool-loop'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { isIsoDateString } from '~~/server/utils/search/iso-date'
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

const DEEPSEEK_WEB_SEARCH_PROVIDER_LABEL = 'DeepSeek'
const DEEPSEEK_WEB_SEARCH_API_URL = 'https://api.deepseek.com/v1/tools/search'
const DEEPSEEK_WEB_SEARCH_REQUEST_TIMEOUT_MS = 15_000
const DEEPSEEK_WEB_SEARCH_RESULT_COUNT = 8
const DEEPSEEK_WEB_SEARCH_QUERY_MAX_LENGTH = 128
const DEEPSEEK_WEB_SEARCH_TITLE_MAX_LENGTH = 300
const DEEPSEEK_WEB_SEARCH_SNIPPET_MAX_LENGTH = 500
const DEEPSEEK_WEB_SEARCH_SUMMARY_MAX_LENGTH = 1500
const DEEPSEEK_WEB_SEARCH_SITE_NAME_MAX_LENGTH = 100
const DEEPSEEK_WEB_SEARCH_URL_MAX_LENGTH = 2048
const DEEPSEEK_WEB_SEARCH_LOGGED_ERROR_MAX_LENGTH = 120

interface DeepSeekSearchApiResponse {
  results?: unknown
}

export interface DeepSeekWebSearchResult {
  title: string
  url: string
  snippet: string
  summary: string
  siteName?: string
  date?: string
}

export interface DeepSeekWebSearchToolOutput {
  provider: 'deepseek'
  query: string
  billable: boolean
  results: DeepSeekWebSearchResult[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readBoundedText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

function readHttpUrl(value: unknown): string | undefined {
  if (
    typeof value !== 'string'
    || value.length > DEEPSEEK_WEB_SEARCH_URL_MAX_LENGTH
    || !isHttpUrl(value)
  ) {
    return undefined
  }

  return value
}

function readRawResults(
  response: DeepSeekSearchApiResponse,
): unknown[] {
  return Array.isArray(response.results)
    ? response.results.slice(0, DEEPSEEK_WEB_SEARCH_RESULT_COUNT)
    : []
}

/**
 * Search results are third-party content: every field is coerced to a
 * bounded string, a result whose URL is not a plain http(s) URL is dropped
 * so it can never reach the tool output or a source chip, and `date` is
 * kept only when it is an ISO date or datetime.
 */
function normalizeDeepSeekResults(
  rawResults: unknown[],
): DeepSeekWebSearchResult[] {
  const results: DeepSeekWebSearchResult[] = []

  for (const rawResult of rawResults) {
    if (!isRecord(rawResult)) {
      continue
    }

    const url = readHttpUrl(rawResult.url)

    if (url === undefined) {
      continue
    }

    const siteName = readBoundedText(
      rawResult.site_name,
      DEEPSEEK_WEB_SEARCH_SITE_NAME_MAX_LENGTH,
    )

    results.push({
      title: readBoundedText(
        rawResult.title,
        DEEPSEEK_WEB_SEARCH_TITLE_MAX_LENGTH,
      ),
      url,
      snippet: readBoundedText(
        rawResult.snippet,
        DEEPSEEK_WEB_SEARCH_SNIPPET_MAX_LENGTH,
      ),
      summary: readBoundedText(
        rawResult.summary,
        DEEPSEEK_WEB_SEARCH_SUMMARY_MAX_LENGTH,
      ),
      ...(siteName ? { siteName } : {}),
      ...(isIsoDateString(rawResult.date) ? { date: rawResult.date } : {}),
    })
  }

  return results
}

async function discardResponseBody(
  response: Response,
  logger?: LoggerLike,
) {
  try {
    await response.body?.cancel()
  } catch (exception) {
    logger?.set({
      attributes: {
        deepseekWebSearch: {
          bodyCancelError: exceptionMessage(exception)
            .slice(0, DEEPSEEK_WEB_SEARCH_LOGGED_ERROR_MAX_LENGTH),
        },
      },
    })
  }
}

/**
 * Calls DeepSeek's standalone Search API with the user's own DeepSeek key.
 * The request is a fixed shape apart from the model-written query:
 * `count=8` results and `need_content=false`, so the model reads each
 * result's `summary` instead of full page content that would be resent on
 * every later loop step. DeepSeek bills only a request that returns HTTP 200
 * with a non-empty `results` array, so `billable` mirrors exactly that
 * condition and is what the cost accounting counts; an empty result set and
 * every thrown failure stay unbilled. `billable` is derived from the raw
 * response, before unusable results are dropped, because that is what
 * DeepSeek bills on.
 * @see https://api-docs.deepseek.com/quick_start/pricing
 */
async function executeDeepSeekSearch(
  apiKey: string,
  query: string,
  abortSignal: AbortSignal | undefined,
  logger?: LoggerLike,
): Promise<DeepSeekWebSearchToolOutput> {
  const timeoutSignal = AbortSignal.timeout(
    DEEPSEEK_WEB_SEARCH_REQUEST_TIMEOUT_MS,
  )
  const signal = abortSignal
    ? AbortSignal.any([abortSignal, timeoutSignal])
    : timeoutSignal

  let response: Response

  try {
    response = await fetch(DEEPSEEK_WEB_SEARCH_API_URL, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query,
        count: DEEPSEEK_WEB_SEARCH_RESULT_COUNT,
        need_content: false,
      }),
      redirect: 'error',
      signal,
    })
  } catch (exception) {
    if (isUserAbortError(exception)) {
      throw exception
    }

    throw createError(buildSearchProviderNetworkError({
      providerLabel: DEEPSEEK_WEB_SEARCH_PROVIDER_LABEL,
      exception,
    }))
  }

  if (!response.ok) {
    await discardResponseBody(response, logger)

    throw createError(buildSearchProviderStatusError({
      providerLabel: DEEPSEEK_WEB_SEARCH_PROVIDER_LABEL,
      status: response.status,
    }))
  }

  let body: DeepSeekSearchApiResponse

  try {
    body = await response.json() as DeepSeekSearchApiResponse
  } catch (exception) {
    logger?.set({
      attributes: {
        deepseekWebSearch: {
          parseFailure: {
            name: exception instanceof Error ? exception.name : 'unknown',
            status: response.status,
            contentType: response.headers.get('content-type') ?? undefined,
          },
        },
      },
    })

    throw createError({
      message: 'DeepSeek web search failed.',
      status: 502,
      why: 'DeepSeek returned a search response that is not valid JSON.',
      fix: 'Try the request again.',
    })
  }

  const rawResults = readRawResults(body)
  const results = normalizeDeepSeekResults(rawResults)

  logger?.set({
    attributes: {
      deepseekWebSearch: {
        resultCount: results.length,
      },
    },
  })

  return {
    provider: 'deepseek',
    query,
    billable: rawResults.length > 0,
    results,
  }
}

/**
 * Builds DeepSeek's `web_search` tool as a client-executed function tool:
 * `@ai-sdk/deepseek` has no native search support and the Search API is a
 * standalone endpoint, not a chat-completions parameter. Marked with
 * `withFollowUpTurn()` so the model gets a second turn to answer once
 * results come back. Never pair this with a forced `toolChoice`: see
 * `server/utils/ai/tool-loop.ts`'s doc comment on why that would loop the
 * tool forever instead of answering. Every `execute` spends one call from
 * the per-request `searchBudget` before any provider request, so parallel
 * calls in one step cannot exceed `EXTERNAL_SEARCH_MAX_CALLS_PER_TURN`
 * billable requests against DeepSeek's 5 QPS account limit.
 */
export function getDeepSeekWebSearchTools(
  apiKey: string,
  searchBudget: ExternalSearchBudget = createExternalSearchBudget(),
  logger?: LoggerLike,
): FormattedTools {
  return {
    tools: {
      web_search: withFollowUpTurn(tool({
        description: 'Search the web using DeepSeek Search. Call this when '
          + 'the question depends on current information, recent events, '
          + 'or anything you are not confident about. Start with one '
          + 'broad query that covers the whole question; search again '
          + 'only if the results are insufficient or the question has '
          + 'clearly separate parts. The query supports operators such '
          + 'as site:, -site:, "exact phrase", lang:, after: and before:.',
        inputSchema: z.object({
          query: z.string().min(1).max(DEEPSEEK_WEB_SEARCH_QUERY_MAX_LENGTH),
        }),
        async execute(input, options) {
          consumeExternalSearchCall(searchBudget)

          return await executeDeepSeekSearch(
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
