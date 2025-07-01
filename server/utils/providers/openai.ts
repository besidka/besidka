import { createOpenAI } from '@ai-sdk/openai'

export async function useOpenAI(
  userId: string,
  model: string,
) {
  const data = await useDb().query.keys.findFirst({
    where(keys, { and, eq }) {
      return and(
        eq(keys.userId, parseInt(userId)),
        eq(keys.provider, 'openai'),
      )
    },
    columns: {
      apiKey: true,
    },
  })

  if (!data?.apiKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'OpenAI API key not found. Please set it up in the settings.',
    })
  }

  const openai = createOpenAI({
    apiKey: await useDecryptText(data.apiKey),
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
