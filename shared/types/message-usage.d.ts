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
  // A blended total cost in USD, upstream-reported rather than derived from
  // the static per-model cost map. Written only by restored gateway sends —
  // OpenRouter's providerMetadata.openrouter.usage.cost, Vercel's async
  // getGenerationInfo() total, or a catalog-pricing estimate for Cloudflare,
  // which reports no cost at all. getPerMessageCost() prefers this over the
  // inputCost/outputCost split whenever it is set, since a gateway never
  // reports the split itself and inventing a decomposition would fabricate
  // numbers.
  totalCost?: number
  // Google Search grounding, Anthropic's web_search server tool, OpenAI's
  // web_search Responses tool, and the BYOK Brave/Exa search tools are all
  // billed separately from tokens and deliberately kept out of outputCost:
  // the provider bill is higher than the token cost alone and must stay
  // visible as its own line. searchCost is always an approximation (the
  // app cannot know a BYOK user's real billing tier), so the UI always
  // renders it with "~". searchCost is never set when the search fee is
  // already inside a gateway's blended totalCost (OpenRouter's `web`
  // plugin, Vercel's `perplexitySearch()`) — that would double-count the
  // same charge.
  searchUnits?: number
  searchBillingUnit?: SearchBillingUnit
  searchCost?: number
  searchProvider?: SearchProvider
}

export type ChatMessageMetadata = {
  usage?: MessageUsage
  createdAt?: string | number | Date
}
