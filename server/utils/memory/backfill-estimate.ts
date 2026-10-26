import type { GatewayId } from '#shared/types/gateways.d'
import type { ResolvedMemoryModelSelection } from '#shared/types/memory.d'
import type {
  MemoryBackfillEstimate,
  MemoryBackfillPricePerMillion,
} from '#shared/types/memory-backfill.d'
import { sql } from 'drizzle-orm'
import { getModel } from '#shared/utils/model'
import { parsePerTokenPrice } from '#shared/utils/gateway-pricing'
import type { KnowledgeTokenFamily } from '#shared/types/project-knowledge.d'
import { estimateMemoryTokens } from '#shared/utils/memory-tokens'
import { resolveKnowledgeTokenFamily } from '#shared/utils/project-knowledge-budget'
import { KNOWLEDGE_CHARS_PER_TOKEN } from '#shared/utils/project-knowledge-policy'
import { parseUpperBoundPrice } from '~~/providers/merge'
import {
  findGatewayCatalogModel,
  getCachedCloudflareGatewayCatalog,
  getCachedGatewayCatalog,
} from '~~/server/utils/gateways/catalog'
import { getCloudflareGatewayCredentials } from '~~/server/utils/gateways/cloudflare'
import { backfillCappedChatIds } from '~~/server/utils/memory/backfill-queue'
import type { BackfillWindow } from '~~/server/utils/memory/backfill-queue'
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
const SCRIPT_SAMPLE_MESSAGES = 40
const SCRIPT_SAMPLE_MAX_CHARS = 4000
const INSTRUCTIONS_TOKENS_PER_CHAT = 2500
const OUTPUT_FRACTION_OF_TRANSCRIPT = 0.1
const MIN_OUTPUT_TOKENS_PER_CHAT = 300
const ESTIMATE_CACHE_TTL_SECONDS = 600
const ESTIMATE_FAILURE_RETRY_MS = 60_000
const ESTIMATE_COMPUTE_COOLDOWN_MS = 30_000
const KV_MIN_EXPIRATION_SECONDS = 60

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
  window?: BackfillWindow
  createdBefore?: Date
  db?: DbClient
}

function resolveEstimateWindow(input: EstimateBackfillInput): BackfillWindow {
  return input.window ?? {
    createdBefore: input.createdBefore ?? new Date(),
    cursor: null,
    isContinuation: false,
  }
}

