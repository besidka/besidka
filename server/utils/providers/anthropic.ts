import { createError } from 'evlog'
import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { Tools } from '#shared/types/chats.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type { FormattedTools } from '~~/server/types/tools.d'
import { createAnthropic } from '@ai-sdk/anthropic'
import {
  resolveReasoningLevelForModel,
  toReasoningEffort,
} from './reasoning'

export const ANTHROPIC_AUTOMATIC_CACHE_CONTROL = {
  type: 'ephemeral',
} as const

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
      message: 'Anthropic API key not found. Please set it up in the settings.',
      status: 401,
    })
  }

  const anthropic = createAnthropic({
    apiKey: await useDecryptText(data.apiKey),
  })
  const { model: modelData } = getModel(model)

  if (!modelData) {
    throw createError({
      message: 'Unsupported model.',
      status: 400,
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

  /**
   * Never forces tool_choice, so the provider default `auto` applies.
   * Thinking-enabled requests reject forced tool use, and the Claude 5.5
   * generation rejects forced tool use outright (HTTP 400).
   */
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
    }

    return result
  }

  const reasoningLevel = resolveReasoningLevelForModel(
    modelData,
    requestedReasoning,
  )

  /**
   * Enables Anthropic's automatic prompt caching through one top-level
   * `cache_control` marker, which the API keeps on the last cacheable block
   * as the conversation grows. Unlike OpenAI and Google, the Anthropic
   * provider derives `thinking`/`effort` (or `thinking.budgetTokens` for
   * models without adaptive thinking) itself from the top-level `reasoning`
   * option, and explicit providerOptions take precedence over that derived
   * value, so a `thinking` or `effort` block must NOT be written here.
   */
  function getProviderOptions(): SharedV2ProviderOptions {
    return {
      cacheControl: ANTHROPIC_AUTOMATIC_CACHE_CONTROL,
    }
  }

  return {
    instance: getInstance(),
    generateChatTitle,
    tools: getTools(),
    providerOptions: getProviderOptions(),
    reasoning: toReasoningEffort(reasoningLevel),
  }
}
