import type {
  ComplianceBlockedCounts,
  MemoryScope,
} from '#shared/types/memory.d'
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm'
import { Output, generateText } from 'ai'
import { getModel } from '#shared/utils/model'
import * as schema from '~~/server/db/schema'
import {
  detectNeverStore,
  redactNeverStore,
} from '~~/server/utils/memory/compliance'
import { REDACTION_PLACEHOLDER } from '#shared/utils/memory-policy'
import { resolveProjectAutoUpdate } from '#shared/utils/project-memory-auto-update'
import {
  isTransientMemoryExtractionError,
  memoryExtractionErrorSummary,
} from '~~/server/utils/memory/extract-error'
import { applyMemoryExtractionOps } from '~~/server/utils/memory/extract-apply'
import {
  memoryExtractionPrefilter,
  recordMemoryExtractionPrefilterOutcome,
} from '~~/server/utils/memory/extract-prefilter'
import { resolveMemoryJevChecker } from '~~/server/utils/memory/jev-check'
import {
  buildMemoryExtractionInstructions,
  memoryExtractionChunkRanges,
  buildMemoryExtractionPromptContent,
  loadMemoryExtractionIndex,
  loadMemoryExtractionWindow,
} from '~~/server/utils/memory/extract-input'
import {
  MEMORY_EXTRACTION_LIMITS,
  MEMORY_EXTRACTION_NOTHING_DURABLE_REASON,
  MEMORY_EXTRACTION_WAITING_FOR_TEXT_FAILURES,
  clampMemoryExtractionOutputTokens,
} from '~~/server/utils/memory/extract-limits'
import { memoryExtractionOutputSchema } from '~~/server/utils/memory/extract-schema'
import {
  findGatewayCatalogModel,
  getCachedGatewayCatalog,
} from '~~/server/utils/gateways/catalog'
import { resolveMemoryModel } from '~~/server/utils/memory/resolve-model'
import {
  hasCurrentLegalConsent,
  legalConsentColumns,
} from '~~/server/utils/legal/consent'
import type { ResolvedMemoryModel } from '~~/server/utils/memory/resolve-model'
import {
  acquireMemoryLease,
  memoryExtractionLeaseKey,
  noopProjectMemoryLogger,
} from '~~/server/utils/projects/memory-lease'
import type { ProjectMemoryLogger } from '~~/server/utils/projects/memory-lease'
import {
  getMemoryProviderId,
  truncateProjectMemoryText,
} from '~~/server/utils/projects/memory'

type DbClient = ReturnType<typeof useDb>

const PASS_START_SAFETY_MS = 1000

const MANUAL_PROJECT_GATE: MemoryExtractionGate = {
  trigger: 'manual',
  isProjectChat: true,
  activityAt: null,
  isExplicit: false,
}

export type MemoryExtractionStatus
  = | 'extracted'
    | 'skipped'
    | 'failed'
    | 'leased'

export type MemoryExtractionTrigger = 'sweep' | 'manual' | 'backfill'

export interface MemoryExtractionModelInfo {
  source: string | null
  providerId: string | null
  gatewayId: string | null
  modelId: string | null
  skipped: string[]
}

export interface ExtractChatMemoryInput {
  chat: { id: string }
  userId: number
  db?: DbClient
  logger?: ProjectMemoryLogger
  resolveCache?: Map<string, ResolvedMemoryModel>
  selection?: ResolvedMemoryModel
  trigger?: MemoryExtractionTrigger
  expectedProjectId?: string
  ignoreIdle?: boolean
  explicit?: boolean
  generationTimeoutMs?: number
  now?: Date
}

export interface ExtractChatMemoryResult {
  status: MemoryExtractionStatus
  reason?: string
  applied: { created: number, updated: number, deleted: number }
  dropped: Record<string, number>
  blocked: ComplianceBlockedCounts
  model: MemoryExtractionModelInfo | null
  messages: number
  userChars: number
  proposed: number
  usage: { inputTokens: number, outputTokens: number }
  isTransientFailure?: boolean
}

interface ModelResolutionLog {
  skipped?: string[]
}

class MemoryExtractionPassError extends Error {
  readonly reason: string

  constructor(reason: string) {
    super(reason)
    this.name = 'MemoryExtractionPassError'
    this.reason = reason
  }
}

function memoryExtractionEmptyResult(
  status: MemoryExtractionStatus,
  reason?: string,
): ExtractChatMemoryResult {
  return {
    status,
    reason,
    applied: { created: 0, updated: 0, deleted: 0 },
    dropped: {},
    blocked: {},
    model: null,
    messages: 0,
    userChars: 0,
    proposed: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
  }
}

function memoryExtractionErrorLabel(exception: unknown): string {
  if (exception instanceof MemoryExtractionPassError) {
    return exception.reason
  }

  const { errorName, status } = memoryExtractionErrorSummary(exception)

  return status === undefined ? errorName : `${errorName}:${status}`
}

async function memoryExtractionReadSettings(db: DbClient, userId: number) {
  return await db.query.userSettings.findFirst({
    where: { userId },
    columns: {
      memoryEnabled: true,
      memoryExtractionEnabled: true,
      memoryExtractionEnabledAt: true,
      ...legalConsentColumns,
    },
  })
}

type MemoryExtractionProjectOverride = Pick<
  typeof schema.projects.$inferSelect,
  'memoryAutoUpdate' | 'memoryAutoUpdateEnabledAt'
