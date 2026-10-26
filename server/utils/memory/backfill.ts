import type { GatewayId } from '#shared/types/gateways.d'
import type { ResolvedMemoryModelSelection } from '#shared/types/memory.d'
import type {
  MemoryBackfillEstimate,
  MemoryBackfillFailureReason,
  MemoryBackfillProgress,
} from '#shared/types/memory-backfill.d'
import type { SupportedProviderId } from '#shared/types/providers.d'
import {
  and,
  asc,
  desc,
  eq,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm'
import { createError } from 'evlog'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'
import * as schema from '~~/server/db/schema'
import { keyProviderIdForGateway } from '~~/server/utils/gateways/index'
import {
  getBackfillEstimate,
  invalidateBackfillEstimate,
} from '~~/server/utils/memory/backfill-estimate'
import {
  backfillAfterCursor,
  backfillEligibleChats,
  backfillWindowChats,
  resolveBackfillWindow,
} from '~~/server/utils/memory/backfill-queue'
import type { BackfillWindow } from '~~/server/utils/memory/backfill-queue'
import { memoryExtractionErrorSummary } from '~~/server/utils/memory/extract-error'
import { extractChatMemory } from '~~/server/utils/memory/extract'
import { MEMORY_EXTRACTION_LIMITS } from '~~/server/utils/memory/extract-limits'
import {
  instantiateMemoryModel,
  resolveMemoryModel,
} from '~~/server/utils/memory/resolve-model'
import type { ResolvedMemoryModel } from '~~/server/utils/memory/resolve-model'

type DbClient = ReturnType<typeof useDb>

type MemoryBackfillJobRow = typeof schema.memoryBackfillJobs.$inferSelect

type KeyProvider = typeof schema.keys.$inferSelect['provider']

type JobRef = Pick<MemoryBackfillJobRow, 'id' | 'userId'>

interface BackfillLogger {
  set: (fields: Record<string, unknown>) => void
}

export const MEMORY_BACKFILL_LIMITS = {
  abortMinFailedChats: 5,
  abortConsecutiveFailedChats: 5,
  spendLimitFactor: 1.5,
  maxChatAttempts: 2,
  keptFinishedJobs: 5,
  interactiveMinChatBudgetMs: 30_000,
  leaseMarginMs: 30_000,
} as const

const UNIQUE_CONSTRAINT_MARKER = 'UNIQUE constraint failed'
const TOKENS_PER_MILLION = 1_000_000

export type MemoryBackfillGateReason
  = 'memory-disabled'
    | 'extraction-disabled'

export type MemoryBackfillCooldownAction = 'start' | 'drive'

export interface StartBackfillInput {
  userId: number
  db?: DbClient
  logger?: BackfillLogger
  now?: Date
}

export interface AdvanceBackfillInput {
  job: JobRef
  chatsLimit: number
  deadlineMs: number
  isInteractive?: boolean
  db?: DbClient
  logger?: BackfillLogger
}

export interface AdvanceBackfillResult {
  job: MemoryBackfillProgress | null
  chatsProcessed: number
  isBusy: boolean
}

export interface SweepBackfillJobsInput {
  maxRuntimeMs: number
  db?: DbClient
  logger?: BackfillLogger
}

export interface SweepBackfillJobsResult {
  jobs: number
  chats: number
  completed: number
  failed: number
}

function isUniqueConstraintViolation(exception: unknown): boolean {
  let current: unknown = exception

  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    if (current.message.includes(UNIQUE_CONSTRAINT_MARKER)) {
      return true
    }

    current = current.cause
  }

  return false
}

function toProgress(row: MemoryBackfillJobRow): MemoryBackfillProgress {
  const isModelKnown = row.modelId !== null && row.modelSource !== null

  return {
    id: row.id,
    status: row.status,
    startedAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    totalChats: row.totalChats,
    processedChats: row.processedChats,
    createdEntries: row.createdEntries,
    updatedEntries: row.updatedEntries,
    skippedChats: row.skippedChats,
    failedChats: row.failedChats,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    failureReason: row.failureReason,
    dropped: row.dropped ?? {},
    model: isModelKnown
      ? {
        source: row.modelSource!,
        providerId: row.modelProviderId as SupportedProviderId | null,
        gatewayId: row.modelGatewayId as GatewayId | null,
        modelId: row.modelId!,
      }
      : null,
    estimate: (row.estimate as MemoryBackfillEstimate | null) ?? null,
  }
}

