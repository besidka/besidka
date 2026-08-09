import type { GatewayModel } from '#shared/types/gateways.d'
import type { Model, ModelPriceTier } from '#shared/types/providers.d'
import type {
  GatewayProviderGroup,
  ModelCategory,
  ModelCategoryOption,
} from '~/types/models-picker'
import { getGatewayModelProviderPrefix } from '#shared/utils/gateway-model-id'

export const modelCategoryOptions: ModelCategoryOption[] = [
  { value: 'chat', label: 'Chat', icon: 'lucide:message-square' },
  { value: 'research', label: 'Deep research', icon: 'lucide:telescope' },
  {
    value: 'image-generation',
    label: 'Image generation',
    icon: 'lucide:image-plus',
  },
]

/**
 * Gateway catalogs carry none of the curated `chat`/`research`/
 * `image-generation` classification, so gateway mode filters on the one
 * objective property every catalog does report — price.
 */
export const gatewayModelCategoryOptions: ModelCategoryOption[] = [
  { value: 'free', label: 'Free', icon: 'lucide:banknote-x' },
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
 * The only place a gateway model's per-token numbers are spelled out. Rows
 * carry the same `$`/`$$`/`$$$` tier badge direct-provider models do, resolved
 * through `resolveGatewayPriceTier()` against the shared ceilings in
 * `providers/merge.ts`, and reach this string only as the badge's tooltip.
 */
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
 * What a rail count badge claims to describe: the models the picker will
 * actually list for that provider. Deprecated entries live behind the
 * collapsed legacy section and cannot be selected, so counting them would
 * promise rows the user never reaches.
 */
export function countSelectableModels(models: Model[]): number {
  return models.filter((model) => {
    return model.status !== 'deprecated'
  }).length
}

/**
 * Keeps a rail badge to three glyphs. A vertical rail is one icon wide, and
 * an uncapped count from a gateway with hundreds of models per vendor would
 * grow the badge wider than the button it hangs off.
 */
export function formatRailCount(count: number): string {
  return count > 99 ? '99+' : `${count}`
}

/**
 * Spells the badge out for the tooltip and the accessible name, where the
 * bare number has no unit to lean on. Most of OpenRouter's 58 vendor
 * prefixes carry a single model, so the singular is the common case.
 */
export function formatModelCount(count: number): string {
  return `${count} ${count === 1 ? 'model' : 'models'}`
}

/**
 * The underlying providers a gateway catalog proxies, most-stocked first so
 * the handful worth browsing lead the strip and the long tail (OpenRouter
 * reports 58 prefixes across 400 models, most of them one-model vendors)
 * trails it. Ties break alphabetically to keep the order stable across
 * catalog refreshes.
 */
export function getGatewayProviderGroups(
  models: GatewayModel[],
): GatewayProviderGroup[] {
  const counts = new Map<string, number>()

  models.forEach((model) => {
    const prefix = getGatewayModelProviderPrefix(model.id)

    counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
  })

  return [...counts.entries()]
    .map(([prefix, count]) => {
      return { prefix, count }
    })
    .sort((first, second) => {
      return second.count - first.count
        || first.prefix.localeCompare(second.prefix)
    })
}

/**
 * Clusters a gateway catalog by underlying provider in the same order
 * `getGatewayProviderGroups()` reports, then by model name inside each
 * cluster. Returns a new array — the catalog itself is shared state read
 * from the composable cache and must not be sorted in place.
 */
export function sortGatewayModelsByProvider(
  models: GatewayModel[],
  groups: GatewayProviderGroup[] = getGatewayProviderGroups(models),
): GatewayModel[] {
  const groupOrder = new Map(groups.map((group, index) => {
    return [group.prefix, index]
  }))

  return [...models].sort((first, second) => {
    const firstPrefix = getGatewayModelProviderPrefix(first.id)
    const secondPrefix = getGatewayModelProviderPrefix(second.id)
    const orderDifference = (groupOrder.get(firstPrefix) ?? Number.MAX_VALUE)
      - (groupOrder.get(secondPrefix) ?? Number.MAX_VALUE)

    return orderDifference || first.name.localeCompare(second.name)
  })
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
