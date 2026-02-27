import type { ReasoningCapability } from './reasoning.d'

export interface Model {
  id: string
  name: string
  default?: boolean
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
  tools: Array<'web_search'>
  reasoning?: ReasoningCapability
}

export interface Provider {
  id: string
  name: string
  models: Model[]
}

export type Providers = Provider[]
