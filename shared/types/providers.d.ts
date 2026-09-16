import type { ReasoningCapability } from './reasoning.d'
import type { ModelResearchConfig } from './research.d'

export type SupportedProviderId
  = 'openai'
    | 'google'
    | 'anthropic'
    | 'xai'
    | 'deepseek'
    | 'moonshotai'
    | 'qwen'

export type ModelTool = 'web_search' | 'image_generation'

export interface ModelImageGenerationCapability {
  controllerModel: string
}

export type ModelPriceTier = '$' | '$$' | '$$$' | '$$$+'

export interface Model {
  id: string
  name: string
  default?: boolean
  forProjectMemory?: boolean
  description: string
  contextLength: number
  maxOutputTokens: number
  releaseDate?: string
  status?: 'deprecated' | 'beta' | 'alpha'
  retiredAt?: string
  price: {
    tokens: number
    input: string
    output: string
    display?: string
  }
  priceTier: ModelPriceTier
  modalities: {
    input: string[]
    output: string[]
  }
  tools: ModelTool[]
  imageGeneration?: ModelImageGenerationCapability
  reasoning?: ReasoningCapability
  reasoningAlwaysOn?: true
  research?: ModelResearchConfig
}

export interface Provider {
  id: string
  name: string
  models: Model[]
}

export type Providers = Provider[]
