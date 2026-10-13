import { createError } from 'evlog'
import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { Tools } from '#shared/types/chats.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import { getReasoningControlState } from '#shared/utils/reasoning'
import type { FormattedTools } from '~~/server/types/tools.d'
import { createXai } from '@ai-sdk/xai'
import {
  resolveReasoningLevelForModel,
  toReasoningEffort,
} from './reasoning'

export async function useXai(
  userId: string,
  model: string,
  requestedTools: Tools,
  requestedReasoning: ReasoningLevel,
  cacheKey?: string,
) {
  const data = await useDb().query.keys.findFirst({
    where: {
      userId: parseInt(userId),
      provider: 'xai',
    },
    columns: {
      apiKey: true,
    },
  })

  if (!data?.apiKey) {
    throw createError({
      message: 'xAI API key not found. Please set it up in the settings.',
      status: 401,
    })
  }

  const xai = createXai({
    apiKey: await useDecryptText(data.apiKey),
    ...(cacheKey ? { headers: { 'x-grok-conv-id': cacheKey } } : {}),
  })
  const { model: modelData } = getModel(model)

  if (!modelData) {
    throw createError({
      message: 'Unsupported model.',
      status: 400,
    })
  }

  const controllerModelId = getControllerModelId(modelData)
  const imageModelId = getImageGenerationModelId(
    modelData,
    'grok-imagine-image-2.0',
  )

  function getInstance() {
    return xai(controllerModelId)
  }

  function getImageModel() {
    if (!requestedTools.includes('image_generation')) {
      return undefined
    }

    return xai.image(imageModelId)
  }

  async function generateChatTitle(message: string) {
    return await useChatTitle(
      getInstance(),
      message,
    )
  }

  const reasoningLevel = resolveReasoningLevelForModel(
    modelData,
    requestedReasoning,
  )
  const reasoningAlwaysOn = getReasoningControlState(modelData) === 'always-on'

  function getTools(): FormattedTools {
    if (
      !requestedTools?.length
      || requestedTools.includes('image_generation')
    ) {
      return {}
    }

    const result: FormattedTools = {}

    if (requestedTools.includes('web_search')) {
      if (!result.tools) {
        result.tools = {}
      }

      result.tools['web_search_preview'] = xai.tools.webSearch({})

      /**
       * Unlike Anthropic, forcing toolChoice here is currently a no-op on
       * xAI's Responses API: the SDK detects web_search as a server-side
       * tool and silently falls back to auto tool_choice regardless of
       * what's requested.
       */
      if (reasoningLevel === 'off') {
        result.toolChoice = {
          type: 'tool',
          toolName: 'web_search_preview',
        }
      }
    }

    return result
  }

  function getProviderOptions(): SharedV2ProviderOptions {
    const result: SharedV2ProviderOptions = {}

    /**
     * `reasoningSummary` is deprecated in @ai-sdk/xai 5 and no longer sent on
     * the wire (vercel/ai PR #21410): xAI documents `reasoning.summary` as
     * compatibility-only. xAI documents readable reasoning summaries only for
     * `grok-4.7`. `grok-4.20-0309-reasoning` and `grok-4.5` were observed
     * reporting reasoning tokens with no readable text, which the chat UI
     * shows as a compact "Reasoned" indicator. Kept only as a harmless
     * no-op that records the request intent. See docs/providers/xai.md
     * "Reasoning output".
     * @see https://docs.x.ai/developers/model-capabilities/text/reasoning
     */
    if (reasoningLevel !== 'off' || reasoningAlwaysOn) {
      Object.assign(result, {
        reasoningSummary: 'detailed',
      })
    }

    return result
  }

  return {
    instance: getInstance(),
    imageModel: getImageModel(),
    imageModelId,
    generateChatTitle,
    tools: getTools(),
    providerOptions: getProviderOptions(),
    reasoning: toReasoningEffort(reasoningLevel),
  }
}
