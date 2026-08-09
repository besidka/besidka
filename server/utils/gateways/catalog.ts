import { createError } from 'evlog'
import type { GatewayModel } from '#shared/types/gateways.d'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

const VERCEL_GATEWAY_MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models'
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
const GATEWAY_CATALOG_CACHE_TTL_MS = 60 * 60 * 1000
/**
 * Cloudflare's catalog is a per-account resource (it requires the caller's
 * own account id + token), not a shared public one like Vercel's or
 * OpenRouter's — a much shorter freshness window bounds how long a user
 * would see a stale model list after adding a model to their own Workers AI
 * account, without reducing this to an uncached passthrough on every picker
 * open.
 */
const CLOUDFLARE_GATEWAY_CATALOG_CACHE_TTL_MS = 15 * 60 * 1000

interface VercelGatewayPricing {
  input?: string
  output?: string
}

interface VercelGatewayModalities {
  input: string[]
  output: string[]
}

interface VercelGatewayRawModel {
  id: string
  name: string
  description?: string
  context_window?: number
  max_tokens?: number
  type: string
  modalities?: VercelGatewayModalities
  supported_parameters?: string[]
  pricing?: VercelGatewayPricing
  tags?: string[]
}

interface VercelGatewayModelsResponse {
  data: VercelGatewayRawModel[]
}

interface OpenRouterPricing {
  prompt?: string
  completion?: string
}

interface OpenRouterArchitecture {
  input_modalities?: string[]
  output_modalities?: string[]
}

interface OpenRouterTopProvider {
  max_completion_tokens?: number | null
}

interface OpenRouterRawModel {
  id: string
  name: string
  description?: string
  context_length?: number
  architecture?: OpenRouterArchitecture
  pricing?: OpenRouterPricing
  supported_parameters?: string[]
  top_provider?: OpenRouterTopProvider
}

interface OpenRouterModelsResponse {
  data: OpenRouterRawModel[]
}

/**
 * Both Vercel AI Gateway and OpenRouter report `pricing` as per-token decimal
 * strings (e.g. `"0.0000025"`), unlike this app's curated static catalog,
 * which displays per-million-token strings. `GatewayModel.pricing` passes
 * each gateway's raw per-token strings through unchanged rather than
 * converting between the two conventions.
 */
export async function fetchVercelGatewayCatalog(): Promise<GatewayModel[]> {
  const response = await fetch(VERCEL_GATEWAY_MODELS_URL)

  if (!response.ok) {
    throw createError({
      message: 'Failed to fetch Vercel AI Gateway model catalog',
      status: 502,
      why: `Vercel AI Gateway returned HTTP ${response.status}`,
      fix: 'Retry later or check https://ai-gateway.vercel.sh status',
    })
  }

  const payload = await response.json() as VercelGatewayModelsResponse

  return payload.data
    .filter(model => model.type === 'language')
    .map(normalizeVercelGatewayModel)
}

/**
 * `tags` is Vercel's own coarse capability roster (also carries `'free'`,
 * `'vision'`, `'tool-use'`, …) and the only field that surfaces web-search
 * support at all — `supported_parameters` never includes a web-search entry,
 * unlike OpenRouter's `web_search_options`. Used for both reasoning and
 * web-search here so both signals come from one source.
 */
function normalizeVercelGatewayModel(
  model: VercelGatewayRawModel,
): GatewayModel {
  return {
    id: model.id,
    name: model.name,
    description: model.description,
    contextLength: model.context_window,
    maxOutputTokens: model.max_tokens,
    pricing: model.pricing?.input && model.pricing?.output
      ? { input: model.pricing.input, output: model.pricing.output }
      : undefined,
    modalities: model.modalities,
    supportsTools: model.supported_parameters?.includes('tools'),
    supportsReasoning: model.tags?.includes('reasoning'),
    supportsWebSearch: model.tags?.includes('web-search'),
  }
}

