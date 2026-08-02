import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { Tools } from '#shared/types/chats.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type { FormattedTools } from '~~/server/types/tools.d'
import { createAnthropic } from '@ai-sdk/anthropic'
import {
  resolveReasoningLevelForModel,
  toReasoningEffort,
} from './reasoning'

export async function useAnthropic(
  userId: string,
  model: string,
  requestedTools: Tools,
  requestedReasoning: ReasoningLevel,
) {
  const data = await useDb().query.keys.findFirst({
    where: {
      userId: parseInt(userId),
      provider: 'anthropic',
    },
    columns: {
      apiKey: true,
    },
  })

  if (!data?.apiKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Anthropic API key not found. Please set it up in the settings.',
    })
  }

  const anthropic = createAnthropic({
    apiKey: await useDecryptText(data.apiKey),
  })
  const { model: modelData } = getModel(model)

  if (!modelData) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unsupported model.',
    })
  }

  const controllerModelId = getControllerModelId(modelData)

  function getInstance() {
    return anthropic(controllerModelId)
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

      result.tools['web_search_preview'] = anthropic.tools.webSearch_20250305({})

      result.toolChoice = {
        type: 'tool',
        toolName: 'web_search_preview',
      }
    }

    return result
  }

  const reasoningLevel = resolveReasoningLevelForModel(
    modelData,
    requestedReasoning,
  )

  /**
   * Deliberately empty. Unlike OpenAI and Google, the Anthropic provider
   * derives `thinking`/`effort` (or `thinking.budgetTokens` for models
   * without adaptive thinking) itself from the top-level `reasoning`
   * option, and explicit providerOptions take precedence over that
   * derived value. Writing a `thinking` or `effort` block here would
   * clobber the SDK's per-model mapping rather than add to it.
   */
  function getProviderOptions(): SharedV2ProviderOptions {
    return {}
  }

  return {
    instance: getInstance(),
    generateChatTitle,
    tools: getTools(),
    providerOptions: getProviderOptions(),
    reasoning: toReasoningEffort(reasoningLevel),
  }
}
