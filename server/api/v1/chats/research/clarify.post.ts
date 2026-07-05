import type { LanguageModel } from 'ai'
import { useLogger, createError } from 'evlog'
import { normalizeChatError } from '~~/server/utils/chats/errors'
import { generateResearchClarifications } from '~~/server/utils/chats/deep-research'

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
  const supportedProviderId = provider.id === 'openai'
    || provider.id === 'google'
    ? provider.id
    : undefined

  logger.set({
    userId,
    modelId: model.id,
    providerId: provider.id,
    operation: 'research-clarify',
  })

  if (!model.tools.includes('deep_research')) {
    throw createError({
      message: 'This model does not support deep research.',
      status: 400,
      why: 'The selected model has no deep research capability.',
      fix: 'Select a model that supports deep research and try again.',
    })
  }

  try {
    let instance: LanguageModel

    switch (provider.id) {
      case 'openai': {
        const { instance: openAiInstance } = await useOpenAI(
          session.user.id,
          model.id,
          ['deep_research'],
          'off',
          'standard',
        )

        instance = openAiInstance

        break
      }
      case 'google': {
        const { instance: googleInstance } = await useGoogle(
          session.user.id,
          model.id,
          ['deep_research'],
          'off',
          'standard',
        )

        instance = googleInstance

        break
      }
      default:
        throw createError({
          message: 'Unsupported provider',
          status: 400,
        })
    }

    const clarifications = await generateResearchClarifications({
      instance,
      topic: body.data.topic,
    })

    logger.set({ questionsCount: clarifications.questions.length })

    return clarifications
  } catch (exception) {
    let chatError = normalizeChatError({
      error: exception,
      event,
      providerId: supportedProviderId,
    })

    if (chatError.code === 'unknown') {
      chatError = normalizeChatError({
        error: exception,
        event,
        providerId: supportedProviderId,
        code: 'clarification-failed',
        message: 'Could not prepare research questions.',
      })
    }

    logger.set({
      message: chatError.message,
      stage: 'generate-clarifications',
      errorCode: chatError.code,
      providerStatus: chatError.status,
      providerRequestId: chatError.providerRequestId,
      errorMessage: chatError.why,
    })

    throw createError({
      message: chatError.message,
      status: chatError.status || 500,
      why: chatError.why,
      fix: chatError.fix,
    })
  }
})