function ownJob(jobId: string, userId: number) {
  return and(
    eq(schema.memoryBackfillJobs.id, jobId),
    eq(schema.memoryBackfillJobs.userId, userId),
  )
}

function ownRunningJob(jobId: string, userId: number) {
  return and(
    ownJob(jobId, userId),
    eq(schema.memoryBackfillJobs.status, 'running'),
  )
}

async function readJob(
  db: DbClient,
  jobId: string,
  userId: number,
): Promise<MemoryBackfillJobRow | null> {
  const [row] = await db
    .select()
    .from(schema.memoryBackfillJobs)
    .where(ownJob(jobId, userId))
    .limit(1)

  return row ?? null
}

async function readBackfillGateReason(
  db: DbClient,
  userId: number,
): Promise<MemoryBackfillGateReason | null> {
  const settings = await db.query.userSettings.findFirst({
    where: { userId },
    columns: {
      memoryEnabled: true,
      memoryExtractionEnabled: true,
    },
  })

  if (settings?.memoryEnabled === false) {
    return 'memory-disabled'
  }

  if (settings?.memoryExtractionEnabled !== true) {
    return 'extraction-disabled'
  }

  return null
}

export async function readBackfillGate(
  userId: number,
  db: DbClient = useDb(),
): Promise<MemoryBackfillGateReason | null> {
  return await readBackfillGateReason(db, userId)
}

function cooldownKey(userId: number, action: MemoryBackfillCooldownAction) {
  return `memory-backfill-${action}:${userId}`
}

/**
 * Per-user rate limit for starting a backfill and for driving one step. KV
 * expiry has a 60 s floor, so the stamp is a timestamp compared against the
 * cooldown rather than a key that expires on its own. Answers 429 inside the
 * window and stamps the key otherwise.
 */
export async function claimBackfillCooldown(input: {
  userId: number
  action: MemoryBackfillCooldownAction
}): Promise<void> {
  const kv = useKV()
  const key = cooldownKey(input.userId, input.action)
  const lastAt = Number(await kv.get(key))
  const cooldownMs = MEMORY_EXTRACTION_LIMITS.backfillDriveCooldownSeconds
    * 1000

  if (Number.isFinite(lastAt) && Date.now() - lastAt < cooldownMs) {
    throw createError({
      message: 'Backfill was requested moments ago',
      status: 429,
      why: 'A backfill request ran less than a few seconds ago.',
      fix: 'Wait a few seconds, then try again.',
    })
  }

  await kv.put(key, String(Date.now()), { expirationTtl: 60 })
}

async function finishJob(
  db: DbClient,
  job: JobRef,
  status: 'completed' | 'cancelled' | 'failed',
  failureReason?: MemoryBackfillFailureReason,
): Promise<void> {
  await db.update(schema.memoryBackfillJobs)
    .set({
      status,
      finishedAt: new Date(),
      ...(failureReason ? { failureReason } : {}),
    })
    .where(ownRunningJob(job.id, job.userId))
  await invalidateBackfillEstimate(job.userId)
}

function selectionFromJob(
  job: MemoryBackfillJobRow,
  logger?: BackfillLogger,
): ResolvedMemoryModel | null {
  if (!job.modelId || !job.modelSource) {
    return null
  }

  const estimate = job.estimate as MemoryBackfillEstimate | null
  const selection: ResolvedMemoryModelSelection = {
    scope: 'profile',
    source: job.modelSource,
    providerId: job.modelProviderId as SupportedProviderId | null,
    gatewayId: job.modelGatewayId as GatewayId | null,
    modelId: job.modelId,
    modelName: estimate?.model?.modelName ?? job.modelId,
  }

  return {
    ...selection,
    instantiate: () => {
      return instantiateMemoryModel(selection, job.userId, logger)
    },
  }
}

