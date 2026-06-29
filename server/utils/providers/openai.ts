import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { Tools } from '#shared/types/chats.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type { FormattedTools } from '~~/server/types/tools.d'
import { createOpenAI } from '@ai-sdk/openai'
import {
  resolveReasoningLevelForModel,
  toReasoningEffort,
} from './reasoning'

export async function useOpenAI(
  userId: string,
  model: string,
  requestedTools: Tools,
  requestedReasoning: ReasoningLevel,
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

  const { model: modelData } = getModel(model)
  const reasoningLevel = resolveReasoningLevelForModel(
    modelData,
    requestedReasoning,
  )

  function getProviderOptions(): SharedV2ProviderOptions {
    const result: SharedV2ProviderOptions = {}

    if (reasoningLevel !== 'off') {
      /**
       * Reasoning effort is set provider-agnostically via the top-level
       * `reasoning` option on streamText (AI SDK v7). providerOptions only
       * carries the output flag, because the SDK never enables reasoning
       * summaries on its own.
       * @see https://ai-sdk.dev/providers/ai-sdk-providers/openai#reasoning
       */
      Object.assign(result, {
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
    reasoning: toReasoningEffort(reasoningLevel),
  }
}
