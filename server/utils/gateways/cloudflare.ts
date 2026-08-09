import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { GatewayChatResult } from './index'
import { keyProviderIdForGateway } from './index'

const CLOUDFLARE_DEFAULT_GATEWAY_ID = 'default'

export interface CloudflareGatewayCredentials {
  accountId: string
  apiKey: string
  gatewayId?: string
}

function parseCloudflareCredentials(
  raw: string,
): CloudflareGatewayCredentials | undefined {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }

  if (!parsed || typeof parsed !== 'object') {
    return undefined
  }

  const record = parsed as Record<string, unknown>

  if (
    typeof record.accountId !== 'string'
    || typeof record.apiKey !== 'string'
  ) {
    return undefined
  }

  return {
    accountId: record.accountId,
    apiKey: record.apiKey,
    /**
     * An empty string is normalized to `undefined` here, not just at the
     * UI layer — a direct API caller could otherwise store `gatewayId: ''`
     * and defeat the builder's `?? CLOUDFLARE_DEFAULT_GATEWAY_ID` fallback,
     * sending a blank `cf-aig-gateway-id` header instead of `default`.
     */
    gatewayId: typeof record.gatewayId === 'string' && record.gatewayId
      ? record.gatewayId
      : undefined,
  }
}

/**
 * Cloudflare's credentials are stored as a single encrypted JSON blob
 * (`{accountId, gatewayId, apiKey}`) rather than a bare secret string, unlike
 * every other provider/gateway in this app — the shared `keys` table has one
 * `apiKey` text column, and `useEncryptText`/`useDecryptText` are
 * shape-agnostic string encryptors, so this is the only place that needs to
 * know about the compound shape. A stored blob that fails to parse, fails to
 * decrypt (for example after an encryption-key rotation, or a corrupted
 * row), or is missing a required field is treated the same as no key at
 * all, so none of those cases surface as an unhandled exception — only as
 * "credentials not found". Shared by the chat builder below and the gateway
 * catalog route, which both need the user's own Cloudflare account id +
 * token before they can call Cloudflare's API on the user's behalf.
 */
export async function getCloudflareGatewayCredentials(
  userId: string,
): Promise<CloudflareGatewayCredentials | undefined> {
  const data = await useDb().query.keys.findFirst({
    where: {
      userId: parseInt(userId),
      provider: keyProviderIdForGateway('cloudflare'),
    },
    columns: {
      apiKey: true,
    },
  })

  if (!data?.apiKey) {
    return undefined
  }

  let decrypted: string

  try {
    decrypted = await useDecryptText(data.apiKey)
  } catch {
    return undefined
  }

  return parseCloudflareCredentials(decrypted)
}

/**
 * Path B: the generic `@ai-sdk/openai-compatible` package against
 * Cloudflare's unified REST endpoint, rather than a dedicated Cloudflare
 * SDK. `cf-aig-gateway-id` selects the AI Gateway to route through —
 * Cloudflare auto-creates a gateway named `default` on first request, so an
 * account that never explicitly created one still works. Cloudflare's API
 * has no per-request cost field the way OpenRouter does, so `totalCost` is
 * intentionally left unset for every Cloudflare send rather than faked.
 */
export async function useCloudflareGateway(
  userId: string,
  model: string,
): Promise<GatewayChatResult> {
  const credentials = await getCloudflareGatewayCredentials(userId)

  if (!credentials) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Cloudflare AI Gateway credentials not found. Please set them up in the settings.',
    })
  }

  const client = createOpenAICompatible({
    name: 'cloudflare',
    apiKey: credentials.apiKey,
    baseURL: `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/ai/v1`,
    headers: {
      'cf-aig-gateway-id': credentials.gatewayId
        ?? CLOUDFLARE_DEFAULT_GATEWAY_ID,
    },
  })

  function getInstance() {
    return client.chatModel(model)
  }

  async function generateChatTitle(message: string) {
    return await useChatTitle(getInstance(), message)
  }

  return {
    instance: getInstance(),
    generateChatTitle,
    tools: {},
    providerOptions: {},
  }
}