async function isStoredModelKeyAvailable(
  db: DbClient,
  job: MemoryBackfillJobRow,
): Promise<boolean> {
  const provider = job.modelGatewayId
    ? keyProviderIdForGateway(job.modelGatewayId as GatewayId)
    : job.modelProviderId

  if (!provider) {
    return false
  }

  const [key] = await db
    .select({ id: schema.keys.id })
    .from(schema.keys)
    .where(and(
      eq(schema.keys.userId, job.userId),
      eq(schema.keys.provider, provider as KeyProvider),
    ))
    .limit(1)

  return !!key
}

async function countEligibleChats(
  db: DbClient,
  userId: number,
  window: BackfillWindow,
): Promise<number> {
  const capped = db
    .select({ id: schema.chats.id })
    .from(schema.chats)
    .where(backfillWindowChats(userId, window))
    .limit(MEMORY_LIMITS.backfillMaxChats)
    .as('capped_eligible_chats')
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(capped)

  return Number(row?.total ?? 0)
}

function remainingChatsUnderCap(job: MemoryBackfillJobRow): number {
  return Math.max(0, MEMORY_LIMITS.backfillMaxChats - job.processedChats)
}

async function selectNextChats(
  db: DbClient,
  job: MemoryBackfillJobRow,
  limit: number,
) {
  const cursor = backfillAfterCursor(
    job.cursorActivityAt && job.cursorChatId
      ? { activityAt: job.cursorActivityAt, chatId: job.cursorChatId }
      : null,
  )

  return await db
    .select({ id: schema.chats.id, activityAt: schema.chats.activityAt })
    .from(schema.chats)
    .where(and(
      backfillEligibleChats(job.userId, job.createdBefore),
      cursor,
    ))
    .orderBy(desc(schema.chats.activityAt), desc(schema.chats.id))
    .limit(limit)
}

async function pruneFinishedJobs(db: DbClient, userId: number) {
  const jobs = schema.memoryBackfillJobs
  const kept = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.userId, userId), ne(jobs.status, 'running')))
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(MEMORY_BACKFILL_LIMITS.keptFinishedJobs)

  if (kept.length < MEMORY_BACKFILL_LIMITS.keptFinishedJobs) {
    return
  }

  await db.delete(jobs).where(and(
    eq(jobs.userId, userId),
    ne(jobs.status, 'running'),
    notInArray(jobs.id, kept.map(row => row.id)),
  ))
}

/**
 * Starts the one backfill a user may have running: a pass over at most
 * `MEMORY_LIMITS.backfillMaxChats` account chats, newest first, as
 * `trigger: 'backfill'` extraction. The window comes from
 * `resolveBackfillWindow`: a first run reads the chats that exist now; when
 * the latest finished job stopped before its queue ran out, the new job
 * starts after that job's cursor with the same cutoff, so no chat is paid for
 * twice and older history stays reachable; when the latest job read every
 * past chat, starting is a 409 and no job is created. Needs memory on and the
 * automatic-updates opt-in on, resolves the model once (the job stores the
 * choice, so a later settings change never
 * switches models mid-run) and stores the approximate cost estimate, served
 * from the per-user cache when fresh. Chats created afterwards belong to the
 * normal sweep. A second start while one runs is a 409, enforced by the
 * unique running-job index so two requests cannot both win. Only the last few
 * finished jobs of the user are kept. Logs counts and ids only.
 */
