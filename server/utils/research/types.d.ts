import type {
  ResearchJobStatus,
  ResearchLevel,
  ResearchTraceEntry,
  ResearchUsage,
} from '#shared/types/research.d'

export interface ResearchStartInput {
  apiKey: string
  modelId: string
  tier: ResearchLevel
  brief: string
  maxToolCalls?: number
}

export interface ResearchStartResult {
  providerJobId: string
  status: ResearchJobStatus
}

export interface ResearchStatusResult {
  status: ResearchJobStatus
  raw?: unknown
  currentStep?: ResearchTraceEntry
}

export interface ResearchSource {
  sourceId: string
  url: string
  title?: string
}

export interface ResearchFinalResult {
  reportText: string
  sources: ResearchSource[]
  usage?: ResearchUsage
  trace?: ResearchTraceEntry[]
}

export interface ResearchAdapter {
  start(input: ResearchStartInput): Promise<ResearchStartResult>
  status(providerJobId: string, apiKey: string): Promise<ResearchStatusResult>
  result(providerJobId: string, apiKey: string): Promise<ResearchFinalResult>
  cancel(providerJobId: string, apiKey: string): Promise<void>
}
