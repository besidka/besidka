import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { Tools } from '#shared/types/chats.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type { FormattedTools } from '~~/server/types/tools.d'
import { createDeepSeek } from '@ai-sdk/deepseek'
import {
  resolveReasoningLevelForModel,
  toReasoningEffort,
} from './reasoning'

export async function useDeepSeek(
  userId: string,
  model: string,
  requestedTools: Tools,
  requestedReasoning: ReasoningLevel,
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
      statusCode: 401,
      statusMessage: 'DeepSeek API key not found. Please set it up in the settings.',
    })
  }

  const deepseek = createDeepSeek({
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
    return deepseek(controllerModelId)
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
   * deepseek-flash and deepseek-v4-pro only expose an on/off `thinking`
   * toggle, not adjustable effort levels. Setting it explicitly here (rather
   * than relying on the top-level `reasoning` option) avoids the shipped
   * provider also auto-deriving a `reasoning_effort` value from that option,
   * which is unverified against either model's live endpoint.
   * The `mode === 'levels'` branch below (the anthropic.ts-style empty
   * providerOptions, letting the shipped provider derive both `thinking` and
   * `reasoning_effort` from the top-level `reasoning` option, matching
   * DeepSeek's own documented usage of the two together) is unreachable for
   * DeepSeek today — no curated DeepSeek model uses levels — but it is kept
   * because it is the generic contract every `use<Provider>()` shares.
   * @see node_modules/@ai-sdk/deepseek/dist/index.js's
   * `thinking?.type !== "disabled" && reasoningEffort != null` guard, which
   * confirms the bypass above is still required on the installed SDK version.
   * @see https://api-docs.deepseek.com/guides/reasoning_model
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
    reasoning: isToggleCapability
      ? undefined
      : toReasoningEffort(reasoningLevel),
  }
}
