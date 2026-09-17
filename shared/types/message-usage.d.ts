export type MessageUsage = {
  model: string
  provider: string
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
  cachedInputTokens?: number
  totalTokens: number
  inputCost?: number
  outputCost?: number
  // Set when outputCost is a flat per-task estimate, not measured from
  // tokens (see addResearchCostEstimateToUsage in
  // server/utils/ai/message-usage.ts).
  costEstimated?: boolean
  // Legacy read-only field: a blended total cost in USD, upstream-reported
  // rather than derived from the static per-model cost map. No current send
  // path writes it; it is kept so already-persisted messages that carry one
  // still render their cost instead of showing nothing.
  totalCost?: number
}

export type ChatMessageMetadata = {
  usage?: MessageUsage
  createdAt?: string | number | Date
}
