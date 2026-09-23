import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { LanguageModel } from 'ai'
import type { GatewayProvider } from '@ai-sdk/gateway'
import type { GatewayId, GatewayModel } from '#shared/types/gateways.d'
import type { ModelTool } from '#shared/types/providers.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type { FormattedTools } from '~~/server/types/tools.d'
import { providerMeta } from '#shared/utils/provider-meta'
import { useVercelGateway } from './vercel'
import { useOpenRouterGateway } from './openrouter'
import { useCloudflareGateway } from './cloudflare'

export type ChatGatewayId = GatewayId

export interface GatewayChatResult {
  instance: LanguageModel
  generateChatTitle: (message: string) => Promise<string>
  tools: FormattedTools
  providerOptions: SharedV2ProviderOptions
  /**
   * Only set by the Vercel AI Gateway builder — used after the assistant
   * message is persisted to look up the real generation cost via
   * `getGenerationInfo()`. OpenRouter reports its cost synchronously in
   * `providerMetadata`, so it never needs this.
   */
  client?: GatewayProvider
  /**
   * The selected model's own catalog `maxOutputTokens`, resolved by the
   * Vercel and Cloudflare builders so the chat route can cap `streamText`'s
   * `maxOutputTokens` and never ask a model for more output than it
   * supports (see `docs/gateways.md`'s max-tokens capping section).
   * Deliberately left `undefined` by the OpenRouter builder always, and by
   * Vercel/Cloudflare whenever the model isn't found in the catalog or has
   * no known `maxOutputTokens` — never a guessed fallback.
   */
  maxOutputTokens?: number
  /**
   * The selected model's own catalog `pricing`, only ever set by the
   * Cloudflare builder — used to build a token-based cost estimate since
   * Cloudflare has no per-request cost API (see `estimateGatewayMessageCost`
   * in `shared/utils/gateway-pricing.ts`).
   */
  pricing?: GatewayModel['pricing']
  /**
   * The routed model's catalog `toolCall` flag, the gateway counterpart of
   * `Model.toolCall`, used by the chat route to reject a Brave/Exa send on a
   * model that cannot call tools — otherwise the search runs and is billed
   * on the user's own vendor key while the model never sees the result.
   *
   * `undefined` means the builder had no catalog entry to read it from: a
   * catalog miss, a catalog outage, or — for OpenRouter — a send that never
   * requested an external search tool and so deliberately skipped the
   * lookup. The call site treats anything other than `true` as "do not
   * offer Brave/Exa", matching `GatewayModel.toolCall`'s own documented
   * meaning, so a catalog problem produces a clean rejection rather than
   * silent spend.
   */
  toolCall?: boolean
  /**
   * Mirrors the direct-provider builders' `reasoning` field
   * (`toReasoningEffort()`'s output): the value the call site assigns to
   * `streamText`'s top-level `reasoning` option. Only ever set by the
   * OpenRouter and Vercel builders — Cloudflare has no functional reasoning
   * mechanism wired (see `isGatewayReasoningSupported` in
   * `shared/utils/gateway-capabilities.ts`), so its result never carries
   * this field and `reasoningEffort` stays `undefined` at the call site,
   * same as before this field existed.
   */
  reasoning?: 'low' | 'medium' | 'high'
}

/**
 * Dispatches to the per-gateway builder by `keyProviderId` lookup — mirrors
 * the per-provider `switch` in the chat route. Reuses `provider-meta.ts`'s
 * `keyProviderId` field for the DB key lookup instead of re-declaring a
 * `GatewayId -> keys.provider` mapping here. `requestedTools` is only ever
 * `web_search` or `image_generation` at this point (the gate in
 * `index.post.ts` already rejected anything a gateway's policy disallows) —
 * Cloudflare's builder ignores it entirely since it has no tool it could
 * wire. `requestedReasoning` is threaded to OpenRouter and Vercel only, per
 * `isGatewayReasoningSupported()` — Cloudflare's builder has no equivalent
 * parameter and simply never reasons functionally, matching its `undefined`
 * `GatewayChatResult.reasoning`.
 */