>

interface MemoryExtractionGate {
  trigger: MemoryExtractionTrigger
  isProjectChat: boolean
  activityAt: Date | null
  isExplicit: boolean
  project?: MemoryExtractionProjectOverride | null
}

async function memoryExtractionReadProjectOverride(
  db: DbClient,
  projectId: string | null,
  userId: number,
): Promise<MemoryExtractionProjectOverride | null> {
  if (!projectId) {
    return null
  }

  const project = await db.query.projects.findFirst({
    where: { id: projectId, userId },
    columns: { memoryAutoUpdate: true, memoryAutoUpdateEnabledAt: true },
  })

  return project ?? null
}

function memoryExtractionProjectAutoUpdate(
  settings: Awaited<ReturnType<typeof memoryExtractionReadSettings>>,
  project: MemoryExtractionProjectOverride | null | undefined,
) {
  return resolveProjectAutoUpdate(
    project ?? { memoryAutoUpdate: null, memoryAutoUpdateEnabledAt: null },
    settings,
  )
}

function memoryExtractionIsAllowed(
  settings: Awaited<ReturnType<typeof memoryExtractionReadSettings>>,
  gate: MemoryExtractionGate,
): boolean {
  if (settings?.memoryEnabled === false || !hasCurrentLegalConsent(settings)) {
    return false
  }

  if (gate.isExplicit || gate.trigger === 'manual') {
    return true
  }

  if (gate.trigger === 'backfill' || !gate.isProjectChat) {
    return settings?.memoryExtractionEnabled === true
  }

  const { isEffective, cutOver } = memoryExtractionProjectAutoUpdate(
    settings,
    gate.project,
  )

  return isEffective
    && !!cutOver
    && !!gate.activityAt
    && gate.activityAt > cutOver
}

function memoryExtractionOwnChat(chatId: string, userId: number) {
  return and(
    eq(schema.chats.id, chatId),
    eq(schema.chats.userId, userId),
  )
}

async function memoryExtractionStampChat(
  db: DbClient,
  chatId: string,
  userId: number,
  values: Partial<typeof schema.chats.$inferInsert>,
) {
  await db.update(schema.chats)
    .set(values)
    .where(memoryExtractionOwnChat(chatId, userId))
}

type MemoryExtractionAdvanceMode = 'sweep' | 'watermark' | 'backfill'

async function memoryExtractionAdvance(
  db: DbClient,
  chat: {
    id: string
    projectId: string | null
    memoryExtractedAt: Date | null
  },
  userId: number,
  extractedAt: Date,
  mode: MemoryExtractionAdvanceMode,
) {
  if (mode === 'backfill') {
    if (chat.memoryExtractedAt === null) {
      await db.update(schema.chats)
        .set({ memoryExtractedAt: extractedAt })
        .where(and(
          memoryExtractionOwnChat(chat.id, userId),
          isNull(schema.chats.memoryExtractedAt),
        ))
    }

    return
  }

  const watermark = chat.projectId
    ? { projectMemorySummaryUpdatedAt: extractedAt }
    : { memoryExtractedAt: extractedAt }

  await memoryExtractionStampChat(db, chat.id, userId, mode === 'watermark'
    ? watermark
    : {
      ...watermark,
      memoryExtractionAttemptedAt: null,
      memoryExtractionFailures: null,
    })
}

async function memoryExtractionBumpProjectMetadata(
  db: DbClient,
  projectId: string,
  userId: number,
  selection: ResolvedMemoryModel,
  now: Date,
) {
  await db.update(schema.projects)
    .set({
      memoryUpdatedAt: now,
      memoryProvider: getMemoryProviderId(selection),
      memoryModel: selection.modelId,
      memoryError: null,
      memoryStatus: sql`case when ${schema.projects.memoryDirtyAt} is not null then 'stale' else 'ready' end`,
    })
    .where(and(
      eq(schema.projects.id, projectId),
      eq(schema.projects.userId, userId),
      notInArray(schema.projects.memoryStatus, ['disabled', 'refreshing']),
    ))
}

