import type { LanguageModel } from 'ai'
import { getProviderResearch } from '#shared/utils/research'
import { useLogger, createError } from 'evlog'
import { mapResearchProviderError } from '~~/server/utils/chats/errors'
import { useChatProvider } from '~~/server/utils/chats/provider'
import { buildResearchAssistModelInstance } from '~~/server/utils/research/assist-model'
import { generateResearchClarifications } from '~~/server/utils/research/clarify'

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
  const { provider } = useChatProvider(body.data.model)
  const research = getProviderResearch(provider)
  const supportedProviderId = provider.id === 'openai' || provider.id === 'google'
    ? provider.id
    : undefined

  if (!research || !supportedProviderId) {
    throw createError({
      message: 'This model does not support deep research.',
      status: 400,
      why: 'The selected model provider has no deep research capability.',
      fix: 'Select a model from a provider that supports deep research.',
    })
  }

  logger.set({
    userId,
    providerId: provider.id,
    model: body.data.model,
    operation: 'research-clarify',
  })

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
