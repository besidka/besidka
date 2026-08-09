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
  }
}

export interface CloudflareGatewayCatalogCredentials {
  accountId: string
  apiKey: string
}

/**
 * Cloudflare's `format=openrouter` model search response is documented as
 * returning models "in marketplace format per OpenRouter specification" —
 * the same `{data: [...]}` envelope and per-model field names as
 * `fetchOpenRouterCatalog` above, so this reuses `normalizeOpenRouterModel`
 * instead of duplicating a normalizer. Unverified against a live Cloudflare
 * account in this environment (no real Workers AI token available) — flagged
 * for a human to confirm with real credentials before shipping.
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

  const payload = await response.json() as OpenRouterModelsResponse

  return payload.data.map(normalizeOpenRouterModel)
}

interface CloudflareGatewayCatalogCacheEntry {
  models: GatewayModel[]
  cachedAt: number
}

/**
 * Cloudflare's catalog needs the caller's own account id + token, so it
 * cannot share `getCachedGatewayCatalog`'s global, zero-arg cache further
 * down in this file — each account gets its own cache entry
 * (`gateway-catalog:cloudflare:${accountId}`), never a shared one. Mirrors
 * the same freshness/stale-fallback/non-fatal-cache-write-failure behaviour
 * as the public gateways.
 */
export async function getCachedCloudflareGatewayCatalog(
  credentials: CloudflareGatewayCatalogCredentials,
  options: GetCachedGatewayCatalogOptions = {},
): Promise<GatewayModel[]> {
  const cache = useStorage('cache')
  const cacheKey = `gateway-catalog:cloudflare:${credentials.accountId}`
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
