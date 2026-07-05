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
}

export type ChatMessageMetadata = {
  usage?: MessageUsage
  createdAt?: string | number | Date
}
