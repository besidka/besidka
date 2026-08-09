import type { GatewayModel } from '#shared/types/gateways.d'
import type { ModelPriceTier } from '#shared/types/providers.d'
import { resolvePriceTierFromPerMillion } from '~~/providers/merge'

const TOKENS_PER_MILLION = 1_000_000

export function parsePerTokenPrice(value: string | undefined): number | null {
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

/**
 * Token-based cost estimate for gateways with no per-request cost API
 * (Cloudflare AI Gateway — see `docs/gateways.md`'s cost-capture section).
 * Multiplies the raw usage token counts by the catalog's per-token
 * `pricing.input`/`pricing.output` strings. Returns `undefined` when either
 * price is missing or unparseable, never a guessed or partial total — the
 * caller is expected to leave `totalCost` unset in that case, the same as
 * today's Cloudflare behavior, rather than display a fabricated number.
 */
export function estimateGatewayMessageCost(
  model: Pick<GatewayModel, 'pricing'>,
  usage: { inputTokens: number, outputTokens: number },
): number | undefined {
  const inputPricePerToken = parsePerTokenPrice(model.pricing?.input)
  const outputPricePerToken = parsePerTokenPrice(model.pricing?.output)

  if (inputPricePerToken === null || outputPricePerToken === null) {
    return undefined
  }

  return usage.inputTokens * inputPricePerToken
    + usage.outputTokens * outputPricePerToken
}
