import { createGoogleGenerativeAI } from '@ai-sdk/google'

export async function useGoogle(
  userId: string,
  model: string,
) {
  const keys = await useDb().query.keys.findFirst({
    where(keys, { and, eq }) {
      return and(
        eq(keys.userId, parseInt(userId)),
        eq(keys.provider, 'google'),
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
      statusMessage: 'Google key not found.',
    })
  }

  const google = createGoogleGenerativeAI({
    apiKey: keys.apiKey,
  })

  function getInstance() {
    return google(model)
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