export async function startBackfill(
  input: StartBackfillInput,
): Promise<MemoryBackfillProgress> {
  const db = input.db ?? useDb()
  const { userId, logger } = input
  const gateReason = await readBackfillGateReason(db, userId)

  if (gateReason) {
    throw createError({
      message: 'Backfill needs automatic memory updates',
      status: 409,
      why: 'Past chats are processed only while memory and automatic memory updates are both enabled.',
      fix: 'Turn on memory and automatic memory updates in settings.',
    })
  }

  const selection = await resolveMemoryModel({
    userId,
    scope: 'profile',
    db,
    logger,
  })

  if (!selection) {
    throw createError({
      message: 'No saved API key for a memory model',
      status: 409,
      why: 'Backfill needs an API key for a model that can run memory work.',
      fix: 'Add an API key in your profile or choose a memory model in settings.',
    })
  }

  const window = await resolveBackfillWindow(
    db,
    userId,
    input.now ?? new Date(),
  )

  if (!window) {
    throw createError({
      message: 'All past chats were already read',
      status: 409,
      why: 'The last backfill read every past account chat. Newer chats are added to memory automatically.',
      fix: 'Nothing to do: memory keeps updating from new chats.',
    })
  }

  const { createdBefore } = window
  const totalChats = await countEligibleChats(db, userId, window)
  let estimate: MemoryBackfillEstimate | null = null

  try {
    estimate = await getBackfillEstimate({
      userId,
      selection,
      window,
      db,
    })
  } catch (exception) {
    logger?.set({
      attributes: {
        memoryBackfill: {
          phase: 'estimate',
          error: memoryExtractionErrorSummary(exception),
        },
      },
    })
  }

  const isEmpty = totalChats === 0

  try {
    const [row] = await db.insert(schema.memoryBackfillJobs).values({
      userId,
      status: isEmpty ? 'completed' : 'running',
      finishedAt: isEmpty ? new Date() : null,
      totalChats,
      processedChats: 0,
      createdEntries: 0,
      updatedEntries: 0,
      skippedChats: 0,
      failedChats: 0,
      consecutiveFailures: 0,
      inputTokens: 0,
      outputTokens: 0,
      chatAttempts: 0,
      dropped: {},
      modelSource: selection.source,
      modelProviderId: selection.providerId,
      modelGatewayId: selection.gatewayId,
      modelId: selection.modelId,
      estimate: estimate as unknown as Record<string, unknown> | null,
      createdBefore,
      ...(window.cursor
        ? {
          cursorActivityAt: window.cursor.activityAt,
          cursorChatId: window.cursor.chatId,
        }
        : {}),
    }).returning()

    await invalidateBackfillEstimate(userId)

    try {
      await pruneFinishedJobs(db, userId)
    } catch (exception) {
      logger?.set({
        attributes: {
          memoryBackfill: {
            phase: 'prune',
            error: memoryExtractionErrorSummary(exception),
          },
        },
      })
    }

    logger?.set({
      attributes: {
        memoryBackfill: {
          phase: 'start',
          jobId: row!.id,
          totalChats,
          modelSource: selection.source,
        },
      },
    })

    return toProgress(row!)
  } catch (exception) {
    if (isUniqueConstraintViolation(exception)) {
      throw createError({
        message: 'A backfill is already running',
        status: 409,
        why: 'Only one backfill can run per account at a time.',
        fix: 'Wait for it to finish or cancel it first.',
      })
    }

    throw exception
  }
}

export async function findRunningBackfill(
  userId: number,
  db: DbClient = useDb(),
): Promise<MemoryBackfillJobRow | null> {
  const [row] = await db
    .select()
    .from(schema.memoryBackfillJobs)
    .where(and(
      eq(schema.memoryBackfillJobs.userId, userId),
      eq(schema.memoryBackfillJobs.status, 'running'),
    ))
    .limit(1)

  return row ?? null
}

/**
 * The user's running job, or else their most recent one, so a finished run
 * stays readable. `null` when they never started one.
 */
export async function getBackfillProgress(input: {
  userId: number
  db?: DbClient
}): Promise<MemoryBackfillProgress | null> {
  const db = input.db ?? useDb()
  const running = await findRunningBackfill(input.userId, db)

  if (running) {
    return toProgress(running)
  }

  const [latest] = await db
    .select()
    .from(schema.memoryBackfillJobs)
    .where(eq(schema.memoryBackfillJobs.userId, input.userId))
    .orderBy(
      desc(schema.memoryBackfillJobs.createdAt),
      desc(schema.memoryBackfillJobs.id),
    )
    .limit(1)

  return latest ? toProgress(latest) : null
}

/**
 * Marks the user's running job cancelled. Idempotent: with nothing running it
 * changes nothing and returns the latest job as it is.
 */
