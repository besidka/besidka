import { createError } from 'evlog'
import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { Tools } from '#shared/types/chats.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type { FormattedTools } from '~~/server/types/tools.d'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { createMoonshotAI } from '@ai-sdk/moonshotai'
import { getMoonshotWebSearchTools } from './moonshotai-web-search'
import {
  resolveReasoningLevelForModel,
  toReasoningEffort,
} from './reasoning'

const LEVELS_MODEL_TITLE_REASONING = 'low'

export async function useMoonshotAi(
  userId: string,
  model: string,
  requestedTools: Tools,
  requestedReasoning: ReasoningLevel,
  logger?: LoggerLike,
) {
  const data = await useDb().query.keys.findFirst({
    where: {
      userId: parseInt(userId),
      provider: 'moonshotai',
    },
    columns: {
      apiKey: true,
    },
  })

  if (!data?.apiKey) {
    throw createError({
      message: 'Moonshot AI API key not found. Please set it up in the settings.',
      status: 401,
    })
  }

  const apiKey = await useDecryptText(data.apiKey)
  const moonshotai = createMoonshotAI({ apiKey })
  const { model: modelData } = getModel(model)

  if (!modelData) {
    throw createError({
      message: 'Unsupported model.',
      status: 400,
    })
  }

  const controllerModelId = getControllerModelId(modelData)
  const isLevelsCapability = modelData.reasoning?.mode === 'levels'

  function getInstance() {
    return moonshotai(controllerModelId)
  }

  async function generateChatTitle(message: string) {
    if (isLevelsCapability) {
      return await useChatTitle(
        getInstance(),
        message,
        undefined,
        LEVELS_MODEL_TITLE_REASONING,
      )
    }

    return await useChatTitle(
      getInstance(),
      message,
    )
  }

  async function getTools(): Promise<FormattedTools> {
    if (!requestedTools.includes('web_search')) {
      return {}
    }

    return await getMoonshotWebSearchTools(apiKey, logger)
  }

  const reasoningLevel = resolveReasoningLevelForModel(
    modelData,
    requestedReasoning,
  )
  const isToggleCapability = modelData.reasoning?.mode === 'toggle'

  /**
   * kimi-k2.6 is curated with a toggle and gets its `thinking` param set
   * explicitly here: Moonshot's API rejects a request that sends `thinking`
   * together with `reasoning_effort`, which the installed provider would
   * otherwise derive from the top-level `reasoning` option. kimi-k3 is
   * curated with levels low/high and cannot be disabled; it is driven by the
   * top-level `reasoning` option, which the installed provider maps to
   * `reasoning_effort` for that model only (Moonshot accepts low/high/max
   * with max as its default; Besidka caps at high) and never sends
   * `thinking` for it. The kimi-k2.7-code variants always reason and accept
   * no effort field, so they send neither.
   */
  function getProviderOptions(): SharedV2ProviderOptions {
    if (!isToggleCapability) {
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
    tools: await getTools(),
    providerOptions: getProviderOptions(),
    reasoning: isToggleCapability
      ? undefined
      : toReasoningEffort(reasoningLevel),
  }
}
