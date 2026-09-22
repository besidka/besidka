export type SearchBillingUnit = 'query' | 'grounded-prompt' | 'search'

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
  // Google Search grounding, Anthropic's web_search server tool, and
  // OpenAI's web_search Responses tool are all billed by their providers
  // separately from tokens and deliberately kept out of outputCost: the
  // provider bill is higher than the token cost alone and must stay
  // visible as its own line. searchCost is always an approximation (the
  // app cannot know a BYOK user's real billing tier), so the UI always
  // renders it with "~".
  searchUnits?: number
  searchBillingUnit?: SearchBillingUnit
  searchCost?: number
}

export type ChatMessageMetadata = {
  usage?: MessageUsage
  createdAt?: string | number | Date
}