export async function cancelBackfill(input: {
  userId: number
  db?: DbClient
}): Promise<MemoryBackfillProgress | null> {
  const db = input.db ?? useDb()

  await db.update(schema.memoryBackfillJobs)
    .set({ status: 'cancelled', finishedAt: new Date() })
    .where(and(
      eq(schema.memoryBackfillJobs.userId, input.userId),
      eq(schema.memoryBackfillJobs.status, 'running'),
    ))

  return await getBackfillProgress({ userId: input.userId, db })
}

interface RecordedChat {
  created: number
  updated: number
  inputTokens: number
  outputTokens: number
  isSkipped: boolean
  isFailed: boolean
}

async function recordChat(
  db: DbClient,
  job: JobRef,
  chat: { id: string, activityAt: Date },
  recorded: RecordedChat,
  dropped: Record<string, number>,
): Promise<boolean> {
  const jobs = schema.memoryBackfillJobs
  const rows = await db.update(jobs)
    .set({
      processedChats: sql`${jobs.processedChats} + 1`,
      createdEntries: sql`${jobs.createdEntries} + ${recorded.created}`,
      updatedEntries: sql`${jobs.updatedEntries} + ${recorded.updated}`,
      skippedChats: sql`${jobs.skippedChats} + ${recorded.isSkipped ? 1 : 0}`,
      failedChats: sql`${jobs.failedChats} + ${recorded.isFailed ? 1 : 0}`,
      consecutiveFailures: recorded.isFailed
        ? sql`${jobs.consecutiveFailures} + 1`
        : 0,
      inputTokens: sql`${jobs.inputTokens} + ${recorded.inputTokens}`,
      outputTokens: sql`${jobs.outputTokens} + ${recorded.outputTokens}`,
      dropped,
      cursorActivityAt: chat.activityAt,
      cursorChatId: chat.id,
      retriedChatId: sql`NULL`,
      chatAttempts: 0,
    })
    .where(ownRunningJob(job.id, job.userId))
    .returning({ id: jobs.id })

  return rows.length > 0
}

async function markChatAttempt(
  db: DbClient,
  job: JobRef,
  chatId: string,
  attempt: number,
): Promise<boolean> {
  const rows = await db.update(schema.memoryBackfillJobs)
    .set({ retriedChatId: chatId, chatAttempts: attempt })
    .where(ownRunningJob(job.id, job.userId))
    .returning({ id: schema.memoryBackfillJobs.id })

  return rows.length > 0
}

function addCounts(
  target: Record<string, number>,
  source: Record<string, number | undefined>,
) {
  for (const [key, count] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + (count ?? 0)
  }
}

function isSpendLimitExceeded(job: MemoryBackfillJobRow): boolean {
  const usedTokens = job.inputTokens + job.outputTokens

  if (usedTokens >= MEMORY_LIMITS.backfillMaxTokens) {
    return true
  }

  const estimate = job.estimate as MemoryBackfillEstimate | null

  if (!estimate) {
    return false
  }

  const factor = MEMORY_BACKFILL_LIMITS.spendLimitFactor
  const price = estimate.pricePerMillion

  if (price && estimate.costUsd !== null && estimate.costUsd > 0) {
    const actualCostUsd = (job.inputTokens * price.input
      + job.outputTokens * price.output) / TOKENS_PER_MILLION

    return actualCostUsd > factor * estimate.costUsd
  }

  const estimatedTokens = estimate.inputTokens + estimate.outputTokens

  return estimatedTokens > 0
    && job.inputTokens + job.outputTokens > factor * estimatedTokens
}

