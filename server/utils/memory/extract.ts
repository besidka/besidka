import type {
  ComplianceBlockedCounts,
  MemoryScope,
} from '#shared/types/memory.d'
import { and, eq, notInArray, sql } from 'drizzle-orm'
import { generateObject } from 'ai'
import * as schema from '~~/server/db/schema'
import { redactNeverStore } from '~~/server/utils/memory/compliance'
import { REDACTION_PLACEHOLDER } from '#shared/utils/memory-policy'
import { memoryExtractionErrorSummary } from '~~/server/utils/memory/extract-error'
import { applyMemoryExtractionOps } from '~~/server/utils/memory/extract-apply'
import {
  buildMemoryExtractionInstructions,
  buildMemoryExtractionPromptContent,
  loadMemoryExtractionIndex,
  loadMemoryExtractionWindow,
} from '~~/server/utils/memory/extract-input'
import {
  MEMORY_EXTRACTION_LIMITS,
  MEMORY_EXTRACTION_WAITING_FOR_TEXT_FAILURES,
} from '~~/server/utils/memory/extract-limits'
import { memoryExtractionOutputSchema } from '~~/server/utils/memory/extract-schema'
import { resolveMemoryModel } from '~~/server/utils/memory/resolve-model'
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

export type MemoryExtractionStatus
  = | 'extracted'
    | 'skipped'
    | 'failed'
    | 'leased'

export type MemoryExtractionTrigger = 'sweep' | 'manual'

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
    },
  })
}

