import type { ReasoningCapability } from '../shared/types/reasoning.d'
import type { ModelResearchConfig } from '../shared/types/research.d'
import type {
  Model,
  ModelImageGenerationCapability,
  ModelPriceTier,
  ModelTool,
  Provider,
} from '../shared/types/providers.d'

export interface CuratedModelPrice {
  tokens: number
  input?: string
  output?: string
  display?: string
}

export interface CuratedModel {
  id: string
  name?: string
  description?: string
  contextLength?: number
  maxOutputTokens?: number
  price: CuratedModelPrice
  modalities?: Model['modalities']
  tools: ModelTool[]
  default?: boolean
  forProjectMemory?: boolean
  imageGeneration?: ModelImageGenerationCapability
  reasoning?: ReasoningCapability
  research?: ModelResearchConfig
}

export interface CuratedProvider {
  id: string
  name: string
  models: CuratedModel[]
}

export interface ModelSnapshotEntry {
  name: string
  description: string
  releaseDate?: string
  status?: 'deprecated' | 'beta' | 'alpha'
  limit: {
    context: number
    output: number
  }
  modalities: {
    input: string[]
    output: string[]
  }
  cost: {
    input: number
    output: number
  }
  tieredPricing?: boolean
}

export type ModelSnapshot = Record<string, ModelSnapshotEntry>

const highestPriceTier: ModelPriceTier = '$$$+'

const tierCeilingsPerMillionTokens: [number, ModelPriceTier][] = [
  [0.5, '$'],
  [2, '$$'],
  [5, '$$$'],
]

const researchTierCeilingsPerTask: [number, ModelPriceTier][] = [
  [2, '$$'],
  [8, '$$$'],
]

const tierCeilingsPerImage: [number, ModelPriceTier][] = [
  [0.05, '$'],
  [0.1, '$$'],
  [0.25, '$$$'],
]

function resolveTier(
  amount: number,
  ceilings: [number, ModelPriceTier][],
): ModelPriceTier {
  for (const [ceiling, tier] of ceilings) {
    if (amount <= ceiling) {
      return tier
    }
  }

  return highestPriceTier
}

/**
 * Read the upper bound out of a human price string such as `'$3–7 / task'`,
 * `'$0.041–$0.053 / medium image'`, `'~$10 / task'` or `'$0.25'`. Only
 * digits attached to a `$` count, so trailing units ("/ 1K image") never
 * leak into the number. The second bound's `$` is optional so both range
 * spellings (one leading `$`, or one per number) resolve the same way.
 */
export function parseUpperBoundPrice(value: string): number | null {
  const match = value.match(
    /\$\s*(\d+(?:\.\d+)?)(?:\s*[–—-]\s*\$?\s*(\d+(?:\.\d+)?))?/,
  )
  const upperBound = match?.[2] ?? match?.[1]

  if (upperBound === undefined) {
    return null
  }

  return Number(upperBound)
}

/**
 * Render a per-million-token dollar amount for display without losing
 * precision: `parsePrice()` in `server/utils/ai/cost-map.ts` reads these
 * strings back as billing input, so a fixed two-decimal round would
 * silently change costs for models priced at fractions of a cent. The
 * `from` prefix marks context-tiered pricing, where the number is the
 * cheapest tier rather than the only one.
 */
export function formatPrice(amount: number, tiered?: boolean): string {
  const isRoundedToCents = Number.isInteger(amount * 100)
  const formatted = isRoundedToCents ? amount.toFixed(2) : String(amount)

  return tiered ? `from $${formatted}` : `$${formatted}`
}

function resolvePriceTier(
  curated: CuratedModel,
  snapshot: ModelSnapshotEntry | undefined,
): ModelPriceTier {
  if (curated.research) {
    const costPerTask = parseUpperBoundPrice(curated.research.costEstimate)

    if (costPerTask !== null) {
      return resolveTier(costPerTask, researchTierCeilingsPerTask)
    }
  }

  if (curated.imageGeneration) {
    const costPerImage = parseUpperBoundPrice(curated.price.display ?? '')

    if (costPerImage !== null) {
      return resolveTier(costPerImage, tierCeilingsPerImage)
    }
  }

  if (snapshot) {
    return resolveTier(snapshot.cost.input, tierCeilingsPerMillionTokens)
  }

  const curatedInput = parseUpperBoundPrice(curated.price.input ?? '')

  if (curatedInput !== null) {
    return resolveTier(curatedInput, tierCeilingsPerMillionTokens)
  }

  return highestPriceTier
}