export async function fetchOpenRouterCatalog(): Promise<GatewayModel[]> {
  const response = await fetch(OPENROUTER_MODELS_URL)

  if (!response.ok) {
    throw createError({
      message: 'Failed to fetch OpenRouter model catalog',
      status: 502,
      why: `OpenRouter returned HTTP ${response.status}`,
      fix: 'Retry later or check https://openrouter.ai status',
    })
  }

  const payload = await response.json() as OpenRouterModelsResponse

  return payload.data.map(normalizeOpenRouterModel)
}

function normalizeOpenRouterModel(model: OpenRouterRawModel): GatewayModel {
  return {
    id: model.id,
    name: model.name,
    description: model.description,
    contextLength: model.context_length,
    maxOutputTokens: model.top_provider?.max_completion_tokens ?? undefined,
    pricing: model.pricing?.prompt && model.pricing?.completion
      ? { input: model.pricing.prompt, output: model.pricing.completion }
      : undefined,
    modalities: model.architecture
      ? {
        input: model.architecture.input_modalities ?? [],
        output: model.architecture.output_modalities ?? [],
      }
      : undefined,
    supportsTools: model.supported_parameters?.includes('tools'),
    supportsReasoning: model.supported_parameters?.includes('reasoning'),
    supportsWebSearch: model.supported_parameters?.includes(
      'web_search_options',
    ),
  }
}

export interface CloudflareGatewayCatalogCredentials {
  accountId: string
  apiKey: string
}

interface CloudflareGatewayLimit {
  value?: number
  unit?: string
}

interface CloudflareGatewayPricingEntry {
  type?: string
  unit?: string
  cost_usd?: string
}

interface CloudflareGatewayInputModality {
  type?: string
  supported_inputs?: {
    max_context_length?: CloudflareGatewayLimit
    max_prompt_length?: CloudflareGatewayLimit
  }
  pricing?: CloudflareGatewayPricingEntry[]
}

interface CloudflareGatewayOutputModality {
  type?: string
  max_length?: CloudflareGatewayLimit
  supported_parameters?: Record<string, unknown>
  pricing?: CloudflareGatewayPricingEntry[]
}

interface CloudflareGatewayRawModel {
  id: string
  name: string
  description?: string
  input_modalities?: CloudflareGatewayInputModality[]
  output_modalities?: CloudflareGatewayOutputModality[]
}

interface CloudflareGatewayModelsResponse {
  data: CloudflareGatewayRawModel[]
}

/**
 * Cloudflare's `format=openrouter` model search response is documented as
 * returning models "in marketplace format per OpenRouter specification" —
 * NOT the flat, consumer-facing shape `fetchOpenRouterCatalog` above parses
 * (`architecture.input_modalities: string[]`, flat `pricing.{prompt,
 * completion}`, top-level `supported_parameters: string[]`). OpenRouter's
 * "for providers" marketplace/listing format
 * (https://openrouter.ai/docs/guides/get-started/for-providers, schema
 * version 2.4, OpenAPI document at
 * https://openrouter.ai/docs/assets/provider-monitor-schema-v2.openapi.json)
 * is a structurally different, per-modality shape: `input_modalities`/
 * `output_modalities` are arrays of typed objects, each owning its own
 * `pricing` array of `{type, unit, cost_usd}` entries and its own
 * constraints (`supported_inputs.max_context_length.value` for context
 * length, `max_length.value` for max output tokens on the text output
 * modality). Tool-calling support is signalled by the presence of a `tools`
 * key in a text output modality's `supported_parameters` map, not a
 * top-level `supported_parameters: string[]` array.
 *
 * This normalizer targets that documented marketplace schema. It is backed
 * by OpenRouter's own published OpenAPI schema for the format (strong,
 * versioned, machine-checkable evidence of what "marketplace format" means),
 * but has NOT been verified against a live Cloudflare account response in
 * this environment (no real Workers AI token available) — Cloudflare's own
 * API reference confirms the `format=openrouter` parameter and the
 * `{data: [...]}` envelope, but does not publish its own per-model field
 * schema, only pointing at "marketplace format". If a live account later
 * shows Cloudflare's actual response deviates from this schema, update this
 * normalizer and its tests accordingly — the parsing below is written
 * defensively (optional chaining throughout, `find`-or-`undefined`) so an
 * unexpected shape degrades to a `{id, name}`-only `GatewayModel` rather
 * than throwing.
 *
 * `supportsReasoning`/`supportsWebSearch` are deliberately never set here:
 * unlike `supportsTools`, whose `tools` key this schema documents landing in
 * a text output modality's `supported_parameters` map, nothing in the
 * published schema names a reasoning or web-search parameter key. Leaving
 * both `undefined` keeps the "unknown, not unsupported" contract rather than
 * guessing a key name with no schema or live-account evidence behind it.
 */
