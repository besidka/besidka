import type { GatewayId } from '#shared/types/gateways.d'
import type { ResolvedMemoryModelSelection } from '#shared/types/memory.d'
import type {
  MemoryBackfillEstimate,
  MemoryBackfillPricePerMillion,
} from '#shared/types/memory-backfill.d'
import { sql } from 'drizzle-orm'
import { getModel } from '#shared/utils/model'
import { parsePerTokenPrice } from '#shared/utils/gateway-pricing'
import { estimateMemoryTokens } from '#shared/utils/memory-tokens'
import { parseUpperBoundPrice } from '~~/providers/merge'
import {
  findGatewayCatalogModel,
  getCachedCloudflareGatewayCatalog,
  getCachedGatewayCatalog,
} from '~~/server/utils/gateways/catalog'
import { getCloudflareGatewayCredentials } from '~~/server/utils/gateways/cloudflare'
import { backfillCappedChatIds } from '~~/server/utils/memory/backfill-queue'
import {
  MEMORY_EXTRACTION_LIMITS,
} from '~~/server/utils/memory/extract-limits'
import {
  loadMemoryExtractionIndex,
  renderMemoryExtractionIndex,
} from '~~/server/utils/memory/extract-input'
import { PROJECT_MEMORY_LIMITS } from '~~/server/utils/projects/memory-limits'

type DbClient = ReturnType<typeof useDb>

const TOKENS_PER_MILLION = 1_000_000
const DIRECT_PRICE_TOKEN_UNIT = 1_000_000
const LATIN_CHARS_PER_TOKEN = 4
const SCRIPT_SAMPLE_MESSAGES = 40
const SCRIPT_SAMPLE_MAX_CHARS = 4000
const INSTRUCTIONS_TOKENS_PER_CHAT = 2500
const OUTPUT_FRACTION_OF_TRANSCRIPT = 0.1
const MIN_OUTPUT_TOKENS_PER_CHAT = 300
const ESTIMATE_CACHE_TTL_SECONDS = 600

interface ChatTotalsRow {
  chats: number
  user_chars: number
  transcript_chars: number
}

interface ScriptSampleRow {
  text: string | null
}

export interface EstimateBackfillInput {
  userId: number
  selection: ResolvedMemoryModelSelection | null
  createdBefore?: Date
  db?: DbClient
}

async function readChatTotals(
  db: DbClient,
  userId: number,
  createdBefore: Date,
): Promise<{ chats: number, userChars: number, transcriptChars: number }> {
  const limits = MEMORY_EXTRACTION_LIMITS
  const rows = await db.all<ChatTotalsRow>(sql`
    select
      count(*) as chats,
      coalesce(sum(min(per_chat.user_chars, ${limits.maxTranscriptChars})), 0)
        as user_chars,
      coalesce(
        sum(min(per_chat.transcript_chars, ${limits.maxTranscriptChars})),
        0
      ) as transcript_chars
    from (
      select
        capped_chats.id as chat_id,
        coalesce(sum(
          case when message.role = 'user'
            then min(
              length(json_extract(part.value, '$.text')),
              ${PROJECT_MEMORY_LIMITS.maxUserMessageChars}
            )
          end
        ), 0) as user_chars,
        coalesce(sum(
          min(
            length(json_extract(part.value, '$.text')),
            case message.role
              when 'user' then ${PROJECT_MEMORY_LIMITS.maxUserMessageChars}
              else ${PROJECT_MEMORY_LIMITS.maxAssistantMessageChars}
            end
          )
        ), 0) as transcript_chars
      from ${backfillCappedChatIds(userId, createdBefore)} as capped_chats
      join messages as message
        on message.chat_id = capped_chats.id
        and message.role in ('user', 'assistant')
      left join json_each(
        case when json_valid(message.parts) then message.parts else '[]' end
      ) as part
        on part.type = 'object'
        and json_extract(part.value, '$.type') = 'text'
      group by capped_chats.id
    ) as per_chat
  `)
  const row = rows[0]

  return {
    chats: Number(row?.chats ?? 0),
    userChars: Number(row?.user_chars ?? 0),
    transcriptChars: Number(row?.transcript_chars ?? 0),
  }
}

