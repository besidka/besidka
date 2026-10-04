import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createError } from 'evlog'
import {
  findGatewayCatalogModel,
  getCachedCloudflareGatewayCatalog,
} from './catalog'
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface TextContentPart {
  type: 'text'
  text: string
}

function isTextContentPart(part: unknown): part is TextContentPart {
  return isRecord(part) && part.type === 'text' && typeof part.text === 'string'
}

function toStringMessageContent(message: unknown): unknown {
  if (!isRecord(message)) {
    return message
  }

  if (message.role === 'assistant' && message.content === null) {
    return { ...message, content: '' }
  }

  if (
    Array.isArray(message.content)
    && message.content.length > 0
    && message.content.every(isTextContentPart)
  ) {
    return {
      ...message,
      content: message.content.map(part => part.text).join(''),
    }
  }

  return message
}

/**
 * Workers AI validates each request against the routed model's own input
 * schema, and `@cf/openai/gpt-oss-*`'s schema only accepts string message
 * content, while `@ai-sdk/openai-compatible` sends two other shapes that the
 * OpenAI spec allows:
 * - an assistant turn that only holds tool calls as `content: null`, which
 *   failed every step after a tool call with `400 Bad input: Type mismatch of
 *   '/messages/N/content', 'string' not in 'null'`;
 * - a message with more than one text part as an array of `{ type: 'text' }`
 *   parts, which failed the search-answer continuation (it appends the
 *   gathered results as a second text part of the final user message) with
 *   `'string' not in 'array'`.
 * Both are rewritten to the equivalent string: `''` for the null content, and
 * the text parts joined with no separator, matching how `@ai-sdk/deepseek`
 * joins them (callers that need a break already start their part with one).
 * An array holding any non-text part (an image) is left as it is, so
 * vision-capable backends keep their multimodal content. Nothing else in the
 * body is touched.
 */
export function withStringMessageContent(
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(body.messages)) {
    return body
  }

  return {
    ...body,
    messages: body.messages.map(toStringMessageContent),
  }
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
  logger?: { set: (fields: Record<string, unknown>) => void },
): Promise<GatewayChatResult> {
  const credentials = await getCloudflareGatewayCredentials(userId)

  if (!credentials) {
    throw createError({
      message: 'Cloudflare AI Gateway credentials not found',
      status: 401,
      why: 'No Cloudflare AI Gateway credentials are set up for this '
        + 'account.',
      fix: 'Add your Cloudflare AI Gateway credentials in Profile → Keys.',
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
    transformRequestBody: withStringMessageContent,
  })
  const catalogModel = await findGatewayCatalogModel(
    () => getCachedCloudflareGatewayCatalog(credentials, { logger }),
    model,
    logger,
  )

  function getInstance() {
    return client.chatModel(model)
  }

  async function generateChatTitle(message: string) {
    return catalogModel?.maxOutputTokens === undefined
      ? await useChatTitle(getInstance(), message)
      : await useChatTitle(
        getInstance(),
        message,
        catalogModel.maxOutputTokens,
      )
  }

  return {
    instance: getInstance(),
    generateChatTitle,
    tools: {},
    providerOptions: {},
    maxOutputTokens: catalogModel?.maxOutputTokens,
    pricing: catalogModel?.pricing,
    toolCall: catalogModel?.toolCall,
  }
}