/**
 * Runs one extraction pass for one chat under a KV lease. Everything that
 * decides whether the pass may run (settings, chat owner, project owner,
 * dirty/idle) is re-read inside the lease, and the settings gate is checked
 * again after the model call. Never throws for a pass failure: the failure
 * counter on the chat is bumped and `failed` is returned. Memory must be on for
 * every trigger. The `sweep` trigger needs the extraction opt-in for an
 * account chat. A project chat follows the project's automatic-update setting
 * (`resolveProjectAutoUpdate`): `on` or `off` on the project beat the account
 * opt-in, `inherit` follows it, and activity must be after the applicable
 * cut-over. Its window floor is the later of the project watermark and that
 * cut-over, so messages from before the opt-in are never read. The window
 * floor and the advanced stamp are the project watermark
 * (`projectMemorySummaryUpdatedAt`) for a project chat and
 * `memoryExtractedAt` otherwise. The `no-user-text` and `project-unavailable`
 * skip paths advance the watermark so the chat is not selected again until new
 * activity. `too-short` never advances it: the user text stays in the next
 * window and accumulates until it is long enough, and the chat is only
 * selected again once new activity arrives. With a TypeSafe AI key and the
 * `extractionPrefilter` role on, a window that Jev scores as holding nothing
 * durable is skipped as `nothing-durable` before the model call: it advances
 * the watermark like `no-user-text` and leaves the failure counters alone. An
 * `explicit` pass and a project pass that still carries the legacy blob are
 * never pre-filtered, and any Jev failure runs the extraction as usual. The
 * `manual` trigger (project
 * Refresh) needs no opt-in, ignores the idle/dirty rule, floors the window at
 * the project watermark only, never touches the sweep's attempt and failure
 * columns, and requires `expectedProjectId`: a chat that is no longer in that
 * project is skipped as `project-changed` without advancing any watermark, so a
 * manual pass never runs in profile scope. The chat is re-read after the model
 * call for the same reason, and a chat deleted meanwhile is skipped as
 * `chat-unavailable` so no entry cites a chat whose memory was already
 * detached. A chat the user excluded from memory is skipped as
 * `memory-excluded` for every trigger, both before and after the model call.
 * `explicit` marks a pass the user asked
 * for (extract-now): it needs only memory on, ignores the opt-in and the
 * cut-over, floors the window at the chat's own watermark, and behaves like
 * `manual` for the attempt and failure columns. The `backfill` trigger works
 * through the history of an account chat for a user who turned extraction on:
 * it needs memory and the extraction opt-in (both re-checked after the model
 * call), skips project chats, ignores the idle rule, reads the whole chat up to
 * the chat's current `memoryExtractedAt` (newer messages are left to the
 * sweep), advances `memoryExtractedAt` only when it was null, and never
 * touches the attempt and failure columns. A window that is too short is
 * skipped without touching the stamp. The caller resolves the model once and
 * passes it as `selection`.
 */
export async function extractChatMemory(
  input: ExtractChatMemoryInput,
): Promise<ExtractChatMemoryResult> {
  const logger = input.logger ?? noopProjectMemoryLogger
  const lease = await acquireMemoryLease(
    memoryExtractionLeaseKey(input.chat.id),
    logger,
  )

  if (!lease) {
    return memoryExtractionEmptyResult('leased')
  }

  try {
    return await extractLeasedChatMemory(input)
  } finally {
    await lease.release()
  }
}

