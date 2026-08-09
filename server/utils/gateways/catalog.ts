import { createError } from 'evlog'
import type { GatewayModel } from '#shared/types/gateways.d'
import {
  deriveGatewayImageGenerationSupport,
  resolveGatewayWebSearchSupport,
} from '#shared/utils/gateway-capabilities'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

const VERCEL_GATEWAY_MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models'
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
const CLOUDFLARE_ACCOUNTS_URL = 'https://api.cloudflare.com/client/v4/accounts'
const CLOUDFLARE_MODEL_SEARCH_PAGE_SIZE = 1000
const TOKENS_PER_MILLION = 1_000_000
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
 * `'vision'`, `'tool-use'`, …) and the only field that surfaces *native*
 * web-search support — `supported_parameters` never includes a web-search
 * entry, unlike OpenRouter's `web_search_options`. Absent a native tag,
 * every Vercel model (short of a confirmed image-generation one) resolves to
 * `'universal'`: Vercel's gateway-executed search tools
 * (`perplexitySearch()` and friends) work regardless of the underlying
 * model — see `resolveGatewayWebSearchSupport`.
 */
function normalizeVercelGatewayModel(
  model: VercelGatewayRawModel,
): GatewayModel {
  const supportsImageGeneration = deriveGatewayImageGenerationSupport(
    model.modalities?.output,
  )

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
    supportsWebSearch: resolveGatewayWebSearchSupport({
      gatewayId: 'vercel',
      hasNativeSignal: Boolean(model.tags?.includes('web-search')),
      isImageGenerationModel: supportsImageGeneration,
    }),
    supportsImageGeneration,
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

/**
 * `web_search_options` is documented as a native-search context-size
 * parameter (`low`/`medium`/`high`), i.e. "this model's own provider offers
 * server-side search" — a `'native'` signal, not "can this model search at
 * all". OpenRouter's universal `web` plugin (`plugins: [{ id: 'web' }]`)
 * works on any routed model regardless of that flag, so every model short
 * of a confirmed image-generation one resolves to at least `'universal'`.
 */
function normalizeOpenRouterModel(model: OpenRouterRawModel): GatewayModel {
  const supportsImageGeneration = deriveGatewayImageGenerationSupport(
    model.architecture?.output_modalities,
  )

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
    supportsWebSearch: resolveGatewayWebSearchSupport({
      gatewayId: 'openrouter',
      hasNativeSignal: Boolean(model.supported_parameters?.includes(
        'web_search_options',
      )),
      isImageGenerationModel: supportsImageGeneration,
    }),
    supportsImageGeneration,
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
 * `supportsReasoning` is deliberately never set from this shape: unlike
 * `supportsTools`, whose `tools` key this schema documents landing in a text
 * output modality's `supported_parameters` map, nothing in the published
 * schema names a reasoning parameter key — it is backfilled from the
 * default-format `reasoning` property by `fetchCloudflareGatewayCatalog`
 * instead. `supportsWebSearch` always resolves to `undefined` here too: no
 * `@cf/` model has any web-search mechanism, native or universal (Cloudflare
 * AI Gateway itself states it provides no provider-agnostic web-search
 * abstraction) — `resolveGatewayWebSearchSupport` is still called, for the
 * same "one shared policy everywhere" reason the other two gateways use it,
 * but Cloudflare's tool policy admits no gateway-side `web_search`, so it can
 * only ever fall through to `undefined`.
 */
async function fetchCloudflareMarketplaceCatalog(
  credentials: CloudflareGatewayCatalogCredentials,
): Promise<GatewayModel[]> {
  const url = buildCloudflareModelSearchUrl(credentials.accountId, {
    format: 'openrouter',
  })
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

  return (payload.data || []).map(normalizeCloudflareGatewayModel)
}

/**
 * Fetches Cloudflare's model catalog in both of the shapes its search
 * endpoint serves and joins them: the `format=openrouter` marketplace
 * projection the picker's model shape is built around, and Cloudflare's own
 * default format, whose `properties[]` array is the only place pricing,
 * `function_calling` and `reasoning` are exposed. See the Cloudflare
 * two-format join section in `docs/gateways.md`.
 *
 * Only the marketplace fetch is load-bearing — its failure propagates so
 * `getCachedCloudflareGatewayCatalog` can still serve a stale catalog. The
 * enrichment fetch is best-effort and degrades to an unenriched catalog.
 */
export async function fetchCloudflareGatewayCatalog(
  credentials: CloudflareGatewayCatalogCredentials,
  options: GetCachedGatewayCatalogOptions = {},
): Promise<GatewayModel[]> {
  const [models, propertiesByModelName] = await Promise.all([
    fetchCloudflareMarketplaceCatalog(credentials),
    fetchCloudflareModelProperties(credentials, options),
  ])

  if (!propertiesByModelName) {
    return models
  }

  const enriched = models.map((model) => {
    return enrichCloudflareGatewayModel(model, propertiesByModelName)
  })

  options.logger?.set({
    gatewayCatalogEnrichment: {
      gateway: 'cloudflare',
      models: models.length,
      matched: models.filter((model) => {
        return propertiesByModelName.has(model.id)
      }).length,
      priced: enriched.filter(model => Boolean(model.pricing)).length,
    },
  })

  return enriched
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
  const outputModalityTypes = model.output_modalities
    ?.map(modality => modality.type)
    .filter((type): type is string => Boolean(type))
  const supportsImageGeneration = deriveGatewayImageGenerationSupport(
    outputModalityTypes,
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
        output: outputModalityTypes || [],
      }
      : undefined,
    supportsTools: model.output_modalities
      ? model.output_modalities.some((modality) => {
        return Boolean(modality.supported_parameters?.tools)
      })
      : undefined,
    supportsWebSearch: resolveGatewayWebSearchSupport({
      gatewayId: 'cloudflare',
      hasNativeSignal: false,
      isImageGenerationModel: supportsImageGeneration,
    }),
    supportsImageGeneration,
  }
}

interface CloudflareModelProperty {
  property_id?: string
  value?: unknown
}

interface CloudflareModelSearchObject {
  id?: string
  name?: string
  properties?: CloudflareModelProperty[]
}

interface CloudflareModelSearchResponse {
  result?: CloudflareModelSearchObject[]
  data?: CloudflareModelSearchObject[]
}

type CloudflareModelPropertiesByName = Map<string, CloudflareModelProperty[]>

interface CloudflareModelPriceEntry {
  unit?: unknown
  price?: unknown
  currency?: unknown
}

function buildCloudflareModelSearchUrl(
  accountId: string,
  searchParams: Record<string, string>,
): string {
  const url = new URL(
    `${CLOUDFLARE_ACCOUNTS_URL}/${accountId}/ai/models/search`,
  )

  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value)
  }

  return url.toString()
}

