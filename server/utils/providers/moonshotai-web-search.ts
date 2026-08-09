import type { JSONSchema7 } from 'ai'
import type { LoggerLike } from '~~/server/utils/files/logger'
import type { FormattedTools } from '~~/server/types/tools.d'
import { createError } from 'evlog'
import { jsonSchema, tool } from 'ai'
import { withFollowUpTurn } from '~~/server/utils/ai/tool-loop'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

const MOONSHOT_API_BASE_URL = 'https://api.moonshot.ai/v1'
const MOONSHOT_WEB_SEARCH_FORMULA_URI = 'moonshot/web-search:latest'
const MOONSHOT_WEB_SEARCH_DECLARATION_CACHE_KEY
  = 'moonshotai-web-search-tool-declaration:v1'
const MOONSHOT_WEB_SEARCH_DECLARATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MOONSHOT_WEB_SEARCH_DECLARATION_FETCH_TIMEOUT_MS = 10_000

interface MoonshotFormulaFunctionDeclaration {
  name: string
  description?: string
  parameters: JSONSchema7
}

interface MoonshotFormulaToolsResponse {
  tools?: Array<{
    type?: string
    function?: Partial<MoonshotFormulaFunctionDeclaration>
  }>
}

interface MoonshotFiberResponse {
  status?: string
  context?: {
    output?: string
    encrypted_output?: string
  }
}

interface MoonshotWebSearchDeclarationCacheEntry {
  declaration: MoonshotFormulaFunctionDeclaration
  cachedAt: number
}

interface MoonshotWebSearchInput {
  query: string
}

async function fetchMoonshotWebSearchDeclaration(
  apiKey: string,
): Promise<MoonshotFormulaFunctionDeclaration> {
  const response = await fetch(
    `${MOONSHOT_API_BASE_URL}/formulas/`
    + `${MOONSHOT_WEB_SEARCH_FORMULA_URI}/tools`,
    {
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(
        MOONSHOT_WEB_SEARCH_DECLARATION_FETCH_TIMEOUT_MS,
      ),
    },
  )

  if (!response.ok) {
    throw createError({
      message: 'Web search is temporarily unavailable for Moonshot AI.',
      status: 502,
      why: `Moonshot's formula tool declaration endpoint responded with `
        + `HTTP ${response.status}.`,
      fix: 'Try again shortly, or send the message without web search.',
    })
  }

  const body = await response.json() as MoonshotFormulaToolsResponse
  const declaration = body.tools?.[0]?.function

  if (!declaration?.name || !declaration.parameters) {
    throw createError({
      message: 'Web search is temporarily unavailable for Moonshot AI.',
      status: 502,
      why: 'Moonshot returned an unexpected tool declaration shape.',
      fix: 'Try again shortly, or send the message without web search.',
    })
  }

  return {
    name: declaration.name,
    description: declaration.description,
    parameters: declaration.parameters,
  }
}

/**
 * Moonshot's Formula API tool declaration is a static, account-independent
 * schema rather than per-request or per-user data — Moonshot's own docs
 * describe a formula as carrying one fixed declaration — so it is cached
 * globally, keyed only by the formula URI and never by the caller's own API
 * key, the same way `server/utils/gateways/catalog.ts` caches Vercel's and
 * OpenRouter's public model catalogs. Whichever user's request misses the
 * cache pays the one live fetch (using their own key, since the endpoint
 * still requires a valid Bearer token); every other request within the TTL
 * window reuses the result. A stale-serve after a failed refresh and a
 * cache-write failure are both non-fatal — the declaration was already
 * fetched successfully either way — but are reported through `logger` so
 * they stay visible in Axiom, mirroring `server/utils/gateways/catalog.ts`'s
 * gateway-catalog caching.
 * @see https://platform.kimi.ai/docs/guide/use-official-tools
 */
