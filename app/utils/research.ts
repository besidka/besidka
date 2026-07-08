import type { UIMessage } from 'ai'
import type { Provider } from '#shared/types/providers.d'
import type {
  ProviderResearchCapability,
  ResearchLevel,
  ResearchLevelConfig,
  ResearchProviderId,
} from '#shared/types/research.d'

export interface ResearchLevelEntry {
  level: ResearchLevel
  config: ResearchLevelConfig
}

export function getResearchLevelEntries(
  capability: ProviderResearchCapability | null,
): ResearchLevelEntry[] {
  if (!capability) {
    return []
  }

  return researchLevels.map((level) => {
    return {
      level,
      config: capability.levels[level],
    }
  })
}

export function getResearchProviderConfig(
  providerId: ResearchProviderId,
  level: ResearchLevel,
): ResearchLevelConfig | null {
  const { providers } = getProviders()
  const provider = providers.find((candidate: Provider) => {
    return candidate.id === providerId
  })

  return getProviderResearch(provider ?? null)?.levels[level] ?? null
}

export function formatResearchElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function hasResearchMetaPart(
  message: Pick<UIMessage, 'parts'>,
): boolean {
  return message.parts.some((part) => {
    return part.type === 'data-research'
  })
}