async function extractLeasedChatMemory(
  input: ExtractChatMemoryInput,
): Promise<ExtractChatMemoryResult> {
  const db = input.db ?? useDb()
  const { userId } = input
  const trigger = input.trigger ?? 'sweep'
  const isManual = trigger === 'manual'
  const isBackfill = trigger === 'backfill'
  const isExplicit = input.explicit === true && !isBackfill
  const hasNoSweepBookkeeping = isManual || isExplicit
  const advanceMode: MemoryExtractionAdvanceMode = isBackfill
    ? 'backfill'
    : hasNoSweepBookkeeping ? 'watermark' : 'sweep'
  const isBackground = isBackfill
    || (trigger === 'sweep' && !input.ignoreIdle && !isExplicit)
  const now = input.now ?? new Date()
  const passStartedAt = new Date(now.getTime() - PASS_START_SAFETY_MS)

  const settings = await memoryExtractionReadSettings(db, userId)

  if (!hasCurrentLegalConsent(settings)) {
    return memoryExtractionEmptyResult('skipped', 'no-consent')
  }

  if (settings?.memoryEnabled === false) {
    return memoryExtractionEmptyResult('skipped', 'disabled')
  }

  const chat = await db.query.chats.findFirst({
    where: { id: input.chat.id, userId },
    columns: {
      id: true,
      projectId: true,
      createdAt: true,
      branchedFromShareSlug: true,
      activityAt: true,
      memoryExtractedAt: true,
      memoryExtractionAttemptedAt: true,
      memoryExtractionFailures: true,
      projectMemorySummaryUpdatedAt: true,
      memoryExcluded: true,
    },
  })

  if (!chat) {
    return memoryExtractionEmptyResult('skipped', 'chat-unavailable')
  }

  if (chat.memoryExcluded) {
    return memoryExtractionEmptyResult('skipped', 'memory-excluded')
  }

  const isProjectChat = !!chat.projectId

  if (isBackfill && isProjectChat) {
    return memoryExtractionEmptyResult('skipped', 'project-chat')
  }

  if (
    (isManual || input.expectedProjectId !== undefined)
    && (!isProjectChat || chat.projectId !== input.expectedProjectId)
  ) {
    return memoryExtractionEmptyResult('skipped', 'project-changed')
  }

  const project = chat.projectId
    ? await db.query.projects.findFirst({
      where: { id: chat.projectId, userId },
      columns: {
        id: true,
        memory: true,
        memoryStatus: true,
        memoryMigratedAt: true,
        memoryAutoUpdate: true,
        memoryAutoUpdateEnabledAt: true,
      },
    })
    : null

  const gate: MemoryExtractionGate = {
    trigger,
    isProjectChat,
    activityAt: chat.activityAt,
    isExplicit,
    project,
  }

  if (!memoryExtractionIsAllowed(settings, gate)) {
    return memoryExtractionEmptyResult('skipped', 'disabled')
  }

  const watermark = chat.projectId
    ? chat.projectMemorySummaryUpdatedAt
    : chat.memoryExtractedAt
  const cutOver = isProjectChat
    ? memoryExtractionProjectAutoUpdate(settings, project).cutOver
    : null
  const isFlooredAtCutOver = trigger === 'sweep'
    && !isExplicit
    && isProjectChat
    && !!cutOver
    && (!watermark || cutOver > watermark)
  const windowFloor = isFlooredAtCutOver ? cutOver : watermark

  if (!input.ignoreIdle && !hasNoSweepBookkeeping && !isBackfill) {
    const isIdle = chat.activityAt.getTime()
      <= now.getTime() - MEMORY_EXTRACTION_LIMITS.idleMs
    const isDirty = !watermark || watermark < chat.activityAt

    if (!isIdle || !isDirty) {
      return memoryExtractionEmptyResult('skipped', 'not-due')
    }
  }

  if (chat.projectId && (!project || project.memoryStatus === 'disabled')) {
    await memoryExtractionAdvance(
      db,
      chat,
      userId,
      passStartedAt,
      advanceMode,
    )

    return memoryExtractionEmptyResult('skipped', 'project-unavailable')
  }

  if (!hasNoSweepBookkeeping && !isBackfill) {
    await memoryExtractionStampChat(db, chat.id, userId, {
      memoryExtractionAttemptedAt: now,
      ...(chat.memoryExtractionFailures
        === MEMORY_EXTRACTION_WAITING_FOR_TEXT_FAILURES
        ? { memoryExtractionFailures: null }
        : {}),
    })
  }

  const result = memoryExtractionEmptyResult('extracted')

  try {
    const extractionWindow = await loadMemoryExtractionWindow(
      chat.id,
      isBackfill ? null : windowFloor,
      db,
      {
        createdAt: chat.createdAt,
        isShareBranch: !!chat.branchedFromShareSlug,
      },
      isBackfill ? chat.memoryExtractedAt : undefined,
    )

    result.messages = extractionWindow.consumedCount
    result.userChars = extractionWindow.userChars
    memoryExtractionAddCounts(result.blocked, extractionWindow.blocked)

    if (extractionWindow.userChars === 0) {
      await memoryExtractionAdvance(
        db,
        chat,
        userId,
        isBackfill
          ? extractionWindow.newestCreatedAt ?? passStartedAt
          : passStartedAt,
        advanceMode,
      )

      return { ...result, status: 'skipped', reason: 'no-user-text' }
    }

    if (extractionWindow.userChars < MEMORY_EXTRACTION_LIMITS.minUserChars) {
      if (!hasNoSweepBookkeeping && !isBackfill) {
        await memoryExtractionStampChat(db, chat.id, userId, {
          memoryExtractionFailures:
            MEMORY_EXTRACTION_WAITING_FOR_TEXT_FAILURES,
        })
      }

      return { ...result, status: 'skipped', reason: 'too-short' }
    }

    const legacyBlobSource = project
      && !isManual
      && !project.memoryMigratedAt
      && project.memory?.trim()
      ? project.memory
      : null
    const prefilter = isExplicit || legacyBlobSource
      ? null
      : await memoryExtractionPrefilter({
        db,
        userId,
        transcript: extractionWindow.transcript,
        logger: input.logger,
      })

    if (prefilter?.action === 'skip') {
      await memoryExtractionAdvance(
        db,
        chat,
        userId,
        isBackfill
          ? extractionWindow.newestCreatedAt ?? passStartedAt
          : passStartedAt,
        advanceMode,
      )

      return {
        ...result,
        status: 'skipped',
        reason: MEMORY_EXTRACTION_NOTHING_DURABLE_REASON,
      }
    }

    const scope: MemoryScope = project ? 'project' : 'profile'
    const projectId = project?.id ?? null
    const entries = await loadMemoryExtractionIndex(userId, projectId, db)
    const legacyBlob = legacyBlobSource
      ? truncateProjectMemoryText(
        redactNeverStore(legacyBlobSource.trim()).text,
        MEMORY_EXTRACTION_LIMITS.maxLegacyBlobChars,
      )
      : null
    const maxOps = legacyBlob
      ? MEMORY_EXTRACTION_LIMITS.maxOpsWithLegacyBlob
      : MEMORY_EXTRACTION_LIMITS.maxOpsPerPass
    const selection = await resolveExtractionModel({
      db,
      userId,
      scope,
      projectId,
      chatId: chat.id,
      resolveCache: input.resolveCache,
      selection: input.selection,
      result,
    })

    const generation = await memoryExtractionGenerate({
      selection,
      scope,
      maxOps,
      hasLegacyBlob: !!legacyBlob,
      isBackground,
      timeoutMs: input.generationTimeoutMs,
      content: buildMemoryExtractionPromptContent({
        scope,
        entries,
        legacyBlob,
        transcript: extractionWindow.transcript,
      }),
    })

    result.usage = {
      inputTokens: generation.usage?.inputTokens ?? 0,
      outputTokens: generation.usage?.outputTokens ?? 0,
    }

    const freshSettings = await memoryExtractionReadSettings(db, userId)
    const freshProject = await memoryExtractionReadProjectOverride(
      db,
      chat.projectId,
      userId,
    )

    const freshGate = { ...gate, project: freshProject }

    if (!memoryExtractionIsAllowed(freshSettings, freshGate)) {
      return { ...result, status: 'skipped', reason: 'disabled' }
    }

    const currentChat = await db.query.chats.findFirst({
      where: { id: chat.id, userId },
      columns: { projectId: true, memoryExcluded: true },
    })

    if (!currentChat) {
      return { ...result, status: 'skipped', reason: 'chat-unavailable' }
    }

    if (currentChat.memoryExcluded) {
      return { ...result, status: 'skipped', reason: 'memory-excluded' }
    }

    if ((currentChat.projectId ?? null) !== (chat.projectId ?? null)) {
      return { ...result, status: 'skipped', reason: 'project-changed' }
    }

    const applied = await applyMemoryExtractionOps({
      ops: generation.output.ops,
      maxOps,
      db,
      userId,
      projectId,
      chatId: chat.id,
      entries,
      groundingTexts: extractionWindow.userTexts,
      createGroundingTexts: legacyBlob ? [legacyBlob] : [],
      logger: input.logger,
      jev: await resolveMemoryJevChecker({ db, userId, logger: input.logger }),
    })

    result.proposed = applied.proposed
    result.applied = {
      created: applied.created,
      updated: applied.updated + applied.appended,
      deleted: applied.deleted,
    }
    result.dropped = applied.dropped
    memoryExtractionAddCounts(result.blocked, applied.blocked)

    recordMemoryExtractionPrefilterOutcome({
      maxScore: prefilter?.maxScore ?? null,
      entriesProposed: applied.proposed,
      entriesApplied: applied.created + applied.updated + applied.appended,
      logger: input.logger,
    })

    if (project && legacyBlobSource) {
      await memoryExtractionMigrateLegacyBlob(
        db,
        project.id,
        userId,
        legacyBlobSource,
        now,
        result.blocked,
        applied.created + applied.updated > 0,
      )
    }

    const advancedTo = extractionWindow.newestCreatedAt ?? passStartedAt

    await memoryExtractionAdvance(db, chat, userId, advancedTo, advanceMode)

    if (
      !isManual
      && project
      && applied.created + applied.updated + applied.deleted > 0
    ) {
      await memoryExtractionBumpProjectMetadata(
        db,
        project.id,
        userId,
        selection,
        now,
      )
    }

    return result
  } catch (exception) {
    const isTransientFailure = isTransientMemoryExtractionError(exception)

    if (hasNoSweepBookkeeping || isBackfill) {
      return {
        ...result,
        status: 'failed',
        reason: memoryExtractionErrorLabel(exception),
        isTransientFailure,
      }
    }

    const previousFailures = chat.memoryExtractionFailures ?? 0
    const hasNewActivity = !chat.memoryExtractionAttemptedAt
      || chat.activityAt > chat.memoryExtractionAttemptedAt

    await memoryExtractionStampChat(db, chat.id, userId, {
      memoryExtractionFailures: (hasNewActivity ? 0 : previousFailures) + 1,
    })

    return {
      ...result,
      status: 'failed',
      reason: memoryExtractionErrorLabel(exception),
    }
  }
}

