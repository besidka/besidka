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
  // Gateway-reported total cost in USD (OpenRouter/Vercel AI Gateway). Unlike
  // inputCost/outputCost, this is not derived from the static per-model cost
  // map — it comes directly from the gateway's own billing data, since
  // gateway model ids are never present in getModelCostMap().
  totalCost?: number
}

export type ChatMessageMetadata = {
  usage?: MessageUsage
  createdAt?: string | number | Date
}
