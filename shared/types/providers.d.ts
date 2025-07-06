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
  tools: Tools
}

export interface Provider {
  id: string
  name: string
  models: Model[]
}

export type Providers = Provider[]