/**
 * Optional fields are omitted rather than set to `undefined`: the merged
 * catalog is injected into `runtimeConfig.public`, and Nuxt serializes an
 * `undefined` config value as an empty string — which would make
 * `price.display ?? …` resolve to `''` instead of falling through.
 */
function curatedCapabilities(curated: CuratedModel) {
  return {
    tools: curated.tools,
    ...(curated.default ? { default: curated.default } : {}),
    ...(curated.forProjectMemory
      ? { forProjectMemory: curated.forProjectMemory }
      : {}),
    ...(curated.imageGeneration
      ? { imageGeneration: curated.imageGeneration }
      : {}),
    ...(curated.reasoning ? { reasoning: curated.reasoning } : {}),
    ...(curated.research ? { research: curated.research } : {}),
  }
}

function mergedPrice(
  curated: CuratedModelPrice,
  input: string,
  output: string,
) {
  return {
    tokens: curated.tokens,
    input,
    output,
    ...(curated.display ? { display: curated.display } : {}),
  }
}

function toFullyCuratedModel(curated: CuratedModel): Model {
  const {
    id,
    name,
    description,
    contextLength,
    maxOutputTokens,
    modalities,
  } = curated

  if (
    name === undefined
    || description === undefined
    || contextLength === undefined
    || maxOutputTokens === undefined
    || modalities === undefined
  ) {
    throw new Error(
      `Model "${id}" has no models.dev snapshot entry. Run `
      + '`pnpm run models:fetch`, or curate name, description, '
      + 'contextLength, maxOutputTokens and modalities for it the way '
      + 'EXEMPT_IDS models are curated.',
    )
  }

  return {
    id,
    name,
    description,
    contextLength,
    maxOutputTokens,
    price: mergedPrice(
      curated.price,
      curated.price.input ?? '',
      curated.price.output ?? '',
    ),
    priceTier: resolvePriceTier(curated, undefined),
    modalities,
    ...curatedCapabilities(curated),
  }
}

/**
 * Merge one hand-curated model entry with its `models.dev` snapshot entry
 * into the fully shaped `Model` every consumer reads.
 *
 * Curated wins for product decisions (capabilities, tools, defaults, the
 * structural `price.tokens` divisor, the per-image `price.display` copy) and
 * for research-agent models, whose name, description and price deliberately
 * encode per-task billing that no per-token figure can express. Everything
 * objective — specs, modalities, release date, status, per-token cost —
 * comes from the snapshot, unless a curated `name` is explicitly set, which
 * always wins: it means models.dev's name is worse than the curated one
 * (a placeholder equal to the bare id, a stale alias suffix like
 * `(latest)`), not that the model itself is curated content.
 * A model with no snapshot entry is fully curated by necessity; see
 * `EXEMPT_IDS` in `scripts/fetch-models-metadata.mjs`.
 */
export function mergeModelMetadata(
  curated: CuratedModel,
  snapshot: ModelSnapshotEntry | undefined,
): Model {
  if (!snapshot) {
    return toFullyCuratedModel(curated)
  }

  const keepCuratedPrice = !!curated.research

  return {
    id: curated.id,
    name: curated.name ?? snapshot.name,
    description: curated.research
      ? curated.description ?? snapshot.description
      : snapshot.description,
    contextLength: snapshot.limit.context,
    maxOutputTokens: snapshot.limit.output,
    ...(snapshot.releaseDate ? { releaseDate: snapshot.releaseDate } : {}),
    ...(snapshot.status ? { status: snapshot.status } : {}),
    price: mergedPrice(
      curated.price,
      keepCuratedPrice
        ? curated.price.input ?? ''
        : formatPrice(snapshot.cost.input, snapshot.tieredPricing),
      keepCuratedPrice
        ? curated.price.output ?? ''
        : formatPrice(snapshot.cost.output, snapshot.tieredPricing),
    ),
    priceTier: resolvePriceTier(curated, snapshot),
    modalities: snapshot.modalities,
    ...curatedCapabilities(curated),
  }
}

export function mergeProvider(
  curated: CuratedProvider,
  snapshot: ModelSnapshot,
): Provider {
  return {
    id: curated.id,
    name: curated.name,
    models: curated.models.map((model) => {
      return mergeModelMetadata(model, snapshot[model.id])
    }),
  }
}