async function readChatTotals(
  db: DbClient,
  userId: number,
  window: BackfillWindow,
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
      from ${backfillCappedChatIds(userId, window)} as capped_chats
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
  window: BackfillWindow,
): Promise<string> {
  const rows = await db.all<ScriptSampleRow>(sql`
    select json_extract(part.value, '$.text') as text
    from (
      select messages.parts as parts
      from messages
      join ${backfillCappedChatIds(userId, window)} as capped_chats
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

function selectionTokenFamily(
  selection: ResolvedMemoryModelSelection | null,
): KnowledgeTokenFamily {
  if (!selection) {
    return 'default'
  }

  return resolveKnowledgeTokenFamily({
    providerId: selection.providerId ?? '',
    modelId: selection.modelId,
    gateway: selection.gatewayId !== null,
  })
}

function tokensPerCharacter(
  sample: string,
  family: KnowledgeTokenFamily,
): number {
  if (!sample.length) {
    return 1 / KNOWLEDGE_CHARS_PER_TOKEN[family].latin
  }

  return estimateMemoryTokens(sample, family) / sample.length
}

async function estimateIndexTokens(
  db: DbClient,
  userId: number,
  family: KnowledgeTokenFamily,
): Promise<number> {
  const entries = await loadMemoryExtractionIndex(userId, null, db)

  return estimateMemoryTokens(
    renderMemoryExtractionIndex('profile', entries),
    family,
  )
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
  const window = resolveEstimateWindow(input)
  const totals = await readChatTotals(db, input.userId, window)
  const sample = totals.chats > 0
    ? await readScriptSample(db, input.userId, window)
    : ''
  const family = selectionTokenFamily(input.selection)
  const tokensPerChar = tokensPerCharacter(sample, family)
  const currentIndexTokens = await estimateIndexTokens(
    db,
    input.userId,
    family,
  )
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
    continuesPreviousRun: window.isContinuation,
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
  windowKey: string
}

interface CachedBackfillEstimateFailure {
  failedAt: number
  windowKey: string
  selectionKey: string
}

type CachedBackfillEstimateEntry
  = CachedBackfillEstimate | CachedBackfillEstimateFailure

export type BackfillEstimateLookup
  = | { status: 'ready', estimate: MemoryBackfillEstimate }
    | { status: 'failed', exception: unknown }
    | { status: 'cooldown' }

function backfillWindowKey(window: BackfillWindow): string {
  if (!window.isContinuation) {
    return 'fresh'
  }

  return [
    window.createdBefore.getTime(),
    window.cursor?.activityAt.getTime() ?? '',
    window.cursor?.chatId ?? '',
  ].join(':')
}

function backfillSelectionKey(
  selection: ResolvedMemoryModelSelection | null,
): string {
  if (!selection) {
    return 'none'
  }

  return [
    selection.source,
    selection.providerId ?? '',
    selection.gatewayId ?? '',
    selection.modelId,
  ].join(':')
}

export function backfillEstimateCacheKey(userId: number): string {
  return `memory-backfill-estimate:${userId}`
}

export function backfillEstimateComputeKey(userId: number): string {
  return `memory-backfill-estimate-compute:${userId}`
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

async function readCachedEntry(
  userId: number,
): Promise<CachedBackfillEstimateEntry | null> {
  try {
    const raw = await useKV().get(backfillEstimateCacheKey(userId))

    if (!raw) {
      return null
    }

    const parsed: unknown = JSON.parse(raw)

    return parsed && typeof parsed === 'object'
      ? parsed as CachedBackfillEstimateEntry
      : null
  } catch {
    return null
  }
}

function matchCachedEstimate(
  entry: CachedBackfillEstimateEntry | null,
  selection: ResolvedMemoryModelSelection | null,
  windowKey: string,
): MemoryBackfillEstimate | null {
  if (!entry || !('estimate' in entry) || entry.windowKey !== windowKey) {
    return null
  }

  return isSameSelection(entry.estimate, selection) ? entry.estimate : null
}

function isRecentFailure(
  entry: CachedBackfillEstimateEntry | null,
  selectionKey: string,
  windowKey: string,
  now: number,
): boolean {
  if (!entry || !('failedAt' in entry)) {
    return false
  }

  return entry.windowKey === windowKey
    && entry.selectionKey === selectionKey
    && now - entry.failedAt < ESTIMATE_FAILURE_RETRY_MS
}

async function writeCachedEntry(
  userId: number,
  entry: CachedBackfillEstimateEntry,
  expirationTtl: number,
): Promise<void> {
  try {
    await useKV().put(
      backfillEstimateCacheKey(userId),
      JSON.stringify(entry),
      { expirationTtl },
    )
  } catch {
    return
  }
}

/**
 * Claims the per-user slot for computing a fresh estimate. KV expiry has a
 * 60 s floor, so the stamp is a timestamp compared against the cooldown.
 * Answers `false` inside the cooldown. A KV failure lets the computation
 * run, the same fail-open choice as the cache itself.
 */
async function claimEstimateComputeSlot(
  userId: number,
  now: number,
): Promise<boolean> {
  try {
    const kv = useKV()
    const key = backfillEstimateComputeKey(userId)
    const lastAt = Number(await kv.get(key))

    const isCoolingDown = Number.isFinite(lastAt)
      && now - lastAt < ESTIMATE_COMPUTE_COOLDOWN_MS

    if (isCoolingDown) {
      return false
    }

    await kv.put(key, String(now), {
      expirationTtl: KV_MIN_EXPIRATION_SECONDS,
    })

    return true
  } catch {
    return true
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
 * cached figure is used only for the same resolved model and the same window
 * (a fresh run, or the continuation of one cursor); KV failures fall through
 * to a fresh computation.
 */
export async function getBackfillEstimate(
  input: EstimateBackfillInput,
): Promise<MemoryBackfillEstimate> {
  const windowKey = backfillWindowKey(resolveEstimateWindow(input))
  const cached = matchCachedEstimate(
    await readCachedEntry(input.userId),
    input.selection,
    windowKey,
  )

  if (cached) {
    return cached
  }

  const estimate = await estimateBackfill(input)

  await writeCachedEntry(
    input.userId,
    { estimate, windowKey },
    ESTIMATE_CACHE_TTL_SECONDS,
  )

  return estimate
}

/**
 * The estimate the overview GET shows, bounded against repeated requests: a
 * cached figure is served as is; a computation that failed for the same
 * model and window within the last minute is answered from a cached failure
 * marker without recomputing; any other miss computes only when the user's
 * compute slot is free (one computation per 30 seconds), otherwise it
 * answers `cooldown`. Never throws: a failed computation is returned with
 * its exception so the caller can log it.
 */
export async function lookupBackfillEstimate(
  input: EstimateBackfillInput,
): Promise<BackfillEstimateLookup> {
  const now = Date.now()
  const windowKey = backfillWindowKey(resolveEstimateWindow(input))
  const selectionKey = backfillSelectionKey(input.selection)
  const entry = await readCachedEntry(input.userId)
  const cached = matchCachedEstimate(entry, input.selection, windowKey)

  if (cached) {
    return { status: 'ready', estimate: cached }
  }

  if (isRecentFailure(entry, selectionKey, windowKey, now)) {
    return { status: 'failed', exception: null }
  }

  if (!(await claimEstimateComputeSlot(input.userId, now))) {
    return { status: 'cooldown' }
  }

  try {
    const estimate = await estimateBackfill(input)

    await writeCachedEntry(
      input.userId,
      { estimate, windowKey },
      ESTIMATE_CACHE_TTL_SECONDS,
    )

    return { status: 'ready', estimate }
  } catch (exception) {
    await writeCachedEntry(
      input.userId,
      { failedAt: now, windowKey, selectionKey },
      KV_MIN_EXPIRATION_SECONDS,
    )

    return { status: 'failed', exception }
  }
}