async function memoryExtractionModelOutputLimit(
  selection: ResolvedMemoryModel,
): Promise<number | null> {
  if (!selection.gatewayId) {
    return getModel(selection.modelId).model?.maxOutputTokens ?? null
  }

  if (selection.gatewayId === 'cloudflare') {
    return null
  }

  const catalogModel = await findGatewayCatalogModel(
    () => getCachedGatewayCatalog(selection.gatewayId as 'vercel' | 'openrouter'),
    selection.modelId,
  )

  return catalogModel?.maxOutputTokens ?? null
}

function memoryExtractionTimeoutMs(isBackground: boolean | undefined) {
  return isBackground
    ? MEMORY_EXTRACTION_LIMITS.generationTimeoutBackgroundMs
    : MEMORY_EXTRACTION_LIMITS.generationTimeoutMs
}

async function memoryExtractionGenerate(input: {
  selection: ResolvedMemoryModel
  scope: MemoryScope
  maxOps: number
  hasLegacyBlob: boolean
  content: string
  isBackground?: boolean
  source?: 'chat' | 'import'
  timeoutMs?: number
}) {
  const instance = await input.selection.instantiate()
  const maxOutputTokens = clampMemoryExtractionOutputTokens(
    await memoryExtractionModelOutputLimit(input.selection),
  )

  return await generateText({
    model: instance.model,
    reasoning: instance.reasoning,
    providerOptions: {
      ...instance.providerOptions,
      openai: {
        ...instance.providerOptions.openai,
        strictJsonSchema: false,
      },
    },
    output: Output.object({
      schema: memoryExtractionOutputSchema,
      name: 'MemoryExtraction',
    }),
    maxOutputTokens,
    abortSignal: AbortSignal.timeout(
      input.timeoutMs ?? memoryExtractionTimeoutMs(input.isBackground),
    ),
    instructions: buildMemoryExtractionInstructions({
      scope: input.scope,
      maxOps: input.maxOps,
      hasLegacyBlob: input.hasLegacyBlob,
      source: input.source,
    }),
    messages: [
      {
        role: 'user',
        content: input.content,
      },
    ],
  })
}

