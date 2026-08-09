export type GatewayId = 'vercel' | 'cloudflare' | 'openrouter'

export interface GatewayModel {
  id: string
  name: string
  description?: string
  contextLength?: number
  maxOutputTokens?: number
  pricing?: { input: string, output: string }
  modalities?: { input: string[], output: string[] }
  supportsTools?: boolean
}
