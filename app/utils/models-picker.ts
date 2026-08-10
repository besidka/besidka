import type { Model, ModelPriceTier } from '#shared/types/providers.d'
import type {
  ModelCategory,
  ModelCategoryOption,
} from '~/types/models-picker'

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

/**
 * Vision covers image/video/PDF *input*, fully separate from image
 * *generation* above — a model can have either, both, or neither.
 */
export function hasVisionCapability(model: Model): boolean {
  return model.modalities.input.includes('image')
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
 * an uncapped count would grow the badge wider than the button it hangs off.
 */
export function formatRailCount(count: number): string {
  return count > 99 ? '99+' : `${count}`
}

/**
 * Spells the badge out for the tooltip and the accessible name, where the
 * bare number has no unit to lean on.
 */
export function formatModelCount(count: number): string {
  return `${count} ${count === 1 ? 'model' : 'models'}`
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