async function resolveExtractionModel(input: {
  db: DbClient
  userId: number
  scope: MemoryScope
  projectId: string | null
  chatId: string | null
  resolveCache?: Map<string, ResolvedMemoryModel>
  selection?: ResolvedMemoryModel
  result: { model: MemoryExtractionModelInfo | null }
}): Promise<ResolvedMemoryModel> {
  if (input.selection) {
    input.result.model = {
      source: input.selection.source,
      providerId: input.selection.providerId,
      gatewayId: input.selection.gatewayId,
      modelId: input.selection.modelId,
      skipped: [],
    }

    return input.selection
  }

  const cacheKey = `${input.userId}:${input.scope}:${input.projectId ?? ''}`
  const cached = input.resolveCache?.get(cacheKey)
  const resolutionLog: { value: ModelResolutionLog | null } = { value: null }
  const selection = cached ?? await resolveMemoryModel({
    userId: input.userId,
    scope: input.scope,
    sourceChatId: input.chatId,
    projectId: input.projectId,
    db: input.db,
    logger: {
      set: (fields) => {
        const attributes = fields.attributes as
          | { memoryModel?: ModelResolutionLog }
          | undefined

        resolutionLog.value = attributes?.memoryModel ?? resolutionLog.value
      },
    },
  })
  const skipped = resolutionLog.value?.skipped ?? []

  if (!selection) {
    input.result.model = {
      source: null,
      providerId: null,
      gatewayId: null,
      modelId: null,
      skipped,
    }

    throw new MemoryExtractionPassError('no-model')
  }

  input.result.model = {
    source: selection.source,
    providerId: selection.providerId,
    gatewayId: selection.gatewayId,
    modelId: selection.modelId,
    skipped,
  }

  if (!cached && selection.source === 'setting') {
    input.resolveCache?.set(cacheKey, selection)
  }

  return selection
}

export interface ExtractProjectLegacyBlobInput {
  projectId: string
  userId: number
  selection: ResolvedMemoryModel
  db?: DbClient
  logger?: ProjectMemoryLogger
  now?: Date
}

export interface ExtractProjectLegacyBlobResult {
  status: 'migrated' | 'kept' | 'skipped' | 'failed'
  reason?: string
  applied: { created: number, updated: number, deleted: number }
  dropped: Record<string, number>
  blocked: ComplianceBlockedCounts
  proposed: number
  usage: { inputTokens: number, outputTokens: number }
  modelCalled: boolean
}

function memoryExtractionEmptyBlobResult(
  status: ExtractProjectLegacyBlobResult['status'],
  reason?: string,
): ExtractProjectLegacyBlobResult {
  return {
    status,
    reason,
    applied: { created: 0, updated: 0, deleted: 0 },
    dropped: {},
    blocked: {},
    proposed: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    modelCalled: false,
  }
}

/**
 * Converts a project's legacy `projects.memory` blob into entries without a
 * chat: the redacted blob is the only prompt material and the only grounding
 * text, so evidence must quote it, only `create` ops are accepted (anything
 * else is dropped as `invalid`), and no chat id lands in `sourceChatIds`. The
 * caller holds the project lease. The blob is marked migrated (and redacted in
 * place) only when at least one create or update was applied, or when the
 * blob is blank after redaction; otherwise it stays injected and unmarked so
 * a later refresh can retry. The blob column is never nulled. Never throws
 * for a pass failure: `failed` carries the error class label.
 */
export async function extractProjectLegacyBlob(
  input: ExtractProjectLegacyBlobInput,
): Promise<ExtractProjectLegacyBlobResult> {
  const db = input.db ?? useDb()
  const { userId, projectId } = input
  const now = input.now ?? new Date()
  const result = memoryExtractionEmptyBlobResult('kept')

  try {
    const settings = await memoryExtractionReadSettings(db, userId)

    if (!memoryExtractionIsAllowed(settings, MANUAL_PROJECT_GATE)) {
      return memoryExtractionEmptyBlobResult('skipped', 'disabled')
    }

    const project = await db.query.projects.findFirst({
      where: { id: projectId, userId },
      columns: { memory: true, memoryMigratedAt: true },
    })
    const blobSource = project?.memory?.trim()

    if (!project || project.memoryMigratedAt || !blobSource) {
      return memoryExtractionEmptyBlobResult('skipped', 'no-legacy-memory')
    }

    const redacted = redactNeverStore(blobSource)
    const isBlank = redacted.text
      .replaceAll(REDACTION_PLACEHOLDER, '')
      .trim() === ''

    if (isBlank) {
      await memoryExtractionMigrateLegacyBlob(
        db,
        projectId,
        userId,
        blobSource,
        now,
        result.blocked,
        false,
      )

      return { ...result, status: 'migrated' }
    }

    const legacyBlob = truncateProjectMemoryText(
      redacted.text.trim(),
      MEMORY_EXTRACTION_LIMITS.maxLegacyBlobChars,
    )
    const entries = await loadMemoryExtractionIndex(userId, projectId, db)
    const maxOps = MEMORY_EXTRACTION_LIMITS.maxOpsWithLegacyBlob

    result.modelCalled = true

    const generation = await memoryExtractionGenerate({
      selection: input.selection,
      scope: 'project',
      maxOps,
      hasLegacyBlob: true,
      content: buildMemoryExtractionPromptContent({
        scope: 'project',
        entries,
        legacyBlob,
        transcript: '(no chat messages)',
      }),
    })

    result.usage = {
      inputTokens: generation.usage?.inputTokens ?? 0,
      outputTokens: generation.usage?.outputTokens ?? 0,
    }

    const freshSettings = await memoryExtractionReadSettings(db, userId)

    if (!memoryExtractionIsAllowed(freshSettings, MANUAL_PROJECT_GATE)) {
      return { ...result, status: 'skipped', reason: 'disabled' }
    }

    const createOps = generation.output.ops.filter((op) => {
      return op.op === 'create'
    })
    const invalidOpsCount = generation.output.ops.length - createOps.length
    const applied = await applyMemoryExtractionOps({
      ops: createOps,
      maxOps,
      db,
      userId,
      projectId,
      chatId: null,
      entries,
      groundingTexts: [],
      createGroundingTexts: [legacyBlob],
      logger: input.logger,
      jev: await resolveMemoryJevChecker({ db, userId, logger: input.logger }),
    })

    result.proposed = applied.proposed + invalidOpsCount
    result.applied = {
      created: applied.created,
      updated: applied.updated,
      deleted: applied.deleted,
    }
    result.dropped = { ...applied.dropped }

    if (invalidOpsCount > 0) {
      result.dropped.invalid = (result.dropped.invalid ?? 0) + invalidOpsCount
    }
    result.blocked = applied.blocked

    const isMigrated = await memoryExtractionMigrateLegacyBlob(
      db,
      projectId,
      userId,
      blobSource,
      now,
      result.blocked,
      applied.created + applied.updated > 0,
    )

    return { ...result, status: isMigrated ? 'migrated' : 'kept' }
  } catch (exception) {
    return {
      ...memoryExtractionEmptyBlobResult(
        'failed',
        memoryExtractionErrorLabel(exception),
      ),
      modelCalled: result.modelCalled,
    }
  }
}

