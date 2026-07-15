import type { ResearchProviderId } from '#shared/types/research.d'
import { googleResearchAdapter } from '~~/server/utils/research/adapters/google'
import { openAiResearchAdapter } from '~~/server/utils/research/adapters/openai'
import type { ResearchAdapter } from '~~/server/utils/research/types.d'

export function getResearchAdapter(
  provider: ResearchProviderId,
): ResearchAdapter {
  return provider === 'openai' ? openAiResearchAdapter : googleResearchAdapter
}
