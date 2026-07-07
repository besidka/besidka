export type ResearchDepth = 'quick' | 'standard' | 'thorough'

export type ResearchDepthSetting = 'off' | ResearchDepth

export interface ResearchBudget {
  maxSteps: number
  maxSearches: number
  targetSources: number
  label: string
}

export type ResearchStepPhase
  = | 'planning' | 'searching' | 'reading' | 'analyzing' | 'synthesizing'

export interface ResearchStepData {
  phase: ResearchStepPhase
  label: string
  status: 'active' | 'done'
  count?: number
  detail?: string
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

export interface ResearchBriefData {
  topic: string
  depth: ResearchDepth
  answers: ResearchAnswer[]
}