async function readScriptSample(
  db: DbClient,
  userId: number,
  createdBefore: Date,
): Promise<string> {
  const rows = await db.all<ScriptSampleRow>(sql`
    select json_extract(part.value, '$.text') as text
    from (
      select messages.parts as parts
      from messages
      join ${backfillCappedChatIds(userId, createdBefore)} as capped_chats
        on capped_chats.id = messages.chat_id
      where messages.role = 'user'
      order by messages.created_at desc
      limit ${SCRIPT_SAMPLE_MESSAGES}
    ) as recent
    join json_each(
      case when json_valid(recent.parts) then recent.parts else '[]' end
    ) as part
      on part.type = 'object'
      and json_extract(part.value, '$.type') = 'text'
  `)
  const sample: string[] = []
  let sampleChars = 0

  for (const row of rows) {
    if (!row.text) {
      continue
    }

    sample.push(row.text)
    sampleChars += row.text.length

    if (sampleChars >= SCRIPT_SAMPLE_MAX_CHARS) {
      break
    }
  }

  return sample.join('\n').slice(0, SCRIPT_SAMPLE_MAX_CHARS)
}

function tokensPerCharacter(sample: string): number {
  if (!sample.length) {
    return 1 / LATIN_CHARS_PER_TOKEN
  }

  return estimateMemoryTokens(sample) / sample.length
}

async function estimateIndexTokens(
  db: DbClient,
  userId: number,
): Promise<number> {
  const entries = await loadMemoryExtractionIndex(userId, null, db)

  return estimateMemoryTokens(renderMemoryExtractionIndex('profile', entries))
}

function resolveDirectPrice(
  modelId: string,
): MemoryBackfillPricePerMillion | null {
  const { model } = getModel(modelId)

  if (!model?.price || model.price.tokens !== DIRECT_PRICE_TOKEN_UNIT) {
    return null
  }

  const input = parseUpperBoundPrice(model.price.input ?? '')
  const output = parseUpperBoundPrice(model.price.output ?? '')

  if (input === null || output === null) {
    return null
  }

  return { input, output }
}

async function resolveGatewayPrice(
  userId: number,
  gatewayId: GatewayId,
  modelId: string,
): Promise<MemoryBackfillPricePerMillion | null> {
  const catalogModel = await findGatewayCatalogModel(async () => {
    if (gatewayId !== 'cloudflare') {
      return await getCachedGatewayCatalog(gatewayId)
    }

    const credentials = await getCloudflareGatewayCredentials(String(userId))

    if (!credentials) {
      return []
    }

    return await getCachedCloudflareGatewayCatalog(credentials)
  }, modelId)
  const input = parsePerTokenPrice(catalogModel?.pricing?.input)
  const output = parsePerTokenPrice(catalogModel?.pricing?.output)

  if (input === null || output === null) {
    return null
  }

  return {
    input: input * TOKENS_PER_MILLION,
    output: output * TOKENS_PER_MILLION,
  }
}

async function resolvePrice(
  userId: number,
  selection: ResolvedMemoryModelSelection,
): Promise<MemoryBackfillPricePerMillion | null> {
  if (selection.gatewayId) {
    return await resolveGatewayPrice(
      userId,
      selection.gatewayId,
      selection.modelId,
    )
  }

  return resolveDirectPrice(selection.modelId)
}

/**
 * Approximate token and dollar cost of backfilling the user's account chats
 * with `selection`. Character totals come from SQL over `messages.parts` with
 * `json_each` (user text and assistant text are each capped per message the
 * way the extraction window caps them, then per chat at the transcript
 * budget), so the chat text is never loaded; only a small recent sample of
 * user text is read to measure the Latin/Cyrillic mix for the token
 * conversion. Every pass also carries the instructions and the memory index,
 * which for many short chats dominates, so the index is priced at the
 * midpoint between its current size and its full budget. Unknown prices give
 * `null`, never a guess. Everything is labelled approximate.
 */
