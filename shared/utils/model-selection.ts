import type { GatewayId } from '#shared/types/gateways.d'
import type { ModelSelection } from '#shared/types/model-selection.d'

const gatewayIds: GatewayId[] = ['vercel', 'cloudflare', 'openrouter']

function isGatewayId(value: unknown): value is GatewayId {
  return typeof value === 'string'
    && (gatewayIds as string[]).includes(value)
}

function toGatewaySelection(parsed: unknown): ModelSelection | null {
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }

  const candidate = parsed as Record<string, unknown>

  if (typeof candidate.modelId !== 'string' || !candidate.modelId) {
    return null
  }

  if (candidate.source === 'provider') {
    return { source: 'provider', modelId: candidate.modelId }
  }

  if (candidate.source !== 'gateway' || !isGatewayId(candidate.gatewayId)) {
    return null
  }

  return {
    source: 'gateway',
    gatewayId: candidate.gatewayId,
    modelId: candidate.modelId,
  }
}

/**
 * Reads the `'model'` preference, which predates gateways and therefore holds
 * a bare model id for every already-stored value. Anything not starting with
 * `{` keeps that legacy meaning so existing users need no migration; only the
 * JSON form can carry a gateway. Unparseable or structurally invalid JSON
 * degrades to the same bare-string reading rather than throwing.
 */
export function parseModelSelection(
  raw: string | null,
  fallbackModelId: string,
): ModelSelection {
  if (!raw) {
    return { source: 'provider', modelId: fallbackModelId }
  }

  if (!raw.startsWith('{')) {
    return { source: 'provider', modelId: raw }
  }

  try {
    return toGatewaySelection(JSON.parse(raw))
      ?? { source: 'provider', modelId: raw }
  } catch {
    return { source: 'provider', modelId: raw }
  }
}

/**
 * Provider selections stay bare strings so the stored value is byte-identical
 * to what pre-gateway builds wrote. Gateway selections are JSON because
 * OpenRouter ids contain both `:` and `/`, leaving no safe delimiter.
 */
export function serializeModelSelection(selection: ModelSelection): string {
  if (selection.source === 'provider') {
    return selection.modelId
  }

  return JSON.stringify(selection)
}
