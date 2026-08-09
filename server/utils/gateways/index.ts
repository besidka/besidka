import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { LanguageModel, ProviderMetadata } from 'ai'
import type { GatewayProvider } from '@ai-sdk/gateway'
import type { GatewayId } from '#shared/types/gateways.d'
import type { FormattedTools } from '~~/server/types/tools.d'
import { providerMeta } from '#shared/utils/provider-meta'
import { useVercelGateway } from './vercel'
import { useOpenRouterGateway } from './openrouter'

export type ChatGatewayId = Exclude<GatewayId, 'cloudflare'>

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
}

/**
 * Dispatches to the per-gateway builder by `keyProviderId` lookup — mirrors
 * the per-provider `switch` in the chat route, but scoped to the two
 * gateways that can actually execute a completion today. Reuses
 * `provider-meta.ts`'s `keyProviderId` field for the DB key lookup instead
 * of re-declaring a `GatewayId -> keys.provider` mapping here.
 */
export async function useGateway(
  gatewayId: ChatGatewayId,
  userId: string,
  modelId: string,
): Promise<GatewayChatResult> {
  switch (gatewayId) {
    case 'vercel':
      return await useVercelGateway(userId, modelId)
    case 'openrouter':
      return await useOpenRouterGateway(userId, modelId)
  }
}

export function keyProviderIdForGateway(gatewayId: 'vercel'): 'vercel-gateway'
export function keyProviderIdForGateway(gatewayId: 'openrouter'): 'openrouter'
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
