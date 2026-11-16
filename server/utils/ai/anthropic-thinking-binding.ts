import type { ModelMessage, PrepareStepFunction, ToolSet } from 'ai'
import type { LoggerLike } from '~~/server/utils/files/logger'
import type {
  AnthropicThinkingOption,
} from '~~/server/utils/providers/anthropic'

type StepOptions = Parameters<PrepareStepFunction<ToolSet>>[0]
type StepPreparation = Awaited<ReturnType<PrepareStepFunction<ToolSet>>>

interface InputTransformation {
  type?: unknown
}

interface AnthropicReasoningOptions {
  signature?: unknown
  redactedData?: unknown
}

/**
 * Whether the messages replay a thinking block Anthropic signed, which is
 * the only thing the prefix check can fail on.
 */
export function hasSignedAnthropicReasoning(
  messages: readonly ModelMessage[],
): boolean {
  return messages.some((message) => {
    if (message.role !== 'assistant' || typeof message.content === 'string') {
      return false
    }

    return message.content.some((part) => {
      if (part.type !== 'reasoning') {
        return false
      }

      const anthropic = part.providerOptions?.anthropic as
        | AnthropicReasoningOptions
        | undefined

      return !!anthropic?.signature || !!anthropic?.redactedData
    })
  })
}

function describeRequestPrefix(
  prepared: StepPreparation,
  options: StepOptions,
  toolNames: readonly string[],
): string {
  return JSON.stringify([
    prepared?.activeTools ?? toolNames,
    prepared?.toolOrder ?? null,
    prepared?.instructions ?? prepared?.system ?? options.instructions ?? null,
  ])
}

function countDroppedThinkingBlocks(steps: StepOptions['steps']): number {
  return steps.reduce((total, step) => {
    const transformations = step.providerMetadata?.anthropic
      ?.inputTransformations

    if (!Array.isArray(transformations)) {
      return total
    }

    return total + transformations.filter((transformation) => {
      return (transformation as InputTransformation)?.type
        === 'thinking_dropped'
    }).length
  }, 0)
}

/**
 * Wraps the send's `prepareStep` for a direct Anthropic model with preserved
 * thinking. Anthropic binds each thinking block to the `system` prompt, the
 * `tools` list and every earlier message, and a later step of the same send
 * replays that block. A step whose tools or instructions differ from an
 * earlier step's (a tool loaded on demand, an opened connector, the forced
 * final step's instructions) would fail with "The block is bound to a
 * different conversation", so from the first such step on, every step sends
 * `thinking` with `blockBinding: drop_block`, and the API drops the blocks
 * that no longer match instead. Steps before any change, and sends that never
 * change, are sent exactly as before, and so is any step that replays no
 * signed thinking. `bindFromStart` binds from the first step, for an
 * approval resume that replays thinking produced under another tool set.
 * The tools each step offers are left as the base decided, so a deferred
 * tool that is not loaded stays out of the step and cannot run.
 */
export function withAnthropicThinkingBinding(input: {
  base?: PrepareStepFunction<ToolSet>
  thinking: AnthropicThinkingOption
  toolNames: readonly string[]
  bindFromStart?: boolean
  logger?: LoggerLike
}): PrepareStepFunction<ToolSet> {
  const seenPrefixes = new Set<string>()

  return async (options) => {
    const prepared = input.base ? await input.base(options) : undefined

    seenPrefixes.add(describeRequestPrefix(prepared, options, input.toolNames))

    const prefixChanged = seenPrefixes.size > 1

    if (!prefixChanged && !input.bindFromStart) {
      return prepared
    }

    if (!hasSignedAnthropicReasoning(prepared?.messages ?? options.messages)) {
      return prepared
    }

    input.logger?.set({
      attributes: {
        anthropicThinking: {
          blockBinding: 'drop_block',
          prefixChanges: seenPrefixes.size - 1,
          fromStart: !!input.bindFromStart,
          droppedBlocks: countDroppedThinkingBlocks(options.steps),
        },
      },
    })

    return {
      ...prepared,
      providerOptions: {
        ...prepared?.providerOptions,
        anthropic: {
          ...prepared?.providerOptions?.anthropic,
          thinking: input.thinking,
        },
      },
    }
  }
}
