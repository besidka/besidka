import type {
  KnowledgeCharCounts,
  KnowledgeDecision,
  KnowledgeDecisionInput,
  KnowledgeMediaCounts,
  KnowledgeTokenFamily,
} from '#shared/types/project-knowledge.d'
import { getGatewayModelProviderPrefix } from '#shared/utils/gateway-model-id'
import {
  KNOWLEDGE_BUDGET,
  KNOWLEDGE_CHARS_PER_TOKEN,
  KNOWLEDGE_LIMITS,
  knowledgeTokenFamilies,
} from '#shared/utils/project-knowledge-policy'

const LATIN_MAX_CODE_POINT = 0x24F
const LATIN_EXTENDED_ADDITIONAL_MIN = 0x1E00
const LATIN_EXTENDED_ADDITIONAL_MAX = 0x1EFF
const CYRILLIC_MIN = 0x400
const CYRILLIC_MAX = 0x52F
const CYRILLIC_EXTENDED_C_MIN = 0x1C80
const CYRILLIC_EXTENDED_C_MAX = 0x1C8F
const CYRILLIC_EXTENDED_B_MIN = 0xA640
const CYRILLIC_EXTENDED_B_MAX = 0xA69F
const ROUNDING_EPSILON = 1e-9

const gatewayVendorFamilies: Record<string, KnowledgeTokenFamily> = {
  'anthropic': 'anthropic',
  'openai': 'openai',
  'google': 'google',
  'x-ai': 'xai',
  'xai': 'xai',
  'deepseek': 'deepseek',
  'deepseek-ai': 'deepseek',
  'moonshotai': 'moonshotai',
  'qwen': 'qwen',
  'alibaba': 'qwen',
}

function isLatinCodePoint(codePoint: number): boolean {
  return codePoint <= LATIN_MAX_CODE_POINT
    || (
      codePoint >= LATIN_EXTENDED_ADDITIONAL_MIN
      && codePoint <= LATIN_EXTENDED_ADDITIONAL_MAX
    )
}

function isCyrillicCodePoint(codePoint: number): boolean {
  return (codePoint >= CYRILLIC_MIN && codePoint <= CYRILLIC_MAX)
    || (
      codePoint >= CYRILLIC_EXTENDED_C_MIN
      && codePoint <= CYRILLIC_EXTENDED_C_MAX
    )
    || (
      codePoint >= CYRILLIC_EXTENDED_B_MIN
      && codePoint <= CYRILLIC_EXTENDED_B_MAX
    )
}

function isTokenFamily(value: string): value is KnowledgeTokenFamily {
  return (knowledgeTokenFamilies as readonly string[]).includes(value)
}

function ceilWithEpsilon(value: number): number {
  return Math.max(0, Math.ceil(value - ROUNDING_EPSILON))
}

export function countKnowledgeChars(text: string): KnowledgeCharCounts {
  let latinChars = 0
  let cyrillicChars = 0
  let otherChars = 0

  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0

    if (isLatinCodePoint(codePoint)) {
      latinChars += 1
    } else if (isCyrillicCodePoint(codePoint)) {
      cyrillicChars += 1
    } else {
      otherChars += 1
    }
  }

  return { latinChars, cyrillicChars, otherChars }
}

export function addKnowledgeCharCounts(
  ...counts: KnowledgeCharCounts[]
): KnowledgeCharCounts {
  const total: KnowledgeCharCounts = {
    latinChars: 0,
    cyrillicChars: 0,
    otherChars: 0,
  }

  for (const count of counts) {
    total.latinChars += count.latinChars
    total.cyrillicChars += count.cyrillicChars
    total.otherChars += count.otherChars
  }

  return total
}

export function resolveKnowledgeTokenFamily(input: {
  providerId: string
  modelId?: string | null
  gateway?: boolean
}): KnowledgeTokenFamily {
  if (!input.gateway) {
    return isTokenFamily(input.providerId) ? input.providerId : 'default'
  }

  if (!input.modelId) {
    return 'default'
  }

  const vendor = getGatewayModelProviderPrefix(input.modelId)

  if (!Object.hasOwn(gatewayVendorFamilies, vendor)) {
    return 'default'
  }

  return gatewayVendorFamilies[vendor]!
}

export function estimateKnowledgeTextTokens(
  counts: KnowledgeCharCounts,
  family: KnowledgeTokenFamily,
): number {
  const charsPerToken = KNOWLEDGE_CHARS_PER_TOKEN[family]
  const tokens = counts.latinChars / charsPerToken.latin
    + counts.cyrillicChars / charsPerToken.cyrillic
    + counts.otherChars / charsPerToken.other

  return ceilWithEpsilon(tokens)
}

