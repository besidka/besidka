import type { GatewayModel } from '#shared/types/gateways.d'
import type { Model, ModelPriceTier } from '#shared/types/providers.d'
import type { ModelCategory, ModelCategoryOption } from '~/types/models-picker'

export const modelCategoryOptions: ModelCategoryOption[] = [
  { value: 'chat', label: 'Chat', icon: 'lucide:message-square' },
  { value: 'research', label: 'Deep research', icon: 'lucide:telescope' },
  {
    value: 'image-generation',
    label: 'Image generation',
    icon: 'lucide:image-plus',
  },
]

const priceTierClasses: Record<ModelPriceTier, string> = {
  '$': 'badge-success',
  '$$': 'badge-info',
  '$$$': 'badge-warning',
  '$$$+': 'badge-error',
}

const monthNames = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

export function getModelCategory(model: Model): ModelCategory {
  if (model.research) {
    return 'research'
  }

  if (isImageGenerationModel(model)) {
    return 'image-generation'
  }

  return 'chat'
}

export function getPriceTierClass(tier: ModelPriceTier): string {
  return priceTierClasses[tier] ?? 'badge-success'
}

export function hasImageGenerationCapability(model: Model): boolean {
  return model.tools.includes('image_generation')
    || isImageGenerationModel(model)
}

export function getModelPriceTip(model: Model): string | undefined {
  if (model.research) {
    return `${model.research.costEstimate} · ${model.research.timeEstimate}`
  }

  if (model.price.display) {
    return model.price.display
  }

  if (!model.price.output) {
    return model.price.input || undefined
  }

  return `${model.price.input} / ${model.price.output}`
}

/**
 * `gpt-image-2` genuinely reports zero context and zero max output upstream,
 * so callers use the empty string to drop the row instead of printing "0".
 * Named apart from `formatTokenCount` in `shared/utils/message-format.ts`,
 * which auto-import would otherwise shadow.
 */
export function formatModelTokenLimit(count: number): string {
  if (!count) {
    return ''
  }

  return `${count.toLocaleString('en-US')} tokens`
}

/**
 * Gateways quote prices PER TOKEN as decimal strings, while the curated
 * catalog quotes per million. The explicit scale-up here is what makes the
 * two comparable; the resulting float noise (2.5e-6 * 1e6 lands on
 * 2.4999999999999996) is absorbed by fixed-fraction formatting, never by
 * stringifying the product.
 */
function formatPricePerMillionTokens(perTokenPrice: string): string | null {
  const perToken = Number(perTokenPrice)

  if (!Number.isFinite(perToken) || perToken < 0) {
    return null
  }

  const perMillion = perToken * 1_000_000
  const fractionDigits = perMillion > 0 && perMillion < 1 ? 3 : 2

  return `$${perMillion.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`
}

function toPricePair(
  pricing: GatewayModel['pricing'],
): { input: string, output: string, isFree: boolean } | null {
  if (!pricing) {
    return null
  }

  const input = formatPricePerMillionTokens(pricing.input)
  const output = formatPricePerMillionTokens(pricing.output)

  if (!input || !output) {
    return null
  }

  return {
    input,
    output,
    isFree: Number(pricing.input) === 0 && Number(pricing.output) === 0,
  }
}

/**
 * Deliberately spells out the "per 1M" unit instead of reusing the curated
 * catalog's `$`/`$$`/`$$$` tier badge — gateway catalogs carry no tier, and a
 * lookalike badge would imply a comparability that does not exist.
 */
export function formatGatewayPrice(
  pricing: GatewayModel['pricing'],
): string | undefined {
  const pair = toPricePair(pricing)

  if (!pair) {
    return undefined
  }

  if (pair.isFree) {
    return 'Free'
  }

  return `${pair.input}/${pair.output} per 1M`
}

export function formatGatewayPriceDetail(
  pricing: GatewayModel['pricing'],
): string | undefined {
  const pair = toPricePair(pricing)

  if (!pair) {
    return undefined
  }

  if (pair.isFree) {
    return 'Free'
  }

  return `${pair.input} in / ${pair.output} out per 1M tokens`
}

/**
 * Formats an ISO date without `Date`, whose local-timezone parsing shifts
 * `2026-05-01` into April for every negative UTC offset.
 */
export function formatReleaseDate(isoDate: string): string {
  const [year, month] = isoDate.split('-')
  const monthName = monthNames[Number(month) - 1]

  if (!year || !monthName) {
    return isoDate
  }

  return `${monthName} ${year}`
}
