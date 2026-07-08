import type { ChatErrorPayload } from './chat-errors.d'

export type ResearchLevel = 'quick' | 'thorough'

export type ResearchLevelSetting = 'off' | ResearchLevel

export type ResearchJobStatus
  = | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'

export type ResearchProviderId = 'openai' | 'google'

export interface ResearchLevelConfig {
  modelId: string
  label: string
  costEstimate: string
  timeEstimate: string
}

export interface ProviderResearchCapability {
  assistModel: string
  levels: Record<ResearchLevel, ResearchLevelConfig>
}

export interface ResearchClarificationQuestion {
  id: string
  question: string
  kind: 'choice' | 'text'
  options?: string[]
  placeholder?: string
}

export interface ResearchClarificationResponse {
  questions: ResearchClarificationQuestion[]
  note?: string
}

export interface ResearchAnswer {
  id: string
  question: string
  answer: string
}

export interface ResearchUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  toolCalls?: number
}

export interface ResearchMetadata {
  provider: ResearchProviderId
  level: ResearchLevel
  modelId: string
  durationMs?: number
  usage?: ResearchUsage
}

export interface ResearchJobView {
  publicId: string
  status: ResearchJobStatus
  provider: ResearchProviderId
  level: ResearchLevel
  modelId: string
  startedAt: number | null
  error: ChatErrorPayload | null
  resultMessageId: string | null
}
