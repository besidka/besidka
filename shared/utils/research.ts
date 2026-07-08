import type { Provider } from '#shared/types/providers.d'
import type {
  ProviderResearchCapability,
  ResearchLevel,
  ResearchLevelConfig,
  ResearchLevelSetting,
} from '#shared/types/research.d'

export const researchLevels: ResearchLevel[] = ['quick', 'thorough']

export function isResearchLevel(value: string): value is ResearchLevel {
  return researchLevels.includes(value as ResearchLevel)
}

export function isDeepResearchActive(
  setting: ResearchLevelSetting,
): setting is ResearchLevel {
  return setting !== 'off' && isResearchLevel(setting)
}

export function normalizeResearchLevelSetting(
  value: string | null | undefined,
): ResearchLevelSetting {
  if (!value || value === 'off') {
    return 'off'
  }

  return isResearchLevel(value) ? value : 'off'
}

export function getProviderResearch(
  provider: Provider | null | undefined,
): ProviderResearchCapability | null {
  return provider?.research ?? null
}

export function resolveResearchModel(
  provider: Provider | null | undefined,
  level: ResearchLevelSetting,
): ResearchLevelConfig | null {
  const research = getProviderResearch(provider)

  if (!research || !isDeepResearchActive(level)) {
    return null
  }

  return research.levels[level] ?? null
}