async function getCachedMoonshotWebSearchDeclaration(
  apiKey: string,
  logger?: LoggerLike,
): Promise<MoonshotFormulaFunctionDeclaration> {
  const cache = useStorage('cache')
  const cached = await cache.getItem<MoonshotWebSearchDeclarationCacheEntry>(
    MOONSHOT_WEB_SEARCH_DECLARATION_CACHE_KEY,
  )
  const now = Date.now()

  if (
    cached
    && now - cached.cachedAt < MOONSHOT_WEB_SEARCH_DECLARATION_CACHE_TTL_MS
  ) {
    return cached.declaration
  }

  let declaration: MoonshotFormulaFunctionDeclaration

  try {
    declaration = await fetchMoonshotWebSearchDeclaration(apiKey)
  } catch (exception) {
    if (!cached) {
      throw exception
    }

    logger?.set({
      attributes: {
        moonshotWebSearchDeclarationFetch: {
          servedStale: true,
          error: exceptionMessage(exception),
        },
      },
    })

    return cached.declaration
  }

  try {
    await cache.setItem<MoonshotWebSearchDeclarationCacheEntry>(
      MOONSHOT_WEB_SEARCH_DECLARATION_CACHE_KEY,
      { declaration, cachedAt: now },
    )
  } catch (exception) {
    logger?.set({
      attributes: {
        moonshotWebSearchDeclarationCacheWrite: {
          error: exceptionMessage(exception),
        },
      },
    })
  }

  return declaration
}

/**
 * Executes the already-declared formula through Moonshot's Fiber endpoint
 * and returns its result verbatim. Web search is a "protected" formula, so a
 * successful run reports its result inside `context.encrypted_output` — an
 * opaque, Moonshot-encrypted blob documented as meant to be echoed back as
 * plain tool-result content on the very next turn, never decrypted or
 * otherwise inspected by the caller.
 * @see https://platform.kimi.ai/docs/guide/use-official-tools
 */
async function executeMoonshotWebSearchFiber(
  apiKey: string,
  functionName: string,
  input: unknown,
  abortSignal: AbortSignal | undefined,
): Promise<string> {
  const response = await fetch(
    `${MOONSHOT_API_BASE_URL}/formulas/`
    + `${MOONSHOT_WEB_SEARCH_FORMULA_URI}/fibers`,
    {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: functionName,
        arguments: JSON.stringify(input),
      }),
      signal: abortSignal,
    },
  )

  if (!response.ok) {
    throw createError({
      message: 'Moonshot web search failed.',
      status: 502,
      why: `Moonshot's fiber execution endpoint responded with `
        + `HTTP ${response.status}.`,
      fix: 'Try the request again.',
    })
  }

  const fiber = await response.json() as MoonshotFiberResponse

  if (fiber.status !== 'succeeded') {
    throw createError({
      message: 'Moonshot web search failed.',
      status: 502,
      why: `Moonshot's fiber execution finished with status `
        + `"${fiber.status ?? 'unknown'}".`,
      fix: 'Try the request again.',
    })
  }

  const output = fiber.context?.encrypted_output ?? fiber.context?.output

  if (!output) {
    throw createError({
      message: 'Moonshot web search failed.',
      status: 502,
      why: 'Moonshot\'s fiber execution succeeded but returned no output.',
      fix: 'Try the request again.',
    })
  }

  return output
}

/**
 * Builds Moonshot's Formula-API `web_search` tool, marked with
 * `withFollowUpTurn()` so the model gets a second turn to answer in natural
 * language once the (possibly encrypted) search result comes back. Never
 * pair this with a forced `toolChoice`: see `server/utils/ai/tool-loop.ts`'s
 * doc comment on why that would loop the tool forever instead of answering.
 */
export async function getMoonshotWebSearchTools(
  apiKey: string,
  logger?: LoggerLike,
): Promise<FormattedTools> {
  const declaration = await getCachedMoonshotWebSearchDeclaration(
    apiKey,
    logger,
  )

  return {
    tools: {
      [declaration.name]: withFollowUpTurn(tool({
        description: declaration.description
          ?? 'Search the web for current information.',
        inputSchema: jsonSchema<MoonshotWebSearchInput>(
          declaration.parameters,
        ),
        async execute(input, options) {
          return await executeMoonshotWebSearchFiber(
            apiKey,
            declaration.name,
            input,
            options.abortSignal,
          )
        },
      })),
    },
  }
}