export async function estimateBackfill(
  input: EstimateBackfillInput,
): Promise<MemoryBackfillEstimate> {
  const db = input.db ?? useDb()
  const createdBefore = input.createdBefore ?? new Date()
  const totals = await readChatTotals(db, input.userId, createdBefore)
  const sample = totals.chats > 0
    ? await readScriptSample(db, input.userId, createdBefore)
    : ''
  const tokensPerChar = tokensPerCharacter(sample)
  const currentIndexTokens = await estimateIndexTokens(db, input.userId)
  const maxIndexTokens = Math.ceil(
    MEMORY_EXTRACTION_LIMITS.indexBodyBudgetChars * tokensPerChar,
  )
  const overheadTokensPerChat = INSTRUCTIONS_TOKENS_PER_CHAT
    + Math.ceil((currentIndexTokens + maxIndexTokens) / 2)
  const transcriptTokens = Math.ceil(totals.transcriptChars * tokensPerChar)
  const inputTokens = transcriptTokens + totals.chats * overheadTokensPerChat
  const averageTranscriptTokens = totals.chats > 0
    ? transcriptTokens / totals.chats
    : 0
  const outputTokensPerChat = Math.min(
    MEMORY_EXTRACTION_LIMITS.maxOutputTokens,
    Math.max(
      MIN_OUTPUT_TOKENS_PER_CHAT,
      Math.ceil(averageTranscriptTokens * OUTPUT_FRACTION_OF_TRANSCRIPT),
    ),
  )
  const outputTokens = totals.chats * outputTokensPerChat
  const pricePerMillion = input.selection
    ? await resolvePrice(input.userId, input.selection)
    : null
  const costUsd = pricePerMillion
    ? (inputTokens * pricePerMillion.input
      + outputTokens * pricePerMillion.output) / TOKENS_PER_MILLION
    : null

  return {
    chats: totals.chats,
    userChars: totals.userChars,
    transcriptChars: totals.transcriptChars,
    inputTokens,
    outputTokens,
    overheadTokensPerChat,
    pricePerMillion,
    costUsd,
    approximate: true,
    model: input.selection
      ? {
        source: input.selection.source,
        providerId: input.selection.providerId,
        gatewayId: input.selection.gatewayId,
        modelId: input.selection.modelId,
        modelName: input.selection.modelName,
      }
      : null,
  }
}

interface CachedBackfillEstimate {
  estimate: MemoryBackfillEstimate
}

export function backfillEstimateCacheKey(userId: number): string {
  return `memory-backfill-estimate:${userId}`
}

function isSameSelection(
  estimate: MemoryBackfillEstimate,
  selection: ResolvedMemoryModelSelection | null,
): boolean {
  if (!selection) {
    return estimate.model === null
  }

  return estimate.model?.source === selection.source
    && estimate.model.providerId === selection.providerId
    && estimate.model.gatewayId === selection.gatewayId
    && estimate.model.modelId === selection.modelId
}

async function readCachedEstimate(
  userId: number,
  selection: ResolvedMemoryModelSelection | null,
): Promise<MemoryBackfillEstimate | null> {
  try {
    const raw = await useKV().get(backfillEstimateCacheKey(userId))

    if (!raw) {
      return null
    }

    const cached = JSON.parse(raw) as CachedBackfillEstimate

    return isSameSelection(cached.estimate, selection)
      ? cached.estimate
      : null
  } catch {
    return null
  }
}

async function writeCachedEstimate(
  userId: number,
  estimate: MemoryBackfillEstimate,
): Promise<void> {
  try {
    await useKV().put(
      backfillEstimateCacheKey(userId),
      JSON.stringify({ estimate } satisfies CachedBackfillEstimate),
      { expirationTtl: ESTIMATE_CACHE_TTL_SECONDS },
    )
  } catch {
    return
  }
}

/**
 * Drops the user's cached estimate. Best effort: a KV failure only means the
 * next read may serve a figure up to ten minutes old.
 */
export async function invalidateBackfillEstimate(
  userId: number,
): Promise<void> {
  try {
    await useKV().delete(backfillEstimateCacheKey(userId))
  } catch {
    return
  }
}

/**
 * `estimateBackfill` behind a per-user KV cache (10 minutes), so repeated
 * page loads and the start request do not each rerun the heavy aggregate. A
 * cached figure is used only for the same resolved model; KV failures fall
 * through to a fresh computation.
 */
export async function getBackfillEstimate(
  input: EstimateBackfillInput,
): Promise<MemoryBackfillEstimate> {
  const cached = await readCachedEstimate(input.userId, input.selection)

  if (cached) {
    return cached
  }

  const estimate = await estimateBackfill(input)

  await writeCachedEstimate(input.userId, estimate)

  return estimate
}