export async function useGateway(
  gatewayId: ChatGatewayId,
  userId: string,
  modelId: string,
  requestedTools: ModelTool[],
  requestedReasoning: ReasoningLevel,
  logger?: { set: (fields: Record<string, unknown>) => void },
): Promise<GatewayChatResult> {
  switch (gatewayId) {
    case 'vercel':
      return await useVercelGateway(
        userId,
        modelId,
        requestedTools,
        requestedReasoning,
        logger,
      )
    case 'openrouter':
      return await useOpenRouterGateway(
        userId,
        modelId,
        requestedTools,
        requestedReasoning,
      )
    case 'cloudflare':
      return await useCloudflareGateway(userId, modelId, logger)
  }
}

export function keyProviderIdForGateway(gatewayId: 'vercel'): 'vercel-gateway'
export function keyProviderIdForGateway(gatewayId: 'openrouter'): 'openrouter'
export function keyProviderIdForGateway(
  gatewayId: 'cloudflare',
): 'cloudflare-gateway'
export function keyProviderIdForGateway(gatewayId: GatewayId): string
export function keyProviderIdForGateway(gatewayId: GatewayId): string {
  return providerMeta[gatewayId]?.keyProviderId ?? gatewayId
}

function readMetadataRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * OpenRouter reports its billed cost synchronously in `providerMetadata` at
 * generation end — no extra round-trip needed. Safe to call on any
 * `providerMetadata`, including a direct (non-gateway) provider's, since the
 * `openrouter` key is simply absent there. Accepts `unknown` because the
 * live stream path reads it off a UI `finish-step` chunk, whose
 * `providerMetadata` is untyped there — every access below is already
 * shape-checked, so the wider parameter costs nothing at runtime.
 */
export function readOpenRouterCost(
  providerMetadata: unknown,
): number | undefined {
  const openrouter = readMetadataRecord(
    readMetadataRecord(providerMetadata)?.openrouter,
  )
  const usage = readMetadataRecord(openrouter?.usage)
  const cost = usage?.cost

  return typeof cost === 'number' ? cost : undefined
}

/**
 * Vercel AI Gateway's own billed total for one step, reported synchronously
 * as a decimal STRING in `providerMetadata.gateway.cost` — unlike
 * OpenRouter's numeric `usage.cost`, hence the parse.
 *
 * `cost` is the field that matches `getGenerationInfo()`'s `totalCost`,
 * confirmed against the live API on a turn where the figures diverge: a
 * `perplexitySearch()` send reported `cost`/`marketCost`/`gatewayCost`
 * `0.00522065` and `inferenceCost` `0.00022065`, and the async
 * `getGenerationInfo().totalCost` came back `0.00522065`. So `cost` is the
 * charge including separately-billed gateway tools, and `inferenceCost` is
 * the token-only subset — reading the latter would silently under-report
 * every gateway-bundled search. `marketCost` and `gatewayCost` only agree
 * with `cost` while `surchargeCost` is zero, so neither is a safe stand-in.
 *
 * Returns `undefined` — never `0` — for a missing or unparseable value, so
 * an unreported cost omits `totalCost` instead of displaying a free
 * generation. Safe to call on any `providerMetadata` the same way as
 * `readOpenRouterCost`.
 */
export function readVercelGatewayCost(
  providerMetadata: unknown,
): number | undefined {
  const gateway = readMetadataRecord(
    readMetadataRecord(providerMetadata)?.gateway,
  )
  const cost = gateway?.cost

  if (typeof cost === 'number') {
    return Number.isFinite(cost) ? cost : undefined
  }

  if (typeof cost !== 'string' || cost.trim() === '') {
    return undefined
  }

  const parsed = Number(cost)

  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Vercel AI Gateway's generation id, the key for the follow-up
 * `getGenerationInfo()` call (see `persistVercelGenerationCost` in
 * `./vercel.ts`). That call is now only a fallback — `readVercelGatewayCost`
 * above reads the same total synchronously — but it stays wired for a
 * response that omits the synchronous field. Safe to call on any
 * `providerMetadata` the same way as `readOpenRouterCost`.
 */
export function readVercelGenerationId(
  providerMetadata: unknown,
): string | undefined {
  const gateway = readMetadataRecord(
    readMetadataRecord(providerMetadata)?.gateway,
  )
  const generationId = gateway?.generationId

  return typeof generationId === 'string' ? generationId : undefined
}
