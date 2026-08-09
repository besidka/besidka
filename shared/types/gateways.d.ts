export type GatewayId = 'vercel' | 'cloudflare' | 'openrouter'

export type GatewayFavoriteModels = Partial<Record<GatewayId, string[]>>

export interface GatewayModel {
  id: string
  name: string
  description?: string
  contextLength?: number
  maxOutputTokens?: number
  /**
   * PER-TOKEN USD decimal strings (e.g. `"0.0000025"`) straight from the
   * gateway's raw API — unlike `Model.price` in `providers.d`, which is
   * per-million-token. Do not divide/multiply the two the same way.
   */
  pricing?: { input: string, output: string }
  modalities?: { input: string[], output: string[] }
  supportsTools?: boolean
}
