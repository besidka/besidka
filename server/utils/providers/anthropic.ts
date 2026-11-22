import { createError } from 'evlog'
import type { AnthropicLanguageModelOptions } from '@ai-sdk/anthropic'
import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { Tools } from '#shared/types/chats.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type { FormattedTools } from '~~/server/types/tools.d'
import { createAnthropic } from '@ai-sdk/anthropic'
import { CODE_EXECUTION_TOOL_NAME } from '#shared/utils/code-execution'
import {
  resolveReasoningLevelForModel,
  toReasoningEffort,
} from './reasoning'

export const ANTHROPIC_AUTOMATIC_CACHE_CONTROL = {
  type: 'ephemeral',
} as const

export type AnthropicThinkingOption = NonNullable<
  AnthropicLanguageModelOptions['thinking']
>

export const ANTHROPIC_PRESERVED_THINKING_MODEL_IDS: readonly string[] = [
  'claude-fable-5-2',
  'claude-mythos-5-2',
  'claude-fable-5-1',
  'claude-mythos-5-1',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
]

const DROP_MISMATCHED_THINKING_BLOCKS = {
  prefixMismatchBehavior: 'drop_block',
} as const

/**
 * The `thinking` option that makes Anthropic drop a thinking block whose
 * prefix (`system`, `tools`, earlier messages) changed since the block was
 * produced, instead of failing the request with "The block is bound to a
 * different conversation". Only the models with preserved thinking run that
 * prefix check. An explicit `thinking` replaces the one the provider derives
 * from `reasoning`, so the derived adaptive object is spelled out in full.
 * With reasoning off the provider sends no `thinking`, and these models then
 * think adaptively by default, so the binding goes with a bare `adaptive`
 * type: the API requires `type` next to `block_binding` and rejects the
 * binding with `disabled` or `between_tools`. See
 * docs/providers/anthropic.md, "Thinking blocks and the prefix check".
 */
export function getAnthropicThinkingBinding(
  modelId: string,
  reasoningLevel: ReasoningLevel,
): AnthropicThinkingOption | undefined {
  if (!ANTHROPIC_PRESERVED_THINKING_MODEL_IDS.includes(modelId)) {
    return undefined
  }

  if (reasoningLevel === 'off') {
    return {
      type: 'adaptive',
      blockBinding: DROP_MISMATCHED_THINKING_BLOCKS,
    }
  }

  return {
    type: 'adaptive',
    display: 'summarized',
    blockBinding: DROP_MISMATCHED_THINKING_BLOCKS,
  }
}

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

    if (requestedTools.includes('code_execution')) {
      result.tools = {
        ...result.tools,
        [CODE_EXECUTION_TOOL_NAME]: anthropic.tools.codeExecution_20260120(),
      }
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
    thinkingBinding: getAnthropicThinkingBinding(
      controllerModelId,
      reasoningLevel,
    ),
  }
}
