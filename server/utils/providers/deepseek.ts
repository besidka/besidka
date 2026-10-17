import { createError } from 'evlog'
import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { Tools } from '#shared/types/chats.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type { FormattedTools } from '~~/server/types/tools.d'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { getDeepSeekWebSearchTools } from '~~/server/utils/providers/deepseek-web-search'
import {
  resolveReasoningLevelForModel,
  toReasoningEffort,
} from './reasoning'

export async function useDeepSeek(
  userId: string,
  model: string,
  requestedTools: Tools,
  requestedReasoning: ReasoningLevel,
  logger?: LoggerLike,
) {
  const data = await useDb().query.keys.findFirst({
    where: {
      userId: parseInt(userId),
      provider: 'deepseek',
    },
    columns: {
      apiKey: true,
    },
  })

  if (!data?.apiKey) {
    throw createError({
      message: 'DeepSeek API key not found. Please set it up in the settings.',
      status: 401,
    })
  }

  const apiKey = await useDecryptText(data.apiKey)
  const deepseek = createDeepSeek({ apiKey })
  const { model: modelData } = getModel(model)

  if (!modelData) {
    throw createError({
      message: 'Unsupported model.',
      status: 400,
    })
  }

  const controllerModelId = getControllerModelId(modelData)

  function getInstance() {
    return deepseek(controllerModelId)
  }

  async function generateChatTitle(message: string) {
    return await useChatTitle(
      getInstance(),
      message,
    )
  }

  function getTools(): FormattedTools {
    if (
      !requestedTools.includes('web_search')
      || !modelData?.tools.includes('web_search')
    ) {
      return {}
    }

    return getDeepSeekWebSearchTools(apiKey, undefined, logger)
  }

  const reasoningLevel = resolveReasoningLevelForModel(
    modelData,
    requestedReasoning,
  )
  const hasReasoningCapability = !!modelData.reasoning

  /**
   * `thinking` is sent explicitly for every reasoning model, including `off`:
   * the installed provider treats V4 models as thinking-enabled whenever no
   * explicit `thinking` is sent, so leaving it out for `off` would keep
   * thinking on. The top-level `reasoning` option carries the effort: the
   * provider maps low to low, high to high and medium to high (DeepSeek
   * documents low and high, with max left unused here), and omits
   * `reasoning_effort` when thinking is disabled.
   * @see https://api-docs.deepseek.com/guides/reasoning_model
   */
  function getProviderOptions(): SharedV2ProviderOptions {
    if (!hasReasoningCapability) {
      return {}
    }

    return {
      thinking: {
        type: reasoningLevel === 'off' ? 'disabled' : 'enabled',
      },
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
