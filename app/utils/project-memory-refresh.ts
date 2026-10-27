export interface ProjectMemoryRefreshFailureInput {
  status?: number
  message?: string
  why?: string
}

export interface ProjectMemoryRefreshFailure {
  isCooldown: boolean
  title: string
  description?: string
}

const COOLDOWN_STATUS = 429
const COOLDOWN_TITLE = 'Memory was refreshed a moment ago'
const COOLDOWN_DESCRIPTION = 'Try again in a minute.'
const FALLBACK_TITLE = 'Failed to refresh project memory'

export function describeProjectMemoryRefreshFailure(
  parsedException: ProjectMemoryRefreshFailureInput,
): ProjectMemoryRefreshFailure {
  if (parsedException.status === COOLDOWN_STATUS) {
    return {
      isCooldown: true,
      title: COOLDOWN_TITLE,
      description: COOLDOWN_DESCRIPTION,
    }
  }

  return {
    isCooldown: false,
    title: parsedException.message || FALLBACK_TITLE,
    description: parsedException.why,
  }
}
