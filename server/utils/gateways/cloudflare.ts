import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createError } from 'evlog'
import {
  findGatewayCatalogModel,
  getCachedCloudflareGatewayCatalog,
} from './catalog'
import type { GatewayChatResult } from './index'
import { keyProviderIdForGateway } from './index'

const CLOUDFLARE_DEFAULT_GATEWAY_ID = 'default'
const CLOUDFLARE_CHARACTERS_PER_TOKEN_ESTIMATE = 2.5
const CLOUDFLARE_CONTEXT_SAFETY_MARGIN_TOKENS = 1024
const CLOUDFLARE_MIN_OUTPUT_TOKENS = 256
const CLOUDFLARE_TITLE_REASONING = 'low'

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

const TEXT_PARTS_SEPARATOR = '\n\n'

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
      content: message.content
        .map(part => part.text)
        .join(TEXT_PARTS_SEPARATOR),
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
 *   parts (a user message plus an inlined text file, or an omitted-file
 *   note), which failed with `'string' not in 'array'`.
 * Both are rewritten to the equivalent string: `''` for the null content, and
 * the text parts joined with a blank line so adjacent parts, such as a
 * message followed by a fenced file, do not run together.
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

function estimateCloudflarePromptTokens(
  body: Record<string, unknown>,
): number {
  const serializedPrompt = JSON.stringify({
    messages: body.messages,
    tools: body.tools,
  })

  return Math.ceil(
    serializedPrompt.length / CLOUDFLARE_CHARACTERS_PER_TOKEN_ESTIMATE,
  )
}

/**
 * Cloudflare's catalog reports `max_output_length` equal to the whole
 * `context_length`, and Workers AI rejects any request whose prompt plus
 * `max_tokens` exceeds the model's context window (observed live on
 * `@cf/meta/llama-3.3-70b-instruct-fp8-fast`: HTTP 400, "maximum context
 * length is 24000 tokens. However, you requested 24000 output tokens").
 * A static cap cannot be right for every prompt, so the output budget is
 * sized per request: the context minus a conservative prompt estimate
 * (serialized `messages` and `tools` at
 * `CLOUDFLARE_CHARACTERS_PER_TOKEN_ESTIMATE` characters per token, pessimistic
 * enough for Cyrillic-heavy text) minus
 * `CLOUDFLARE_CONTEXT_SAFETY_MARGIN_TOKENS`.
 * `max_tokens` is only ever lowered. When the remaining budget drops below
 * `CLOUDFLARE_MIN_OUTPUT_TOKENS`, `max_tokens` is omitted rather than
 * floored: Workers AI then applies its own 256-token default, which is the
 * behaviour a request had before `max_tokens` was sent at all, so a prompt
 * that fit the context then is never rejected now. The body is returned
 * untouched when it carries no numeric `max_tokens` (non-chat bodies) or the
 * model's context length is unknown.
 */
export function withContextSizedMaxTokens(
  body: Record<string, unknown>,
  contextLength: number | undefined,
): Record<string, unknown> {
  if (
    contextLength === undefined
    || typeof body.max_tokens !== 'number'
    || !Array.isArray(body.messages)
  ) {
    return body
  }

  const outputBudget = contextLength
    - estimateCloudflarePromptTokens(body)
    - CLOUDFLARE_CONTEXT_SAFETY_MARGIN_TOKENS

  if (outputBudget < CLOUDFLARE_MIN_OUTPUT_TOKENS) {
    const bodyWithoutMaxTokens = { ...body }

    delete bodyWithoutMaxTokens.max_tokens

    return bodyWithoutMaxTokens
  }

  return {
    ...body,
    max_tokens: Math.min(body.max_tokens, outputBudget),
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

  const catalogModel = await findGatewayCatalogModel(
    () => getCachedCloudflareGatewayCatalog(credentials, { logger }),
    model,
    logger,
  )

  const maxOutputTokens = catalogModel?.maxOutputTokens
  const client = createOpenAICompatible({
    name: 'cloudflare',
    apiKey: credentials.apiKey,
    baseURL: `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/ai/v1`,
    headers: {
      'cf-aig-gateway-id': credentials.gatewayId
        ?? CLOUDFLARE_DEFAULT_GATEWAY_ID,
    },
    transformRequestBody: (body) => {
      return withContextSizedMaxTokens(
        withStringMessageContent(body),
        catalogModel?.contextLength,
      )
    },
  })

  function getInstance() {
    return client.chatModel(model)
  }

  async function generateChatTitle(message: string) {
    return await useChatTitle(
      getInstance(),
      message,
      maxOutputTokens,
      CLOUDFLARE_TITLE_REASONING,
    )
  }

  return {
    instance: getInstance(),
    generateChatTitle,
    tools: {},
    providerOptions: {},
    maxOutputTokens,
    pricing: catalogModel?.pricing,
    toolCall: catalogModel?.toolCall,
  }
}
