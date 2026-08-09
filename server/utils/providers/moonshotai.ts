import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { Tools } from '#shared/types/chats.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type { FormattedTools } from '~~/server/types/tools.d'
import { createMoonshotAI } from '@ai-sdk/moonshotai'
import { resolveReasoningLevelForModel } from './reasoning'

export async function useMoonshotAi(
  userId: string,
  model: string,
  requestedTools: Tools,
  requestedReasoning: ReasoningLevel,
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
      statusCode: 401,
      statusMessage: 'Moonshot AI API key not found. Please set it up in the settings.',
    })
  }

  const moonshotai = createMoonshotAI({
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
    return moonshotai(controllerModelId)
  }

  async function generateChatTitle(message: string) {
    return await useChatTitle(
      getInstance(),
      message,
    )
  }

  function getTools(): FormattedTools {
    return {}
  }

  const reasoningLevel = resolveReasoningLevelForModel(
    modelData,
    requestedReasoning,
  )
  const isToggleCapability = modelData.reasoning?.mode === 'toggle'

  /**
   * Only kimi-k2.5/kimi-k2.6 are curated with a toggle reasoning
   * capability, and their `thinking` param is set explicitly here rather
   * than through the top-level `reasoning` option: the base
   * openai-compatible model this provider extends auto-derives a
   * `reasoning_effort` field from that option, and Moonshot's API rejects
   * a request that sends `thinking` and `reasoning_effort` together for
   * these models. kimi-k3 is curated without a reasoning capability at
   * all (it dropped `thinking` in favour of a differently-shaped
   * `reasoning_effort` this app's reasoning levels don't cover), so it
   * gets neither field and reasons at the provider's own default.
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
    tools: getTools(),
    providerOptions: getProviderOptions(),
    reasoning: undefined,
  }
}