function logCloudflareEnrichmentFailure(
  reason: string,
  options: GetCachedGatewayCatalogOptions,
): void {
  options.logger?.set({
    attributes: {
      gatewayCatalogEnrichment: {
        gateway: 'cloudflare',
        error: reason,
      },
    },
  })
}

/**
 * Fetches Cloudflare's default-format model catalog, whose per-model objects
 * carry the `properties[]` array the marketplace projection drops. Keyed by
 * `name` (the `@cf/vendor/model` string) because the default format puts an
 * internal UUID in `id` — the inverse of the marketplace format, where `id`
 * holds that same `@cf/...` string. Resolves to `undefined` on any failure so
 * the caller can serve an unenriched catalog instead of failing outright.
 */
async function fetchCloudflareModelProperties(
  credentials: CloudflareGatewayCatalogCredentials,
  options: GetCachedGatewayCatalogOptions,
): Promise<CloudflareModelPropertiesByName | undefined> {
  try {
    const url = buildCloudflareModelSearchUrl(credentials.accountId, {
      per_page: String(CLOUDFLARE_MODEL_SEARCH_PAGE_SIZE),
    })
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
      },
    })

    if (!response.ok) {
      logCloudflareEnrichmentFailure(
        `Cloudflare returned HTTP ${response.status}`,
        options,
      )

      return undefined
    }

    const payload = await response.json() as CloudflareModelSearchResponse
    const entries = payload?.result || payload?.data

    if (!Array.isArray(entries)) {
      logCloudflareEnrichmentFailure('Unexpected response shape', options)

      return undefined
    }

    return buildCloudflareModelPropertiesMap(entries)
  } catch (exception) {
    logCloudflareEnrichmentFailure(exceptionMessage(exception), options)

    return undefined
  }
}

function buildCloudflareModelPropertiesMap(
  entries: CloudflareModelSearchObject[],
): CloudflareModelPropertiesByName {
  const propertiesByName: CloudflareModelPropertiesByName = new Map()

  for (const entry of entries) {
    if (typeof entry?.name !== 'string' || !Array.isArray(entry.properties)) {
      continue
    }

    propertiesByName.set(entry.name, entry.properties)
  }

  return propertiesByName
}

function findCloudflarePropertyValue(
  properties: CloudflareModelProperty[],
  propertyId: string,
): unknown {
  return properties.find((property) => {
    return property?.property_id === propertyId
  })?.value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Cloudflare declares every `properties[].value` as a string, but only some
 * hold one: `context_window`, `function_calling` and `reasoning` arrive as
 * `"128000"`/`"true"`, while `price` arrives as a real JSON array. Every
 * reader below coerces rather than trusts, and returns `undefined` on
 * anything it does not positively recognise.
 */
function coerceCloudflareBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    if (value !== 0 && value !== 1) {
      return undefined
    }

    return value === 1
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().toLowerCase()

  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false
  }

  return undefined
}

function coerceCloudflareNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }

  if (typeof value !== 'string' || !value.trim()) {
    return undefined
  }

  const amount = Number(value)

  return Number.isFinite(amount) ? amount : undefined
}

function coerceCloudflareTokenCount(value: unknown): number | undefined {
  const amount = coerceCloudflareNumber(value)

  if (amount === undefined || amount <= 0) {
    return undefined
  }

  return Math.floor(amount)
}

