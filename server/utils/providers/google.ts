import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { Tools } from '#shared/types/chats.d'
import type { FormattedTools } from '~~/server/types/tools.d'
import { createGoogleGenerativeAI } from '@ai-sdk/google'

export async function useGoogle(
  userId: string,
  model: string,
  requestedTools: Tools,
  requestedReasoning?: boolean,
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

  function getTools(): FormattedTools {
    if (!requestedTools?.length) {
      return {}
    }

    const result: FormattedTools = {}

    if (requestedTools.includes('web_search')) {
      if (!result.tools) {
        result.tools = {}
      }

      result.tools['web_search_preview'] = google.tools.googleSearch({})
      result.toolChoice = {
        type: 'tool',
        toolName: 'web_search_preview',
      }
    }

    return result
  }

  function getProviderOptions(): SharedV2ProviderOptions {
    const result: SharedV2ProviderOptions = {}

    const { model: modelData } = getModel(model)

    if (requestedReasoning && modelData?.reasoning) {
      /**
       * @example
       * https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai#thinking
       * https://ai.google.dev/gemini-api/docs/thinking
       */
      Object.assign(result, {
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: -1,
        },
      })
    }

    return result
  }

  return {
    instance: getInstance(),
    generateChatTitle,
    tools: getTools(),
    providerOptions: getProviderOptions(),
  }
}
