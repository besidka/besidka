import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { Tools } from '#shared/types/chats.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type { FormattedTools } from '~~/server/types/tools.d'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  resolveReasoningLevelForModel,
  toReasoningEffort,
} from './reasoning'

const QWEN_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'

/**
 * Alibaba's dedicated `qwen-ai-provider` package pins `zod@^3`, which
 * conflicts with this app's `zod@^4` line, so Qwen is wired through the
 * generic `@ai-sdk/openai-compatible` package instead — the same mechanism
 * `server/utils/gateways/cloudflare.ts` already uses. DashScope's
 * international OpenAI-compatible endpoint is used rather than the newer
 * per-workspace `{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com` domain
 * Alibaba now recommends for performance: the workspace-scoped domain needs
 * a Workspace ID collected as a second credential field, while the existing
 * `dashscope-intl.aliyuncs.com` domain — confirmed "fully functional" by
 * Alibaba's own docs, and independently confirmed as models.dev's own `api`
 * field for the `alibaba` provider — keeps Qwen on the single-`apiKey`-field
 * shape every other direct provider in this app uses.
 */
export async function useQwen(
  userId: string,
  model: string,
  requestedTools: Tools,
  requestedReasoning: ReasoningLevel,
) {
  const data = await useDb().query.keys.findFirst({
    where: {
      userId: parseInt(userId),
      provider: 'qwen',
    },
    columns: {
      apiKey: true,
    },
  })

  if (!data?.apiKey) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Qwen API key not found. Please set it up in the settings.',
    })
  }

  const qwen = createOpenAICompatible({
    name: 'qwen',
    apiKey: await useDecryptText(data.apiKey),
    baseURL: QWEN_BASE_URL,
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
    return qwen.chatModel(controllerModelId)
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
   * DashScope's `enable_thinking` is a plain boolean toggle sent directly in
   * the request body (not an OpenAI-style `reasoning_effort` string).
   * `@ai-sdk/openai-compatible` forwards any `providerOptions.qwen` key it
   * doesn't itself recognize (`user`, `reasoningEffort`, `textVerbosity`,
   * `strictJsonSchema`) straight into the JSON body, so this is the only
   * place that needs to know the field name. Every currently curated Qwen
   * model also exposes a `budget_tokens` option alongside the toggle, left
   * deliberately unused here; none exposes adjustable effort levels, so the
   * top-level `reasoning` streamText option is never set for this provider.
   * @see https://www.alibabacloud.com/help/en/model-studio/deep-thinking
   */
  function getProviderOptions(): SharedV2ProviderOptions {
    const result: SharedV2ProviderOptions = {}

    if (!isToggleCapability) {
      return result
    }

    Object.assign(result, {
      enable_thinking: reasoningLevel !== 'off',
    })

    return result
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
