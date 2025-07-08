import type { ProviderOptions } from 'ai'
import type { Tools } from '#shared/types/chats.d'
import { createGoogleGenerativeAI } from '@ai-sdk/google'

export async function useGoogle(
  userId: string,
  model: string,
  requestedTools: Tools,
) {
  const data = await useDb().query.keys.findFirst({
    where(keys, { and, eq }) {
      return and(
        eq(keys.userId, parseInt(userId)),
        eq(keys.provider, 'google'),
      )
    },
    columns: {
      apiKey: true,
    },
  })

  if (!data) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Google key not found. Please set it up in the settings.',
    })
  }

  const google = createGoogleGenerativeAI({
    apiKey: await useDecryptText(data.apiKey),
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

  function getProviderOptions(): ProviderOptions {
    if (!requestedTools?.length) {
      return {}
    }

    const result: ProviderOptions = {}

    if (requestedTools.includes('web_search')) {
      result.google = {
        useSearchGrounding: true,
      }
    }

    return result
  }

  return {
    instance: getInstance(),
    generateChatTitle,
    providerOptions: getProviderOptions(),
  }
}