export async function fetchCloudflareGatewayCatalog(
  credentials: CloudflareGatewayCatalogCredentials,
): Promise<GatewayModel[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/ai/models/search?format=openrouter`
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${credentials.apiKey}`,
    },
  })

  if (!response.ok) {
    throw createError({
      message: 'Failed to fetch Cloudflare AI Gateway model catalog',
      status: 502,
      why: `Cloudflare returned HTTP ${response.status}`,
      fix: 'Check your Cloudflare account ID and API token, then retry',
    })
  }

  const payload = await response.json() as CloudflareGatewayModelsResponse

  return payload.data.map(normalizeCloudflareGatewayModel)
}

function findCloudflareTextInputModality(
  inputModalities: CloudflareGatewayInputModality[] | undefined,
): CloudflareGatewayInputModality | undefined {
  return inputModalities?.find(modality => modality.type === 'text')
}

function findCloudflareTextOutputModality(
  outputModalities: CloudflareGatewayOutputModality[] | undefined,
): CloudflareGatewayOutputModality | undefined {
  return outputModalities?.find(modality => modality.type === 'text')
}

function findCloudflarePricingCost(
  entries: CloudflareGatewayPricingEntry[] | undefined,
  type: string,
): string | undefined {
  return entries?.find(entry => entry.type === type)?.cost_usd
}

function normalizeCloudflareGatewayModel(
  model: CloudflareGatewayRawModel,
): GatewayModel {
  const textInputModality = findCloudflareTextInputModality(
    model.input_modalities,
  )
  const textOutputModality = findCloudflareTextOutputModality(
    model.output_modalities,
  )
  const inputCost = findCloudflarePricingCost(
    textInputModality?.pricing,
    'prompt',
  )
  const outputCost = findCloudflarePricingCost(
    textOutputModality?.pricing,
    'completion',
  )

  return {
    id: model.id,
    name: model.name,
    description: model.description,
    contextLength: textInputModality?.supported_inputs
      ?.max_context_length?.value,
    maxOutputTokens: textOutputModality?.max_length?.value,
    pricing: inputCost && outputCost
      ? { input: inputCost, output: outputCost }
      : undefined,
    modalities: model.input_modalities || model.output_modalities
      ? {
        input: (model.input_modalities || [])
          .map(modality => modality.type)
          .filter((type): type is string => Boolean(type)),
        output: (model.output_modalities || [])
          .map(modality => modality.type)
          .filter((type): type is string => Boolean(type)),
      }
      : undefined,
    supportsTools: model.output_modalities
      ? model.output_modalities.some((modality) => {
        return Boolean(modality.supported_parameters?.tools)
      })
      : undefined,
  }
}

