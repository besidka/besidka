import type { LanguageModelUsage } from 'ai'
import type { MessageUsage } from '#shared/types/message-usage.d'
import { getModel } from '#shared/utils/model'
import { getModelResearch } from '#shared/utils/research'
import { hasUnknownTokenSplit } from '#shared/utils/message-metadata'
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

/**
 * Fold a generated image's dollar cost into `outputCost` so the text model's
 * per-token cost and the image model's flat per-image cost show up as one
 * number to the user. `imageGenerationCost` is `undefined` whenever no image
 * was generated this turn (or the image model has no known price), in which
 * case `usage` is returned unchanged — a turn that merely supports image
 * generation without using it must never gain a fabricated cost.
 */
export function addImageGenerationCostToUsage(
  usage: MessageUsage | undefined,
  imageGenerationCost: number | undefined,
): MessageUsage | undefined {
  if (!usage || imageGenerationCost === undefined) {
    return usage
  }

  return {
    ...usage,
    outputCost: (usage.outputCost ?? 0) + imageGenerationCost,
  }
}

function parseResearchCostEstimate(costEstimate: string): number | undefined {
  const matches = costEstimate.match(/[0-9]+(?:[.,][0-9]+)*/g)

  if (!matches?.length) {
    return undefined
  }

  const values = matches.map(match => Number(match.replace(/,/g, '')))
  const total = values.reduce((sum, value) => sum + value, 0)

  return total / values.length
}

function hasNoTrustworthyCost(usage: MessageUsage): boolean {
  const costUnknown = usage.inputCost === undefined
    && usage.outputCost === undefined

  return costUnknown || hasUnknownTokenSplit(usage)
}

/**
 * Falls back to a flat per-task dollar estimate for deep research messages
 * whose real cost can't be computed from tokens. Google's Deep Research API
 * reports only a total token count (no input/output split) and has no
 * published per-token rate, so buildMessageUsage() correctly leaves cost
 * fields unset rather than fabricate a number from a defaulted-zero split.
 * Left as-is, sumMessageCosts() in message-metadata.ts silently drops that
 * message from any total it contributes to — the research job's real
 * spend disappears from "Chat total" while an unrelated message's cost is
 * shown as if it were the whole chat's cost (this is the bug being fixed).
 * OpenAI's deep research models already carry real published per-token
 * prices, so they already produce a trustworthy cost and this never
 * overwrites them. The `costEstimated` flag this sets tells the UI to
 * render the fallback with a "~" instead of as an exact figure. Only
 * `outputCost` is set — a message's displayed cost is always driven by
 * `outputCost` alone (see `getPerMessageCost` in message-metadata.ts), so
 * `inputCost` is left untouched by design.
 */
export function addResearchCostEstimateToUsage(
  usage: MessageUsage | undefined,
  modelId: string,
): MessageUsage | undefined {
  if (!usage || !hasNoTrustworthyCost(usage)) {
    return usage
  }

  const { model } = getModel(modelId)
  const research = getModelResearch(model)
  const costEstimate = research
    ? parseResearchCostEstimate(research.costEstimate)
    : undefined

  if (costEstimate === undefined) {
    return usage
  }

  return {
    ...usage,
    outputCost: costEstimate,
    costEstimated: true,
  }
}
