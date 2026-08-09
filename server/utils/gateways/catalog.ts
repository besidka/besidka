import { createError } from 'evlog'
import type { GatewayModel } from '#shared/types/gateways.d'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

const VERCEL_GATEWAY_MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models'
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
const GATEWAY_CATALOG_CACHE_TTL_MS = 60 * 60 * 1000

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
 * if the upstream fetch fails.
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

  try {
    const models = await gatewayCatalogFetchers[gatewayId]()

    await cache.setItem<GatewayCatalogCacheEntry>(cacheKey, {
      models,
      cachedAt: now,
    })

    return models
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
}
