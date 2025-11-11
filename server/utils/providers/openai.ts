import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { Tools } from '#shared/types/chats.d'
import type { FormattedTools } from '~~/server/types/tools.d'
import { createOpenAI } from '@ai-sdk/openai'

export async function useOpenAI(
  userId: string,
  model: string,
  requestedTools: Tools,
  requestedReasoning?: boolean,
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
    return openai.responses(model)
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

      result.tools['web_search_preview'] = openai.tools.webSearch({})

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
       * https://ai-sdk.dev/providers/ai-sdk-providers/openai#reasoning
       * https://platform.openai.com/docs/guides/reasoning
       */
      Object.assign(result, {
        // @TODO: implement reasoning options when available
        // when not provided, it takes default model behavior
        // medium for most models, high for advanced models
        // https://platform.openai.com/docs/models/gpt-5-pro
        //
        // Meanwhile, it must be explicitly set with a value,
        // because GPT-5 returns empty text for reasoning part
        // https://github.com/vercel/ai/issues/8048
        reasoningEffort: 'medium',
        reasoningSummary: 'detailed',
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
