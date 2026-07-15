import type { Model } from '#shared/types/providers.d'
import type {
  ModelResearchConfig,
  ResearchLevel,
} from '#shared/types/research.d'

export const researchLevels: ResearchLevel[] = ['quick', 'thorough']

export function isResearchLevel(value: string): value is ResearchLevel {
  return researchLevels.includes(value as ResearchLevel)
}

export function getModelResearch(
  model: Model | null | undefined,
): ModelResearchConfig | null {
  return model?.research ?? null
}

export function isDeepResearchModel(
  model: Model | null | undefined,
): boolean {
  return !!getModelResearch(model)
}
