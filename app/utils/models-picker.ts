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

interface PriceTierClasses {
  badge: string
  tooltip: string
}

const priceTierClasses: Record<ModelPriceTier, PriceTierClasses> = {
  '$': { badge: 'badge-success', tooltip: 'tooltip-success' },
  '$$': { badge: 'badge-info', tooltip: 'tooltip-info' },
  '$$$': { badge: 'badge-warning', tooltip: 'tooltip-warning' },
  '$$$+': { badge: 'badge-error', tooltip: 'tooltip-error' },
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
  return priceTierClasses[tier]?.badge ?? 'badge-success'
}

export function getPriceTierTooltipClass(tier: ModelPriceTier): string {
  return priceTierClasses[tier]?.tooltip ?? 'tooltip-success'
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