interface CloudflareGatewayCatalogCacheEntry {
  models: GatewayModel[]
  cachedAt: number
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Cloudflare's catalog needs the caller's own account id + token, so it
 * cannot share `getCachedGatewayCatalog`'s global, zero-arg cache further
 * down in this file — each account gets its own cache entry. Mirrors the
 * same freshness/stale-fallback/non-fatal-cache-write-failure behaviour as
 * the public gateways.
 *
 * The cache key includes a hash of the caller's own `apiKey`
 * (`gateway-catalog:cloudflare:${accountId}:${sha256Hex(apiKey)}`), not just
 * the `accountId`. The POST route that saves these credentials never
 * validates the accountId+apiKey pair against Cloudflare, so a user could
 * save someone else's real (or guessed) `accountId` alongside their own
 * fake `apiKey`. Keying the cache on `accountId` alone would let that user
 * read another account's model list on a cache hit, as long as the real
 * account owner's genuine request had already populated the cache within
 * the TTL window. Hashing in the apiKey means a cache hit is only possible
 * for someone who has previously supplied that exact token for that
 * account — which requires their own prior request to have actually reached
 * Cloudflare's API with it. Only the hash is stored in the key, never the
 * raw apiKey.
 */
export async function getCachedCloudflareGatewayCatalog(
  credentials: CloudflareGatewayCatalogCredentials,
  options: GetCachedGatewayCatalogOptions = {},
): Promise<GatewayModel[]> {
  const cache = useStorage('cache')
  const apiKeyHash = await sha256Hex(credentials.apiKey)
  const cacheKey = `gateway-catalog:cloudflare:${credentials.accountId}:${apiKeyHash}`
  const cached = await cache.getItem<CloudflareGatewayCatalogCacheEntry>(
    cacheKey,
  )
  const now = Date.now()

  if (
    cached
    && now - cached.cachedAt < CLOUDFLARE_GATEWAY_CATALOG_CACHE_TTL_MS
  ) {
    return cached.models
  }

  let models: GatewayModel[]

  try {
    models = await fetchCloudflareGatewayCatalog(credentials)
  } catch (exception) {
    if (!cached) {
      throw exception
    }

    options.logger?.set({
      gatewayCatalogFetch: {
        gateway: 'cloudflare',
        servedStale: true,
      },
      attributes: {
        gatewayCatalogFetch: {
          error: exceptionMessage(exception),
        },
      },
    })

    return cached.models
  }

  try {
    await cache.setItem<CloudflareGatewayCatalogCacheEntry>(cacheKey, {
      models,
      cachedAt: now,
    })
  } catch (exception) {
    options.logger?.set({
      attributes: {
        gatewayCatalogCacheWrite: {
          gateway: 'cloudflare',
          error: exceptionMessage(exception),
        },
      },
    })
  }

  return models
}

type CachedGatewayId = 'vercel' | 'openrouter'

const gatewayCatalogFetchers: Record<
  CachedGatewayId,
  () => Promise<GatewayModel[]>
> = {
  vercel: fetchVercelGatewayCatalog,
  openrouter: fetchOpenRouterCatalog,
}

interface GatewayCatalogCacheEntry {
  models: GatewayModel[]
  cachedAt: number
}

interface GetCachedGatewayCatalogOptions {
  logger?: { set: (fields: Record<string, unknown>) => void }
}

/**
 * Caches each gateway's catalog globally in KV (public data, no per-user
 * variance) with a 1-hour freshness window. The cache entry itself never
 * expires in storage — freshness is decided entirely by comparing `cachedAt`
 * against the TTL — so a stale copy always remains available as a fallback
 * if the upstream fetch fails. A cache-write failure never discards a valid
 * freshly-fetched catalog — it is logged as non-fatal context instead.
 */
export async function getCachedGatewayCatalog(
  gatewayId: CachedGatewayId,
  options: GetCachedGatewayCatalogOptions = {},
): Promise<GatewayModel[]> {
  const cache = useStorage('cache')
  const cacheKey = `gateway-catalog:${gatewayId}`
  const cached = await cache.getItem<GatewayCatalogCacheEntry>(cacheKey)
  const now = Date.now()

  if (cached && now - cached.cachedAt < GATEWAY_CATALOG_CACHE_TTL_MS) {
    return cached.models
  }

  let models: GatewayModel[]

  try {
    models = await gatewayCatalogFetchers[gatewayId]()
  } catch (exception) {
    if (!cached) {
      throw exception
    }

    options.logger?.set({
      gatewayCatalogFetch: {
        gateway: gatewayId,
        servedStale: true,
      },
      attributes: {
        gatewayCatalogFetch: {
          error: exceptionMessage(exception),
        },
      },
    })

    return cached.models
  }

  try {
    await cache.setItem<GatewayCatalogCacheEntry>(cacheKey, {
      models,
      cachedAt: now,
    })
  } catch (exception) {
    options.logger?.set({
      attributes: {
        gatewayCatalogCacheWrite: {
          gateway: gatewayId,
          error: exceptionMessage(exception),
        },
      },
    })
  }

  return models
}
