import type { GatewayId } from '#shared/types/gateways.d'
import type {
  MemoryModelSource,
} from '#shared/types/memory.d'
import type { SupportedProviderId } from '#shared/types/providers.d'

export type MemoryBackfillStatus
  = 'running'
    | 'completed'
    | 'cancelled'
    | 'failed'

export type MemoryBackfillUnavailableReason
  = 'memory-disabled'
    | 'extraction-disabled'
    | 'no-model'
    | 'estimate-failed'
    | 'all-chats-read'

export type MemoryBackfillFailureReason
  = 'model-unavailable'
    | 'spend-limit'
    | 'too-many-failures'
    | 'consecutive-failures'

export interface MemoryBackfillModel {
  source: MemoryModelSource
  providerId: SupportedProviderId | null
  gatewayId: GatewayId | null
  modelId: string
}

export interface MemoryBackfillEstimateModel extends MemoryBackfillModel {
  modelName: string
}

export interface MemoryBackfillPricePerMillion {
  input: number
  output: number
}

export interface MemoryBackfillEstimate {
  chats: number
  userChars: number
  transcriptChars: number
  inputTokens: number
  outputTokens: number
  overheadTokensPerChat: number
  pricePerMillion: MemoryBackfillPricePerMillion | null
  costUsd: number | null
  approximate: true
  continuesPreviousRun?: boolean
  model: MemoryBackfillEstimateModel | null
}

export interface MemoryBackfillProgress {
  id: string
  status: MemoryBackfillStatus
  startedAt: string
  finishedAt: string | null
  totalChats: number
  processedChats: number
  createdEntries: number
  updatedEntries: number
  skippedChats: number
  failedChats: number
  inputTokens: number
  outputTokens: number
  failureReason: MemoryBackfillFailureReason | null
  dropped: Record<string, number>
  model: MemoryBackfillModel | null
  estimate: MemoryBackfillEstimate | null
}

export interface MemoryBackfillOverview {
  job: MemoryBackfillProgress | null
  estimate: MemoryBackfillEstimate | null
  reason: MemoryBackfillUnavailableReason | null
}

export interface MemoryBackfillJobResponse {
  job: MemoryBackfillProgress
}

export interface MemoryBackfillCancelResponse {
  job: MemoryBackfillProgress | null
}
