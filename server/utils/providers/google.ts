import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { Tools } from '#shared/types/chats.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type { ResearchDepthSetting } from '#shared/types/research.d'
import type { FormattedTools } from '~~/server/types/tools.d'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import {
  resolveReasoningLevelForModel,
  toReasoningEffort,
} from './reasoning'

export async function useGoogle(
  userId: string,
  model: string,
  requestedTools: Tools,
  requestedReasoning: ReasoningLevel,
  researchDepth: ResearchDepthSetting = 'off',
) {
  const data = await useDb().query.keys.findFirst({
    where: {
      userId: parseInt(userId),
      provider: 'google',
    },
    columns: {
      apiKey: true,
    },
  })

  if (!data) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Google key not found. Please set it up in the settings.',
    })
  }

  const google = createGoogleGenerativeAI({
    apiKey: await useDecryptText(data.apiKey),
  })

  function getInstance() {
    return google(model)
  }

  async function generateChatTitle(message: string) {
    return await useChatTitle(
      getInstance(),
      message,
    )
  }

  function getTools(): FormattedTools {
    if (isDeepResearchActive(researchDepth)) {
      return {
        tools: {
          web_search: google.tools.googleSearch({}),
          url_context: google.tools.urlContext({}),
        },
      }
    }

    if (!requestedTools?.length) {
      return {}
    }

    const result: FormattedTools = {}

    if (requestedTools.includes('web_search')) {
      if (!result.tools) {
        result.tools = {}
      }

      result.tools['web_search_preview'] = google.tools.googleSearch({})
      result.toolChoice = {
        type: 'tool',
        toolName: 'web_search_preview',
      }
    }

    return result
  }

  const { model: modelData } = getModel(model)
  const effectiveReasoning: ReasoningLevel
    = isDeepResearchActive(researchDepth) && requestedReasoning === 'off'
      ? 'medium'
      : requestedReasoning
  const reasoningLevel = resolveReasoningLevelForModel(
    modelData,
    effectiveReasoning,
  )

  function getProviderOptions(): SharedV2ProviderOptions {
    const result: SharedV2ProviderOptions = {}

    if (reasoningLevel !== 'off') {
      /**
       * Reasoning effort maps to the model's thinkingLevel (Gemini 3) or
       * thinkingBudget (Gemini 2.5) automatically via the top-level `reasoning`
       * option on streamText (AI SDK v7). providerOptions only carries
       * `includeThoughts`, which the SDK never sets on its own.
       * @see https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai#thinking
       */
      Object.assign(result, {
        thinkingConfig: {
          includeThoughts: true,
        },
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
