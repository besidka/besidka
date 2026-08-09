import type { GatewayModel } from '#shared/types/gateways.d'
import type { ModelPriceTier } from '#shared/types/providers.d'
import { resolvePriceTierFromPerMillion } from '~~/providers/merge'

const TOKENS_PER_MILLION = 1_000_000

function parsePerTokenPrice(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  const amount = Number(value)

  if (!Number.isFinite(amount) || amount < 0) {
    return null
  }

  return amount
}

/**
 * Resolves a gateway model's per-token `pricing.input` to the same
 * `$`/`$$`/`$$$`/`$$$+` tier enum direct-provider models use, via
 * `providers/merge.ts`'s `tierCeilingsPerMillionTokens` — the single source
 * of truth for both. Returns `null` when pricing is missing or unparseable
 * (including negative sentinel values some catalogs use to mean "unpriced"),
 * never a guessed tier.
 */
export function resolveGatewayPriceTier(
  model: Pick<GatewayModel, 'pricing'>,
): ModelPriceTier | null {
  const inputPricePerToken = parsePerTokenPrice(model.pricing?.input)

  if (inputPricePerToken === null) {
    return null
  }

  return resolvePriceTierFromPerMillion(
    inputPricePerToken * TOKENS_PER_MILLION,
  )
}

/**
 * True only when both `pricing.input` and `pricing.output` are present and
 * parse to exactly `0`. A separate, stricter signal than the cheapest paid
 * tier — missing pricing means unknown, not free, and a model free on input
 * but billed on output does not count as free.
 */
export function isGatewayModelFree(
  model: Pick<GatewayModel, 'pricing'>,
): boolean {
  const inputPrice = parsePerTokenPrice(model.pricing?.input)
  const outputPrice = parsePerTokenPrice(model.pricing?.output)

  if (inputPrice === null || outputPrice === null) {
    return false
  }

  return inputPrice === 0 && outputPrice === 0
}