function memoryExtractionIsAllowed(
  settings: Awaited<ReturnType<typeof memoryExtractionReadSettings>>,
  trigger: MemoryExtractionTrigger,
  isProjectChat: boolean,
): boolean {
  if (settings?.memoryEnabled === false) {
    return false
  }

  if (isProjectChat || trigger === 'manual') {
    return true
  }

  return settings?.memoryExtractionEnabled === true
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

async function memoryExtractionAdvance(
  db: DbClient,
  chat: { id: string, projectId: string | null },
  userId: number,
  extractedAt: Date,
  isManual: boolean,
) {
  const watermark = chat.projectId
    ? { projectMemorySummaryUpdatedAt: extractedAt }
    : { memoryExtractedAt: extractedAt }

  await memoryExtractionStampChat(db, chat.id, userId, isManual
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
 * dirty/idle) is re-read inside the lease. Never throws for a pass failure:
 * the failure counter on the chat is bumped and `failed` is returned. A
 * project chat needs only memory turned on and an available project of the
 * same owner, never the extraction opt-in, which governs account chats only.
 * The window floor and the advanced stamp are the project watermark
 * (`projectMemorySummaryUpdatedAt`) for a project chat, shared by the sweep
 * and the manual refresh, and `memoryExtractedAt` otherwise. The
 * `no-user-text` and `project-unavailable` skip paths advance the watermark so
 * the chat is not selected again until new activity. `too-short` never
 * advances it: the user text stays in the next window and accumulates until
 * it is long enough, and the chat is only selected again once new activity
 * arrives. The `manual` trigger ignores the idle/dirty rule, never touches
 * the sweep's attempt and failure columns, and requires `expectedProjectId`:
 * a chat that is no longer in that project (moved out or to another one) is
 * skipped as `project-changed` without advancing any watermark, so a manual
 * pass never runs in profile scope. The chat's project is re-read after the
 * model call for the same reason.
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
  const now = input.now ?? new Date()
  const passStartedAt = new Date(now.getTime() - PASS_START_SAFETY_MS)

  const settings = await memoryExtractionReadSettings(db, userId)

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
    },
  })

  if (!chat) {
    return memoryExtractionEmptyResult('skipped', 'chat-unavailable')
  }

  const isProjectChat = !!chat.projectId

  if (
    (isManual || input.expectedProjectId !== undefined)
    && (!isProjectChat || chat.projectId !== input.expectedProjectId)
  ) {
    return memoryExtractionEmptyResult('skipped', 'project-changed')
  }

  if (!memoryExtractionIsAllowed(settings, trigger, isProjectChat)) {
    return memoryExtractionEmptyResult('skipped', 'disabled')
  }

  const watermark = chat.projectId
    ? chat.projectMemorySummaryUpdatedAt
    : chat.memoryExtractedAt

  if (!input.ignoreIdle && !isManual) {
    const isIdle = chat.activityAt.getTime()
      <= now.getTime() - MEMORY_EXTRACTION_LIMITS.idleMs
    const isDirty = !watermark || watermark < chat.activityAt

    if (!isIdle || !isDirty) {
      return memoryExtractionEmptyResult('skipped', 'not-due')
    }
  }

  const project = chat.projectId
    ? await db.query.projects.findFirst({
      where: { id: chat.projectId, userId },
      columns: {
        id: true,
        memory: true,
        memoryStatus: true,
        memoryMigratedAt: true,
      },
    })
    : null

  if (chat.projectId && (!project || project.memoryStatus === 'disabled')) {
    await memoryExtractionAdvance(db, chat, userId, passStartedAt, isManual)

    return memoryExtractionEmptyResult('skipped', 'project-unavailable')
  }

  if (!isManual) {
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
      watermark,
      db,
      {
        createdAt: chat.createdAt,
        isShareBranch: !!chat.branchedFromShareSlug,
      },
    )

    result.messages = extractionWindow.consumedCount
    result.userChars = extractionWindow.userChars

    if (extractionWindow.userChars === 0) {
      await memoryExtractionAdvance(db, chat, userId, passStartedAt, isManual)

      return { ...result, status: 'skipped', reason: 'no-user-text' }
    }

    if (extractionWindow.userChars < MEMORY_EXTRACTION_LIMITS.minUserChars) {
      if (!isManual) {
        await memoryExtractionStampChat(db, chat.id, userId, {
          memoryExtractionFailures:
            MEMORY_EXTRACTION_WAITING_FOR_TEXT_FAILURES,
        })
      }

      return { ...result, status: 'skipped', reason: 'too-short' }
    }

    const scope: MemoryScope = project ? 'project' : 'profile'
    const projectId = project?.id ?? null
    const entries = await loadMemoryExtractionIndex(userId, projectId, db)
    const legacyBlobSource = project
      && !isManual
      && !project.memoryMigratedAt
      && project.memory?.trim()
      ? project.memory
      : null
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

    if (!memoryExtractionIsAllowed(freshSettings, trigger, isProjectChat)) {
      return { ...result, status: 'skipped', reason: 'disabled' }
    }

    const currentChat = await db.query.chats.findFirst({
      where: { id: chat.id, userId },
      columns: { projectId: true },
    })

    if ((currentChat?.projectId ?? null) !== (chat.projectId ?? null)) {
      return { ...result, status: 'skipped', reason: 'project-changed' }
    }

    const applied = await applyMemoryExtractionOps({
      ops: generation.object.ops,
      maxOps,
      db,
      userId,
      projectId,
      chatId: chat.id,
      entries,
      groundingTexts: extractionWindow.userTexts,
      createGroundingTexts: legacyBlob ? [legacyBlob] : [],
    })

    result.proposed = applied.proposed
    result.applied = {
      created: applied.created,
      updated: applied.updated,
      deleted: applied.deleted,
    }
    result.dropped = applied.dropped
    result.blocked = applied.blocked

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

    await memoryExtractionAdvance(db, chat, userId, advancedTo, isManual)

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
    if (isManual) {
      return {
        ...result,
        status: 'failed',
        reason: memoryExtractionErrorLabel(exception),
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

async function memoryExtractionGenerate(input: {
  selection: ResolvedMemoryModel
  scope: MemoryScope
  maxOps: number
  hasLegacyBlob: boolean
  content: string
}) {
  const instance = await input.selection.instantiate()

  return await generateObject({
    model: instance.model,
    reasoning: instance.reasoning,
    providerOptions: {
      ...instance.providerOptions,
      openai: {
        ...instance.providerOptions.openai,
        strictJsonSchema: false,
      },
    },
    schema: memoryExtractionOutputSchema,
    schemaName: 'MemoryExtraction',
    maxOutputTokens: MEMORY_EXTRACTION_LIMITS.maxOutputTokens,
    abortSignal: AbortSignal.timeout(
      MEMORY_EXTRACTION_LIMITS.generationTimeoutMs,
    ),
    instructions: buildMemoryExtractionInstructions({
      scope: input.scope,
      maxOps: input.maxOps,
      hasLegacyBlob: input.hasLegacyBlob,
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
  chatId: string
  resolveCache?: Map<string, ResolvedMemoryModel>
  selection?: ResolvedMemoryModel
  result: ExtractChatMemoryResult
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

    if (!memoryExtractionIsAllowed(settings, 'manual', true)) {
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

    if (!memoryExtractionIsAllowed(freshSettings, 'manual', true)) {
      return { ...result, status: 'skipped', reason: 'disabled' }
    }

    const createOps = generation.object.ops.filter((op) => {
      return op.op === 'create'
    })
    const invalidOpsCount = generation.object.ops.length - createOps.length
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
