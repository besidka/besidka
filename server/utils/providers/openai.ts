import { createOpenAI } from '@ai-sdk/openai'

export async function useOpenAI(
  userId: string,
  model: string,
) {
  const keys = await useDb().query.keys.findFirst({
    where(keys, { and, eq }) {
      return and(
        eq(keys.userId, parseInt(userId)),
        eq(keys.provider, 'openai'),
      )
    },
    columns: {
      apiKey: true,
      projectId: true,
    },
  })

  if (!keys) {
    throw createError({
      statusCode: 401,
      statusMessage: 'OpenAI key not found.',
    })
  }

  const openai = createOpenAI({
    apiKey: keys.apiKey,
    project: keys.projectId,
  })

  function getInstance() {
    return openai(model)
  }

  async function generateChatTitle(message: string) {
    return await useChatTitle(
      getInstance(),
      message,
    )
  }

  return {
    instance: getInstance(),
    generateChatTitle,
  }
}
