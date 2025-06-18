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

  if (!keys?.apiKey || !keys.projectId) {
    throw createError({
      statusCode: 401,
      statusMessage: 'OpenAI keys not found. Please set it up in the settings.',
    })
  }

  const openai = createOpenAI({
    apiKey: await useDecryptText(keys.apiKey),
    project: await useDecryptText(keys.projectId),
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
