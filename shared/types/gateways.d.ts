export type GatewayId = 'vercel' | 'cloudflare' | 'openrouter'

export type GatewayFavoriteModels = Partial<Record<GatewayId, string[]>>

/**
 * `'native'` means the gateway's own raw catalog signals that the *routed*
 * provider supports web search directly (e.g. OpenRouter's
 * `web_search_options`, Vercel's `web-search` tag). `'universal'` means the
 * gateway itself can search on behalf of any model via its own plugin/tool
 * (OpenRouter's `web` plugin, Vercel's gateway-executed search tools),
 * billed separately per search. `undefined` means neither mechanism is
 * available for this model/gateway — never treat it as "no" without also
 * checking the source, since it can also mean "the catalog doesn't say".
 */
export type WebSearchResolution = 'native' | 'universal'

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
  /**
   * Advisory, best-effort signals read from each gateway's uncurated raw
   * catalog. `undefined` means "unknown" — a gateway that doesn't expose the
   * underlying field, not "unsupported" — so never treat absence as `false`
   * and never assert `true` without a concrete raw-catalog field backing it.
   */
  supportsReasoning?: boolean
  supportsWebSearch?: WebSearchResolution
  /**
   * Derived from the model's own OUTPUT modalities containing `image` — a
   * genuine image-generation model, never conflated with `modalities.input`
   * (which only tells you the model can receive image/video/PDF input, i.e.
   * vision). `undefined` means the gateway reported no output-modality data
   * at all, not "confirmed no image output".
   */
  supportsImageGeneration?: boolean
}
