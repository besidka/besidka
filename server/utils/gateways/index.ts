import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { LanguageModel, ProviderMetadata } from 'ai'
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
 * `openrouter` key is simply absent there.
 */
export function readOpenRouterCost(
  providerMetadata: ProviderMetadata | undefined,
): number | undefined {
  const openrouter = readMetadataRecord(providerMetadata?.openrouter)
  const usage = readMetadataRecord(openrouter?.usage)
  const cost = usage?.cost

  return typeof cost === 'number' ? cost : undefined
}

/**
 * Vercel AI Gateway reports only a generation id synchronously; the real
 * cost requires a follow-up `getGenerationInfo()` call (see
 * `persistVercelGenerationCost` in `./vercel.ts`). Safe to call on any
 * `providerMetadata` the same way as `readOpenRouterCost`.
 */
export function readVercelGenerationId(
  providerMetadata: ProviderMetadata | undefined,
): string | undefined {
  const gateway = readMetadataRecord(providerMetadata?.gateway)
  const generationId = gateway?.generationId

  return typeof generationId === 'string' ? generationId : undefined
}