function parseCloudflarePriceEntries(
  value: unknown,
): CloudflareModelPriceEntry[] {
  if (Array.isArray(value)) {
    return value.filter(isPlainObject)
  }

  if (isPlainObject(value)) {
    return [value]
  }

  if (typeof value !== 'string' || !value.trim()) {
    return []
  }

  try {
    const parsed: unknown = JSON.parse(value)

    if (!Array.isArray(parsed) && !isPlainObject(parsed)) {
      return []
    }

    return parseCloudflarePriceEntries(parsed)
  } catch {
    return []
  }
}

function resolveCloudflarePriceUnit(entry: CloudflareModelPriceEntry): string {
  return typeof entry.unit === 'string' ? entry.unit.trim().toLowerCase() : ''
}

function resolveCloudflarePriceDirection(
  entry: CloudflareModelPriceEntry,
): 'input' | 'output' | undefined {
  const unit = resolveCloudflarePriceUnit(entry)

  if (unit.includes('input') || unit.includes('prompt')) {
    return 'input'
  }

  if (unit.includes('output') || unit.includes('completion')) {
    return 'output'
  }

  return undefined
}

/**
 * Cloudflare publishes these as `"per M input tokens"` with a price of e.g.
 * `0.35`, meaning USD per million tokens, while `GatewayModel.pricing` is
 * per-token — hence the division. A unit this does not positively recognise
 * yields `undefined` rather than a guess, so an unfamiliar spelling costs a
 * missing badge instead of a price wrong by six orders of magnitude.
 */
function resolveCloudflarePricePerToken(
  entry: CloudflareModelPriceEntry,
): number | undefined {
  const amount = coerceCloudflareNumber(entry.price)
  const unit = resolveCloudflarePriceUnit(entry)

  if (amount === undefined || amount < 0 || !unit.includes('token')) {
    return undefined
  }

  if (
    typeof entry.currency === 'string'
    && entry.currency.trim().toLowerCase() !== 'usd'
  ) {
    return undefined
  }

  if (/\bper\s*1?\s*m(illion)?\b/.test(unit)) {
    return amount / TOKENS_PER_MILLION
  }

  if (/\bper\s*(1\s*)?token/.test(unit)) {
    return amount
  }

  return undefined
}

function extractCloudflarePricing(
  value: unknown,
): GatewayModel['pricing'] {
  const prices: { input?: string, output?: string } = {}

  for (const entry of parseCloudflarePriceEntries(value)) {
    const direction = resolveCloudflarePriceDirection(entry)
    const pricePerToken = resolveCloudflarePricePerToken(entry)

    if (!direction || pricePerToken === undefined || prices[direction]) {
      continue
    }

    prices[direction] = String(pricePerToken)
  }

  if (prices.input === undefined || prices.output === undefined) {
    return undefined
  }

  return { input: prices.input, output: prices.output }
}

/**
 * Backfills only what the marketplace response left `undefined` — a value the
 * primary shape already provided is never overwritten, so enrichment can add
 * signals but never contradict them.
 */
function enrichCloudflareGatewayModel(
  model: GatewayModel,
  propertiesByModelName: CloudflareModelPropertiesByName,
): GatewayModel {
  const properties = propertiesByModelName.get(model.id)

  if (!properties) {
    return model
  }

  return {
    ...model,
    contextLength: model.contextLength ?? coerceCloudflareTokenCount(
      findCloudflarePropertyValue(properties, 'context_window'),
    ),
    pricing: model.pricing ?? extractCloudflarePricing(
      findCloudflarePropertyValue(properties, 'price'),
    ),
    supportsTools: model.supportsTools ?? coerceCloudflareBoolean(
      findCloudflarePropertyValue(properties, 'function_calling'),
    ),
    supportsReasoning: model.supportsReasoning ?? coerceCloudflareBoolean(
      findCloudflarePropertyValue(properties, 'reasoning'),
    ),
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
    models = await fetchCloudflareGatewayCatalog(credentials, options)
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

/**
 * Best-effort lookup of one model's own catalog entry, used by the Vercel
 * and Cloudflare chat builders to read `maxOutputTokens`/`pricing` before
 * sending a request (see `docs/gateways.md`'s max-tokens capping section).
 * `fetchCatalog` is expected to be a call to one of the two
 * `getCached*GatewayCatalog` functions above, so this is a cache hit in the
 * common case — a user only ever sends to a gateway model they already saw
 * in the picker, which just fetched the same catalog. Any failure (cold
 * cache plus an upstream outage, an unexpected response shape, etc.)
 * resolves to `undefined` rather than throwing, so a transient catalog
 * problem never blocks an otherwise-valid chat send.
 */
export async function findGatewayCatalogModel(
  fetchCatalog: () => Promise<GatewayModel[]>,
  modelId: string,
  logger?: { set: (fields: Record<string, unknown>) => void },
): Promise<GatewayModel | undefined> {
  try {
    const models = await fetchCatalog()

    return models.find(model => model.id === modelId)
  } catch (exception) {
    logger?.set({
      attributes: {
        gatewayCatalogModelLookup: {
          error: exceptionMessage(exception),
        },
      },
    })

    return undefined
  }
}
