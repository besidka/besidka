import type { LanguageModel } from 'ai'
import type { ResearchClarificationResponse } from '#shared/types/research.d'
import { getModelResearch } from '#shared/utils/research'
import { useLogger, createError } from 'evlog'
import { mapResearchProviderError } from '~~/server/utils/chats/errors'
import { useChatProvider } from '~~/server/utils/chats/provider'
import { buildResearchAssistModelInstance } from '~~/server/utils/research/assist-model'
import { generateResearchClarifications } from '~~/server/utils/research/clarify'

const MOCK_RESEARCH_CLARIFICATIONS: ResearchClarificationResponse = {
  questions: [
    {
      id: 'mock-scope',
      question: 'How deep should the mock report go?',
      kind: 'choice',
      options: ['Quick overview', 'Standard depth', 'Exhaustive'],
    },
    {
      id: 'mock-focus',
      question: 'Any specific angle to emphasize? (optional)',
      kind: 'text',
      placeholder: 'e.g. cost, performance, adoption',
    },
  ],
}

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)
  const body = await readValidatedBody(event, z.object({
    model: z.string().nonempty(),
    topic: z.string().min(1).max(2000),
  }).safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)
  const { provider, model } = useChatProvider(body.data.model)
  const research = getModelResearch(model)
  const supportedProviderId = provider.id === 'openai' || provider.id === 'google'
    ? provider.id
    : undefined

  if (!research || !supportedProviderId) {
    throw createError({
      message: 'This model does not support deep research.',
      status: 400,
      why: 'The selected model has no deep research capability.',
      fix: 'Select one of the dedicated deep research models.',
    })
  }

  logger.set({
    userId,
    providerId: provider.id,
    model: body.data.model,
    operation: 'research-clarify',
  })

  const runtimeConfig = useRuntimeConfig()
  const useMock = runtimeConfig.researchMockEnabled
    && body.data.topic.trim().toLowerCase().startsWith('mock:')

  if (useMock) {
    logger.set({
      questionsCount: MOCK_RESEARCH_CLARIFICATIONS.questions.length,
    })

    return MOCK_RESEARCH_CLARIFICATIONS
  }

  try {
    const instance: LanguageModel = await buildResearchAssistModelInstance(
      userId,
      supportedProviderId,
      research.assistModel,
    )
    const clarifications = await generateResearchClarifications({
      instance,
      topic: body.data.topic,
    })

    logger.set({ questionsCount: clarifications.questions.length })

    return clarifications
  } catch (exception) {
    const chatError = mapResearchProviderError({
      error: exception,
      providerId: supportedProviderId,
      event,
      code: 'clarification-failed',
      message: 'Could not prepare research questions.',
    })

    logger.set({
      stage: 'generate-clarifications',
      errorCode: chatError.code,
      providerStatus: chatError.status,
      providerRequestId: chatError.providerRequestId,
    })

    throw createError({ ...chatError })
  }
})
