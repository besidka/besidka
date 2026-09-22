export type SearchBillingUnit = 'query' | 'grounded-prompt' | 'search'

// The provider that actually ran the search: the four native integrations
// (Google, Anthropic, OpenAI, xAI) plus the two BYOK vendors (Brave, Exa).
// Populated by the send path (server/utils/ai/message-usage.ts) so the
// context-menu cost row can say "Web search (Brave)" instead of a bare
// "Web search".
export type SearchProvider
  = 'google' | 'anthropic' | 'openai' | 'xai' | 'brave' | 'exa'

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
  searchProvider?: SearchProvider
}

export type ChatMessageMetadata = {
  usage?: MessageUsage
  createdAt?: string | number | Date
}
