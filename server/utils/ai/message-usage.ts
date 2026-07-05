import type { LanguageModelUsage } from 'ai'
import type { MessageUsage } from '#shared/types/message-usage.d'
import { getModelCostMap } from '~~/server/utils/ai/cost-map'

/**
 * Build the persisted/streamed usage shape for one assistant message from
 * the AI SDK's final `LanguageModelUsage`. Returns `undefined` when the
 * generation was aborted or otherwise incomplete: the SDK reports every
 * token field as `undefined` (never `0`) in that case, so a `0` here would
 * misrepresent an unknown cost as a free one. Cost fields are likewise
 * omitted (never fabricated as `0`) when the model has no known price in
 * `getModelCostMap()`.
 */
export function buildMessageUsage(
  usage: LanguageModelUsage,
  modelId: string,
  providerId: string,
): MessageUsage | undefined {
  const isIncompleteUsage = usage.inputTokens === undefined
    && usage.outputTokens === undefined
    && usage.totalTokens === undefined

  if (isIncompleteUsage) {
    return undefined
  }

  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0
  const totalTokens = usage.totalTokens ?? inputTokens + outputTokens
  const reasoningTokens = usage.outputTokenDetails?.reasoningTokens
  const cachedInputTokens = usage.inputTokenDetails?.cacheReadTokens
  const cost = getModelCostMap()[modelId]
  const inputCost = cost
    ? (inputTokens * cost.input) / 1_000_000
    : undefined
  const outputCost = cost
    ? (outputTokens * cost.output) / 1_000_000
    : undefined

  return {
    model: modelId,
    provider: providerId,
    inputTokens,
    outputTokens,
    totalTokens,
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(inputCost === undefined ? {} : { inputCost }),
    ...(outputCost === undefined ? {} : { outputCost }),
  }
}