export function estimateKnowledgeTokens(input: {
  counts: KnowledgeCharCounts
  family: KnowledgeTokenFamily
  media?: KnowledgeMediaCounts
}): number {
  const textTokens = estimateKnowledgeTextTokens(input.counts, input.family)
  const imageTokens = (input.media?.images ?? 0) * KNOWLEDGE_LIMITS.imageTokens
  const nativePdfTokens = (input.media?.nativePdfPages ?? 0)
    * KNOWLEDGE_LIMITS.nativePdfPageTokens

  return textTokens + imageTokens + nativePdfTokens
}

export function computeKnowledgeBudget(
  contextWindow: number | null | undefined,
): {
  budgetTokens: number
  contextWindow: number
  contextWindowKnown: boolean
} {
  const contextWindowKnown = typeof contextWindow === 'number'
    && Number.isFinite(contextWindow)
    && contextWindow > 0
  const resolvedWindow = contextWindowKnown
    ? contextWindow
    : KNOWLEDGE_BUDGET.unknownContextWindowTokens
  const shareTokens = Math.floor(
    resolvedWindow * KNOWLEDGE_BUDGET.contextWindowShare + ROUNDING_EPSILON,
  )

  return {
    budgetTokens: Math.min(KNOWLEDGE_BUDGET.absoluteCapTokens, shareTokens),
    contextWindow: resolvedWindow,
    contextWindowKnown,
  }
}

export function computeReservedOutputTokens(
  maxOutputTokens: number | null | undefined,
): number {
  const requested = typeof maxOutputTokens === 'number'
    && Number.isFinite(maxOutputTokens)
    && maxOutputTokens > 0
    ? maxOutputTokens
    : KNOWLEDGE_BUDGET.defaultReservedOutputTokens

  return Math.min(requested, KNOWLEDGE_BUDGET.maxReservedOutputTokens)
}

export function measuredHistoryTokens(
  last: {
    inputTokens: number
    outputTokens: number
    knowledgeTokens: number | null
  } | null | undefined,
): number | null {
  if (!last) {
    return null
  }

  if (!Number.isFinite(last.inputTokens) || last.inputTokens <= 0) {
    return null
  }

  const outputTokens = Number.isFinite(last.outputTokens)
    ? last.outputTokens
    : 0

  return Math.max(
    0,
    last.inputTokens + outputTokens - (last.knowledgeTokens ?? 0),
  )
}

/**
 * Decides how project knowledge reaches the model for one send. `required`
 * is the left side of the fit inequality (design 5.2/5.5): a measured
 * history replaces the estimated system, history and tool tokens. The
 * inequality is checked against the context window; `over-budget` is
 * evaluated first in auto mode because it depends only on the knowledge and
 * the model, never on history. A forced `full` that does not fit falls back
 * to search with the `full-does-not-fit` notice.
 */
export function decideKnowledgeMode(
  input: KnowledgeDecisionInput,
): KnowledgeDecision {
  const budget = computeKnowledgeBudget(input.contextWindow)
  const reservedOutputTokens = computeReservedOutputTokens(
    input.maxOutputTokens,
  )
  const marginKnowledgeTokens = ceilWithEpsilon(
    input.knowledgeTokens * KNOWLEDGE_BUDGET.estimateMargin,
  )
  const historyTokens = input.measuredHistoryTokens != null
    ? input.measuredHistoryTokens
    : input.estimatedSystemTokens
      + input.estimatedHistoryTokens
      + input.toolTokens
  const requiredTokens = historyTokens
    + input.messageTokens
    + marginKnowledgeTokens
    + reservedOutputTokens
  const fits = requiredTokens <= budget.contextWindow
  const decision = {
    budgetTokens: budget.budgetTokens,
    contextWindow: budget.contextWindow,
    contextWindowKnown: budget.contextWindowKnown,
    reservedOutputTokens,
    requiredTokens,
    fits,
    notice: null,
  } satisfies Omit<KnowledgeDecision, 'mode' | 'reason'>

  if (input.knowledgeTokens <= 0) {
    return { ...decision, mode: 'none', reason: 'empty' }
  }

  if (input.mode === 'search') {
    return { ...decision, mode: 'search', reason: 'forced-search' }
  }

  if (input.mode === 'full') {
    if (fits) {
      return { ...decision, mode: 'full', reason: 'within-budget' }
    }

    return {
      ...decision,
      mode: 'search',
      reason: 'does-not-fit',
      notice: 'full-does-not-fit',
    }
  }

  if (input.knowledgeTokens > budget.budgetTokens) {
    return { ...decision, mode: 'search', reason: 'over-budget' }
  }

  if (!fits) {
    return { ...decision, mode: 'search', reason: 'does-not-fit' }
  }

  return { ...decision, mode: 'full', reason: 'within-budget' }
}
