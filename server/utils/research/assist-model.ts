import type { LanguageModel } from 'ai'
import type { ResearchProviderId } from '#shared/types/research.d'
import { useGoogle } from '~~/server/utils/providers/google'
import { useOpenAI } from '~~/server/utils/providers/openai'

export async function buildResearchAssistModelInstance(
  userId: number,
  providerId: ResearchProviderId,
  assistModel: string,
): Promise<LanguageModel> {
  if (providerId === 'openai') {
    const { instance } = await useOpenAI(
      userId.toString(),
      assistModel,
      [],
      'off',
    )

    return instance
  }

  const { instance } = await useGoogle(
    userId.toString(),
    assistModel,
    [],
    'off',
  )

  return instance
}
