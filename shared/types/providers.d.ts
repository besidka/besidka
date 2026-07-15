import type { ReasoningCapability } from './reasoning.d'

export type ModelTool = 'web_search' | 'image_generation'

export interface Model {
  id: string
  name: string
  default?: boolean
  forProjectMemory?: boolean
  description: string
  contextLength: number
  maxOutputTokens: number
  price: {
    tokens: number
    input: string
    output: string
  }
  modalities: {
    input: string[]
    output: string[]
  }
  tools: ModelTool[]
  reasoning?: ReasoningCapability
}

export interface Provider {
  id: string
  name: string
  models: Model[]
}

export type Providers = Provider[]