async function memoryExtractionMigrateLegacyBlob(
  db: DbClient,
  projectId: string,
  userId: number,
  blob: string,
  now: Date,
  blockedTotals: ComplianceBlockedCounts,
  hasAppliedChanges: boolean,
): Promise<boolean> {
  const { text, blocked } = redactNeverStore(blob)
  const isBlank = text.replaceAll(REDACTION_PLACEHOLDER, '').trim() === ''
  const isMigrated = hasAppliedChanges || isBlank

  for (const [kind, count] of Object.entries(blocked)) {
    const blockedKind = kind as keyof ComplianceBlockedCounts

    blockedTotals[blockedKind] = (blockedTotals[blockedKind] ?? 0) + count
  }

  await db.update(schema.projects)
    .set(isMigrated
      ? { memoryMigratedAt: now, memory: text }
      : { memory: text })
    .where(and(
      eq(schema.projects.id, projectId),
      eq(schema.projects.userId, userId),
    ))

  return isMigrated
}

export interface ExtractMemoryFromTextInput {
  userId: number
  text: string
  scope: 'profile'
  origin: 'import'
  selection?: ResolvedMemoryModel
  db?: DbClient
  logger?: ProjectMemoryLogger
  isBackground?: boolean
}

export interface ExtractMemoryFromTextResult {
  status: 'imported' | 'skipped' | 'failed' | 'leased'
  reason?: string
  applied: { created: number, updated: number, appended: number }
  dropped: Record<string, number>
  blocked: ComplianceBlockedCounts
  model: MemoryExtractionModelInfo | null
  chunks: number
  truncated: boolean
  consumedChars: number
  proposed: number
  usage: { inputTokens: number, outputTokens: number }
  modelCalled: boolean
}

export function memoryImportLeaseKey(userId: number) {
  return `memory-import-lease:${userId}`
}

function memoryExtractionEmptyTextResult(
  status: ExtractMemoryFromTextResult['status'],
  reason?: string,
): ExtractMemoryFromTextResult {
  return {
    status,
    reason,
    applied: { created: 0, updated: 0, appended: 0 },
    dropped: {},
    blocked: {},
    model: null,
    chunks: 0,
    truncated: false,
    consumedChars: 0,
    proposed: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    modelCalled: false,
  }
}

function memoryExtractionAddCounts(
  target: Record<string, number | undefined>,
  source: Record<string, number | undefined>,
) {
  for (const [key, count] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + (count ?? 0)
  }
}

function memoryExtractionRedactRange(
  text: string,
  range: { start: number, end: number },
  matches: { start: number, end: number }[],
): string {
  let redacted = ''
  let cursor = range.start

  for (const match of matches) {
    if (match.start < range.start || match.end > range.end) {
      continue
    }

    redacted += text.slice(cursor, match.start) + REDACTION_PLACEHOLDER
    cursor = match.end
  }

  return (redacted + text.slice(cursor, range.end)).trim()
}

function memoryExtractionIsBlankAfterRedaction(text: string): boolean {
  return text.replaceAll(REDACTION_PLACEHOLDER, '').trim() === ''
}

/**
 * Turns pasted text (the user's own export of what another assistant knows
 * about them) into profile entries without a chat. The text is user
 * provenance, so it grounds create, append and update alike. It is redacted of
 * never-store data before anything is sent to the model, and the redacted text
 * is also the only grounding text, so evidence must quote it. It is split into
 * chunks of `importChunkChars`, at most `importMaxChunksPerRequest` of them,
 * processed sequentially under one shared deadline (the rest is reported as
 * `truncated`); every chunk reloads the index so it sees what the previous one
 * wrote. Only `create`, `append` and `update` ops are accepted (anything else
 * is dropped as `invalid`), they pass the same compliance gate and caps as a
 * chat pass, and rows created here get the `import` origin while updated rows
 * keep theirs. Memory must be on (re-checked after each model call); the
 * extraction opt-in is not needed because the user triggers the import. One
 * import per user runs at a time under a KV lease. Never throws for a pass
 * failure and never stores or logs the text: `failed` carries a class label.
 */