function backfillAbortReason(
  job: MemoryBackfillJobRow,
): MemoryBackfillFailureReason | null {
  const limits = MEMORY_BACKFILL_LIMITS

  if (job.consecutiveFailures >= limits.abortConsecutiveFailedChats) {
    return 'consecutive-failures'
  }

  if (
    job.failedChats >= limits.abortMinFailedChats
    && job.failedChats * 2 > job.processedChats
  ) {
    return 'too-many-failures'
  }

  return isSpendLimitExceeded(job) ? 'spend-limit' : null
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

interface LeasedAdvanceInput {
  db: DbClient
  job: JobRef
  chatsLimit: number
  deadlineMs: number
  isInteractive: boolean
  logger?: BackfillLogger
}

type ExtractedChat
  = RecordedChat & { kind: 'recorded', dropped: Record<string, number> }

type ExtractOneChatResult
  = ExtractedChat
    | { kind: 'leased' }
    | { kind: 'disabled' }

function skippedChat(): ExtractedChat {
  return {
    kind: 'recorded',
    created: 0,
    updated: 0,
    inputTokens: 0,
    outputTokens: 0,
    isSkipped: true,
    isFailed: false,
    dropped: {},
  }
}

async function extractOneChat(
  db: DbClient,
  job: MemoryBackfillJobRow,
  chat: { id: string },
  selection: ResolvedMemoryModel,
  generationTimeoutMs: number | undefined,
  logger?: BackfillLogger,
): Promise<ExtractOneChatResult> {
  try {
    const outcome = await extractChatMemory({
      chat: { id: chat.id },
      userId: job.userId,
      db,
      logger,
      selection,
      trigger: 'backfill',
      ignoreIdle: true,
      ...(generationTimeoutMs === undefined ? {} : { generationTimeoutMs }),
    })

    if (outcome.status === 'leased') {
      return { kind: 'leased' }
    }

    if (outcome.status === 'skipped' && outcome.reason === 'disabled') {
      return { kind: 'disabled' }
    }

    return {
      kind: 'recorded',
      created: outcome.applied.created,
      updated: outcome.applied.updated,
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
      isSkipped: outcome.status === 'skipped',
      isFailed: outcome.status === 'failed',
      dropped: outcome.dropped,
    }
  } catch (exception) {
    logger?.set({
      attributes: {
        memoryBackfill: {
          phase: 'extract',
          jobId: job.id,
          chatId: chat.id,
          error: memoryExtractionErrorSummary(exception),
        },
      },
    })

    return {
      kind: 'recorded',
      created: 0,
      updated: 0,
      inputTokens: 0,
      outputTokens: 0,
      isSkipped: false,
      isFailed: true,
      dropped: {},
    }
  }
}

async function finishedStep(
  db: DbClient,
  job: JobRef,
  chatsProcessed: number,
): Promise<AdvanceBackfillResult> {
  const fresh = await readJob(db, job.id, job.userId)

  return {
    job: fresh ? toProgress(fresh) : null,
    chatsProcessed,
    isBusy: false,
  }
}

async function advanceLeasedBackfill(
  input: LeasedAdvanceInput,
): Promise<AdvanceBackfillResult> {
  const { db, logger, isInteractive } = input
  const limits = MEMORY_BACKFILL_LIMITS
  const startedAt = Date.now()
  const job = await readJob(db, input.job.id, input.job.userId)

  if (!job || job.status !== 'running') {
    return {
      job: job ? toProgress(job) : null,
      chatsProcessed: 0,
      isBusy: false,
    }
  }

  const gateReason = await readBackfillGateReason(db, job.userId)

  if (gateReason) {
    await finishJob(db, job, 'cancelled')

    return await finishedStep(db, job, 0)
  }

  const selection = selectionFromJob(job, logger)
  const isKeyAvailable = selection
    ? await isStoredModelKeyAvailable(db, job)
    : false

  if (!selection || !isKeyAvailable) {
    await finishJob(db, job, 'failed', 'model-unavailable')

    return await finishedStep(db, job, 0)
  }

  const remainingChats = remainingChatsUnderCap(job)

  if (remainingChats === 0) {
    await finishJob(db, job, 'completed')

    return await finishedStep(db, job, 0)
  }

  const stepLimit = Math.min(input.chatsLimit, remainingChats)
  const nextChats = await selectNextChats(db, job, stepLimit + 1)
  const batch = nextChats.slice(0, stepLimit)
  const dropped: Record<string, number> = { ...(job.dropped ?? {}) }
  let isExhausted = nextChats.length <= stepLimit
    || stepLimit === remainingChats
  let isStopped = false
  let chatsProcessed = 0
  let attemptedChatId: string | null = job.retriedChatId
  let attempts = job.chatAttempts

  for (const chat of batch) {
    const remainingMs = input.deadlineMs - (Date.now() - startedAt)
    const hasBudget = isInteractive
      ? remainingMs >= limits.interactiveMinChatBudgetMs
      : remainingMs > 0

    if (!hasBudget) {
      isExhausted = false

      break
    }

    const previousAttempts = attemptedChatId === chat.id ? attempts : 0

    if (previousAttempts >= limits.maxChatAttempts) {
      const isRecorded = await recordChat(
        db,
        job,
        chat,
        skippedChat(),
        dropped,
      )

      if (!isRecorded) {
        isStopped = true

        break
      }

      chatsProcessed += 1

      continue
    }

    attempts = previousAttempts + 1
    attemptedChatId = chat.id

    if (!(await markChatAttempt(db, job, chat.id, attempts))) {
      isStopped = true

      break
    }

    const generationTimeoutMs = isInteractive
      ? clampNumber(
        remainingMs,
        limits.interactiveMinChatBudgetMs,
        MEMORY_EXTRACTION_LIMITS.generationTimeoutMs,
      )
      : undefined
    const outcome = await extractOneChat(
      db,
      job,
      chat,
      selection,
      generationTimeoutMs,
      logger,
    )

    if (outcome.kind === 'disabled') {
      await finishJob(db, job, 'cancelled')
      isStopped = true

      break
    }

    if (outcome.kind === 'leased' && attempts < limits.maxChatAttempts) {
      isExhausted = false

      break
    }

    const recorded = outcome.kind === 'leased' ? skippedChat() : outcome

    addCounts(dropped, recorded.dropped)

    const isRecorded = await recordChat(db, job, chat, recorded, dropped)

    if (!isRecorded) {
      isStopped = true

      break
    }

    chatsProcessed += 1

    const fresh = await readJob(db, job.id, job.userId)
    const abortReason = fresh ? backfillAbortReason(fresh) : null

    if (!fresh || fresh.status !== 'running') {
      isStopped = true

      break
    }

    if (abortReason) {
      await finishJob(db, job, 'failed', abortReason)
      isStopped = true

      break
    }
  }

  if (!isStopped && isExhausted) {
    await finishJob(db, job, 'completed')
  }

  return await finishedStep(db, job, chatsProcessed)
}

async function claimJobLease(
  db: DbClient,
  job: JobRef,
  leaseMs: number,
): Promise<boolean> {
  const jobs = schema.memoryBackfillJobs
  const now = new Date()
  const rows = await db.update(jobs)
    .set({ leaseUntil: new Date(now.getTime() + leaseMs) })
    .where(and(
      ownRunningJob(job.id, job.userId),
      or(isNull(jobs.leaseUntil), lt(jobs.leaseUntil, now)),
    ))
    .returning({ id: jobs.id })

  return rows.length > 0
}

async function releaseJobLease(
  db: DbClient,
  job: JobRef,
  logger?: BackfillLogger,
): Promise<void> {
  try {
    await db.update(schema.memoryBackfillJobs)
      .set({ leaseUntil: null })
      .where(ownJob(job.id, job.userId))
  } catch (exception) {
    logger?.set({
      attributes: {
        memoryBackfill: {
          phase: 'release-lease',
          jobId: job.id,
          error: memoryExtractionErrorSummary(exception),
        },
      },
    })
  }
}

/**
 * Runs one bounded batch of a backfill job: the next `chatsLimit` chats by
 * the newest-activity keyset cursor, strictly one after the other, each as a
 * `backfill` extraction with the job's stored model. The step claims the job
 * with one atomic conditional UPDATE of `lease_until` (step deadline plus the
 * model timeout plus a margin), so the cron tick and the interactive drive
 * can never step the same job at once; the loser returns `isBusy`, and a
 * dead invocation's claim simply expires. The lease is cleared in `finally`.
 * An interactive (request-bound) step gives each chat a model timeout of the
 * remaining step budget clamped to 30-90 s and starts no chat with less than
 * 30 s left; the cron path keeps the background timeout. The chat's attempt
 * is stamped before the model call, so a chat whose invocation died, or whose
 * own lease is held, is retried once and then skipped. The job ends
 * `completed` when the cursor runs out or `backfillMaxChats` chats were
 * processed, `cancelled` when memory or automatic updates were switched off,
 * and `failed` (with a reason) when the stored model's key is gone, five
 * chats failed in a row, more than half of at least five processed chats
 * failed, or the spend limit was hit: the actual tokens cost more than 1.5x
 * the estimate, or reached `backfillMaxTokens`, a ceiling that applies even
 * when no estimate was stored. The abort check runs after every chat, so it
 * also precedes completion. Counters move with atomic increments; the
 * cursor advances only after a chat is recorded.
 */
export async function advanceBackfill(
  input: AdvanceBackfillInput,
): Promise<AdvanceBackfillResult> {
  const db = input.db ?? useDb()
  const isInteractive = input.isInteractive ?? false
  const modelTimeoutMs = isInteractive
    ? MEMORY_EXTRACTION_LIMITS.generationTimeoutMs
    : MEMORY_EXTRACTION_LIMITS.generationTimeoutBackgroundMs
  const leaseMs = input.deadlineMs + modelTimeoutMs
    + MEMORY_BACKFILL_LIMITS.leaseMarginMs
  const isClaimed = await claimJobLease(db, input.job, leaseMs)

  if (!isClaimed) {
    const job = await readJob(db, input.job.id, input.job.userId)

    return {
      job: job ? toProgress(job) : null,
      chatsProcessed: 0,
      isBusy: true,
    }
  }

  try {
    return await advanceLeasedBackfill({
      db,
      job: input.job,
      chatsLimit: input.chatsLimit,
      deadlineMs: input.deadlineMs,
      isInteractive,
      logger: input.logger,
    })
  } finally {
    await releaseJobLease(db, input.job, input.logger)
  }
}

/**
 * Services running backfill jobs for the cron tick: the least recently
 * progressed jobs first, up to `backfillJobsPerTick`, `backfillChatsPerTick`
 * chats each, inside the remaining runtime budget. A job that throws is
 * counted as failed for the tick and never stops the loop. Reports counts
 * only.
 */
export async function sweepBackfillJobs(
  input: SweepBackfillJobsInput,
): Promise<SweepBackfillJobsResult> {
  const db = input.db ?? useDb()
  const limits = MEMORY_EXTRACTION_LIMITS
  const startedAt = Date.now()
  const result: SweepBackfillJobsResult = {
    jobs: 0,
    chats: 0,
    completed: 0,
    failed: 0,
  }

  if (input.maxRuntimeMs <= 0) {
    return result
  }

  const jobs = await db
    .select({
      id: schema.memoryBackfillJobs.id,
      userId: schema.memoryBackfillJobs.userId,
    })
    .from(schema.memoryBackfillJobs)
    .where(eq(schema.memoryBackfillJobs.status, 'running'))
    .orderBy(
      asc(schema.memoryBackfillJobs.updatedAt),
      asc(schema.memoryBackfillJobs.id),
    )
    .limit(limits.backfillJobsPerTick)

  for (const job of jobs) {
    const remainingMs = input.maxRuntimeMs - (Date.now() - startedAt)

    if (remainingMs <= 0) {
      break
    }

    try {
      const step = await advanceBackfill({
        job,
        chatsLimit: limits.backfillChatsPerTick,
        deadlineMs: Math.min(limits.backfillStepDeadlineMs, remainingMs),
        db,
        logger: input.logger,
      })

      result.jobs += 1
      result.chats += step.chatsProcessed

      if (step.job?.status === 'completed') {
        result.completed += 1
      }

      if (step.job?.status === 'failed') {
        result.failed += 1
      }
    } catch (exception) {
      result.failed += 1
      input.logger?.set({
        attributes: {
          memoryBackfill: {
            phase: 'sweep',
            jobId: job.id,
            error: memoryExtractionErrorSummary(exception),
          },
        },
      })
    }
  }

  return result
}
