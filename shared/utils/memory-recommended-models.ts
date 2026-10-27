import { getGatewayModelProviderPrefix } from '#shared/utils/gateway-model-id'

export interface RecommendedDirectModel {
  providerId: string
  modelId: string
}

const GATEWAY_VENDOR_TO_PROVIDER_ID: Record<string, string> = {
  'anthropic': 'anthropic',
  'google': 'google',
  'openai': 'openai',
  'x-ai': 'xai',
  'xai': 'xai',
  'deepseek': 'deepseek',
  'deepseek-ai': 'deepseek',
  'moonshotai': 'moonshotai',
  'qwen': 'qwen',
  'alibaba': 'qwen',
}

const CLOUDFLARE_MODEL_ID_PREFIX = '@cf/'
const TRAILING_VARIANT_PATTERN = /:[^:/]*$/
const TRAILING_DATE_PATTERN = /-(\d{8}|\d{4}-\d{2}-\d{2})$/

/**
 * Lower-cases, drops a trailing `:variant` routing suffix (`:free`) and a
 * trailing release date (`-20261001`, `-2026-10-01`), then folds dots into
 * dashes so `claude-haiku-5.5` and `claude-haiku-5-5` compare equal. Only
 * trailing segments are touched, so an interior number such as the `0309` in
 * `grok-4.20-0309-non-reasoning` survives.
 */
export function normalizeModelSlug(slug: string): string {
  return slug
    .trim()
    .toLowerCase()
    .replace(TRAILING_VARIANT_PATTERN, '')
    .replace(/\./g, '-')
    .replace(TRAILING_DATE_PATTERN, '')
}

export function getGatewayModelSlug(gatewayModelId: string): string {
  const withoutNamespace = gatewayModelId.startsWith(CLOUDFLARE_MODEL_ID_PREFIX)
    ? gatewayModelId.slice(CLOUDFLARE_MODEL_ID_PREFIX.length)
    : gatewayModelId
  const separatorIndex = withoutNamespace.indexOf('/')

  if (separatorIndex === -1) {
    return ''
  }

  return withoutNamespace.slice(separatorIndex + 1)
}

export function getGatewayModelProviderId(
  gatewayModelId: string,
): string | null {
  if (!gatewayModelId.includes('/')) {
    return null
  }

  const vendor = getGatewayModelProviderPrefix(gatewayModelId).toLowerCase()

  return GATEWAY_VENDOR_TO_PROVIDER_ID[vendor] ?? null
}

/**
 * A gateway model is recommended when it is the same vendor and the same
 * normalised model slug as a direct model flagged for memory work. The match
 * is exact on the normalised slug, never a prefix or fuzzy comparison, so a
 * sibling such as `gpt-6-luna-mini` is not recommended because `gpt-6-luna`
 * is.
 */
export function isRecommendedGatewayModel(
  gatewayModelId: string,
  recommendedDirectModels: RecommendedDirectModel[],
): boolean {
  if (!recommendedDirectModels.length) {
    return false
  }

  const providerId = getGatewayModelProviderId(gatewayModelId)

  if (!providerId) {
    return false
  }

  const slug = normalizeModelSlug(getGatewayModelSlug(gatewayModelId))

  if (!slug) {
    return false
  }

  return recommendedDirectModels.some((recommended) => {
    return recommended.providerId === providerId
      && normalizeModelSlug(recommended.modelId) === slug
  })
}