export async function extractMemoryFromText(
  input: ExtractMemoryFromTextInput,
): Promise<ExtractMemoryFromTextResult> {
  const logger = input.logger ?? noopProjectMemoryLogger
  const lease = await acquireMemoryLease(
    memoryImportLeaseKey(input.userId),
    logger,
  )

  if (!lease) {
    return memoryExtractionEmptyTextResult('leased')
  }

  try {
    return await extractLeasedMemoryFromText(input)
  } finally {
    await lease.release()
  }
}

async function extractLeasedMemoryFromText(
  input: ExtractMemoryFromTextInput,
): Promise<ExtractMemoryFromTextResult> {
  const db = input.db ?? useDb()
  const { userId } = input
  const result = memoryExtractionEmptyTextResult('imported')
  const settings = await memoryExtractionReadSettings(db, userId)

  if (!hasCurrentLegalConsent(settings)) {
    return memoryExtractionEmptyTextResult('skipped', 'no-consent')
  }

  if (settings?.memoryEnabled === false) {
    return memoryExtractionEmptyTextResult('skipped', 'disabled')
  }

  const neverStoreMatches = detectNeverStore(input.text)

  for (const match of neverStoreMatches) {
    result.blocked[match.kind] = (result.blocked[match.kind] ?? 0) + 1
  }

  const allRanges = memoryExtractionChunkRanges(
    input.text,
    MEMORY_EXTRACTION_LIMITS.importChunkChars,
    neverStoreMatches,
  )
  const allChunks = allRanges.map((range) => {
    return {
      range,
      text: memoryExtractionRedactRange(input.text, range, neverStoreMatches),
    }
  })

  const hasContent = (chunk: { text: string }) => {
    return !memoryExtractionIsBlankAfterRedaction(chunk.text)
  }

  if (!allChunks.some(hasContent)) {
    return { ...result, status: 'skipped', reason: 'no-text' }
  }

  const chunks = allChunks.slice(
    0,
    MEMORY_EXTRACTION_LIMITS.importMaxChunksPerRequest,
  )
  const deadline = Date.now() + memoryExtractionTimeoutMs(input.isBackground)
  let selection: ResolvedMemoryModel | null = null
  let stopReason: string | null = null

  result.truncated = allChunks.slice(chunks.length).some(hasContent)

  const jev = await resolveMemoryJevChecker({
    db,
    userId,
    logger: input.logger,
  })

  try {
    for (const { range, text: chunk } of chunks) {
      const remainingMs = deadline - Date.now()

      const hasBudget = remainingMs
        >= MEMORY_EXTRACTION_LIMITS.importMinChunkBudgetMs

      if (result.chunks > 0 && !hasBudget) {
        result.truncated = true

        break
      }

      if (memoryExtractionIsBlankAfterRedaction(chunk)) {
        result.consumedChars = range.end

        continue
      }

      const entries = await loadMemoryExtractionIndex(userId, null, db)

      selection ??= await resolveExtractionModel({
        db,
        userId,
        scope: 'profile',
        projectId: null,
        chatId: null,
        selection: input.selection,
        result,
      })
      result.modelCalled = true

      const generation = await memoryExtractionGenerate({
        selection,
        scope: 'profile',
        maxOps: MEMORY_EXTRACTION_LIMITS.maxOpsPerImportChunk,
        hasLegacyBlob: false,
        source: 'import',
        timeoutMs: remainingMs,
        content: buildMemoryExtractionPromptContent({
          scope: 'profile',
          entries,
          legacyBlob: null,
          importedText: chunk,
          editableOrigins: [input.origin],
        }),
      })

      result.usage.inputTokens += generation.usage?.inputTokens ?? 0
      result.usage.outputTokens += generation.usage?.outputTokens ?? 0

      const freshSettings = await memoryExtractionReadSettings(db, userId)

      if (
        freshSettings?.memoryEnabled === false
        || !hasCurrentLegalConsent(freshSettings)
      ) {
        stopReason = 'disabled'

        break
      }

      const acceptedOps = generation.output.ops.filter((op) => {
        return op.op !== 'delete'
      })
      const rejectedOpsCount = generation.output.ops.length - acceptedOps.length
      const applied = await applyMemoryExtractionOps({
        ops: acceptedOps,
        maxOps: MEMORY_EXTRACTION_LIMITS.maxOpsPerImportChunk,
        db,
        userId,
        projectId: null,
        chatId: null,
        entries,
        groundingTexts: [chunk],
        origin: input.origin,
        logger: input.logger,
        jev,
      })

      result.chunks += 1
      result.consumedChars = range.end
      result.proposed += applied.proposed + rejectedOpsCount
      result.applied.created += applied.created
      result.applied.updated += applied.updated
      result.applied.appended += applied.appended
      memoryExtractionAddCounts(result.dropped, applied.dropped)
      memoryExtractionAddCounts(result.blocked, applied.blocked)

      if (rejectedOpsCount > 0) {
        result.dropped.invalid = (result.dropped.invalid ?? 0)
          + rejectedOpsCount
      }
    }
  } catch (exception) {
    stopReason = memoryExtractionErrorLabel(exception)
  }

  if (!stopReason) {
    if (!result.truncated) {
      result.consumedChars = input.text.length
    }

    return result
  }

  const hasApplied = result.applied.created
    + result.applied.updated
    + result.applied.appended > 0
  const stoppedStatus = stopReason === 'disabled' ? 'skipped' : 'failed'

  return {
    ...result,
    status: hasApplied ? 'imported' : stoppedStatus,
    reason: stopReason,
    truncated: true,
  }
}
