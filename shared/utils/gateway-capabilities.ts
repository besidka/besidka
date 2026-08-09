import type { GatewayId, WebSearchResolution } from '#shared/types/gateways.d'
import type { ModelTool } from '#shared/types/providers.d'

/**
 * The single source of truth for which tools a gateway send may carry.
 * `web_search` is a universal capability on OpenRouter and Vercel (their own
 * plugin/tool works on any routed model) and does not exist at all on
 * Cloudflare. `image_generation` stays rejected everywhere gateways are
 * concerned — actually generating images through a gateway is separate,
 * not-yet-built functionality.
 *
 * Deliberately per-gateway, not per-model: it does not know whether the
 * specific routed model is a confirmed image-generation model (see
 * `resolveGatewayWebSearchSupport`'s badge-only exclusion for that case). A
 * request can attach `web_search` to an image-generation model on
 * OpenRouter/Vercel and it will be forwarded and billed on the user's own
 * key — self-directed spend, not a privilege escalation, so this is an
 * accepted trade-off rather than a gap to close.
 */
const GATEWAY_TOOL_POLICY: Record<GatewayId, ModelTool[]> = {
  openrouter: ['web_search'],
  vercel: ['web_search'],
  cloudflare: [],
}

export function isGatewayToolAllowed(
  gatewayId: GatewayId,
  tool: ModelTool,
): boolean {
  return GATEWAY_TOOL_POLICY[gatewayId].includes(tool)
}

/**
 * Whether a gateway's send path can carry a functional reasoning-effort
 * request at all — the single source of truth consumed by both the
 * chat-input reasoning toggle/levels gating and the server-side
 * `reasoningLevel` resolution in `index.post.ts`, so the two can never drift
 * the way the pre-round-4 web-search badge/toggle/gate did. OpenRouter and
 * Vercel both forward a real reasoning-effort request to the routed model
 * (OpenRouter via a `reasoning: { effort }` chat setting, Vercel via the
 * AI SDK's top-level `reasoning` option translated server-side) — see
 * `docs/gateways.md`'s "Gateway reasoning" section for the full mechanism
 * per gateway. Cloudflare has no such mechanism wired, so its existing
 * `supportsReasoning` catalog badge stays advisory-only, matching the same
 * "badge without a working control" gap this app already accepts for
 * Cloudflare's web search and image generation.
 */
const GATEWAY_REASONING_POLICY: Record<GatewayId, boolean> = {
  openrouter: true,
  vercel: true,
  cloudflare: false,
}

export function isGatewayReasoningSupported(gatewayId: GatewayId): boolean {
  return GATEWAY_REASONING_POLICY[gatewayId]
}

export const WEB_SEARCH_TOOLTIP: Record<WebSearchResolution, string> = {
  native: 'Web search (native)',
  universal: 'Web search (via gateway, billed per search)',
}

/**
 * Resolves the one signal that feeds the picker badge, the chat-input
 * toggle, and the server-side send gate, so the three can never drift apart
 * again. Every branch — including a genuine per-model native signal — is
 * gated through `isGatewayToolAllowed` first: a gateway whose policy denies
 * `web_search` can never earn a badge the send gate would then reject, even
 * if its raw catalog happens to report a native flag. `hasNativeSignal`
 * comes from whatever the gateway's raw catalog already reports
 * (OpenRouter's `web_search_options`, Vercel's `web-search` tag) and is kept
 * as `'native'` regardless of the image-generation exclusion below — a
 * genuine per-model fact overrides that heuristic. Absent a native signal,
 * any model this gateway can universally search gets `'universal'`, UNLESS
 * it's a confirmed image-generation model: a globe on an image model would
 * recreate the exact "Image input badge on a generation model" mislabeling
 * this round exists to fix. An unknown (`undefined`) image-generation status
 * is not treated as an exclusion — only positive evidence blocks the
 * universal resolution.
 */
export function resolveGatewayWebSearchSupport(input: {
  gatewayId: GatewayId
  hasNativeSignal: boolean
  isImageGenerationModel: boolean | undefined
}): WebSearchResolution | undefined {
  if (!isGatewayToolAllowed(input.gatewayId, 'web_search')) {
    return undefined
  }

  if (input.hasNativeSignal) {
    return 'native'
  }

  if (input.isImageGenerationModel) {
    return undefined
  }

  return 'universal'
}

/**
 * `undefined` means the gateway reported no output-modality data at all for
 * this model — genuinely unknown, not "confirmed no image output". Only an
 * output list that is present and includes `'image'` earns an explicit
 * `true`; a present-but-non-image list earns an explicit `false`.
 */
export function deriveGatewayImageGenerationSupport(
  outputModalities: string[] | undefined,
): boolean | undefined {
  if (!outputModalities) {
    return undefined
  }

  return outputModalities.includes('image')
}
