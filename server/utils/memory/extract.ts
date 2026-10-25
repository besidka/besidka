import type {
  ComplianceBlockedCounts,
  MemoryScope,
} from '#shared/types/memory.d'
import { and, eq } from 'drizzle-orm'
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
import { truncateProjectMemoryText } from '~~/server/utils/projects/memory'

type DbClient = ReturnType<typeof useDb>

const PASS_START_SAFETY_MS = 1000

export type MemoryExtractionStatus
  = | 'extracted'
    | 'skipped'
    | 'failed'
    | 'leased'

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
      memoryIncludeSensitive: true,
    },
  })
}

function memoryExtractionIsAllowed(
  settings: Awaited<ReturnType<typeof memoryExtractionReadSettings>>,
): boolean {
  return settings?.memoryEnabled !== false
    && settings?.memoryExtractionEnabled === true
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
  chatId: string,
  userId: number,
  extractedAt: Date,
) {
  await memoryExtractionStampChat(db, chatId, userId, {
    memoryExtractedAt: extractedAt,
    memoryExtractionAttemptedAt: null,
    memoryExtractionFailures: null,
  })
}

/**
 * Runs one extraction pass for one chat under a KV lease. Everything that
 * decides whether the pass may run (settings, chat owner, project owner,
 * dirty/idle) is re-read inside the lease. Never throws for a pass failure:
 * the failure counter on the chat is bumped and `failed` is returned. The
 * `no-user-text` and `project-unavailable` skip paths advance
 * `memoryExtractedAt` so the chat is not selected again until new activity.
 * `too-short` never advances it: the user text stays in the next window and
 * accumulates until it is long enough, and the chat is only selected again
 * once new activity arrives.
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
  const now = input.now ?? new Date()
  const passStartedAt = new Date(now.getTime() - PASS_START_SAFETY_MS)

  const settings = await memoryExtractionReadSettings(db, userId)

  if (!memoryExtractionIsAllowed(settings)) {
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
    },
  })

  if (!chat) {
    return memoryExtractionEmptyResult('skipped', 'chat-unavailable')
  }

  if (!input.ignoreIdle) {
    const isIdle = chat.activityAt.getTime()
      <= now.getTime() - MEMORY_EXTRACTION_LIMITS.idleMs
    const isDirty = !chat.memoryExtractedAt
      || chat.memoryExtractedAt < chat.activityAt

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
    await memoryExtractionAdvance(db, chat.id, userId, passStartedAt)

    return memoryExtractionEmptyResult('skipped', 'project-unavailable')
  }

  await memoryExtractionStampChat(db, chat.id, userId, {
    memoryExtractionAttemptedAt: now,
    ...(chat.memoryExtractionFailures
      === MEMORY_EXTRACTION_WAITING_FOR_TEXT_FAILURES
      ? { memoryExtractionFailures: null }
      : {}),
  })

  const result = memoryExtractionEmptyResult('extracted')

  try {
    const extractionWindow = await loadMemoryExtractionWindow(
      chat.id,
      chat.memoryExtractedAt,
      db,
      {
        createdAt: chat.createdAt,
        isShareBranch: !!chat.branchedFromShareSlug,
      },
    )

    result.messages = extractionWindow.consumedCount
    result.userChars = extractionWindow.userChars

    if (extractionWindow.userChars === 0) {
      await memoryExtractionAdvance(db, chat.id, userId, passStartedAt)

      return { ...result, status: 'skipped', reason: 'no-user-text' }
    }

    if (extractionWindow.userChars < MEMORY_EXTRACTION_LIMITS.minUserChars) {
      await memoryExtractionStampChat(db, chat.id, userId, {
        memoryExtractionFailures: MEMORY_EXTRACTION_WAITING_FOR_TEXT_FAILURES,
      })

      return { ...result, status: 'skipped', reason: 'too-short' }
    }

    const scope: MemoryScope = project ? 'project' : 'profile'
    const projectId = project?.id ?? null
    const entries = await loadMemoryExtractionIndex(userId, projectId, db)
    const legacyBlobSource = project
      && !project.memoryMigratedAt
      && project.memory?.trim()
      ? project.memory
      : null
    const legacyBlob = legacyBlobSource
      ? truncateProjectMemoryText(
        legacyBlobSource.trim(),
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
      result,
    })

    const instance = await selection.instantiate()
    const generation = await generateObject({
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
        scope,
        maxOps,
        hasLegacyBlob: !!legacyBlob,
      }),
      messages: [
        {
          role: 'user',
          content: buildMemoryExtractionPromptContent({
            scope,
            entries,
            legacyBlob,
            transcript: extractionWindow.transcript,
          }),
        },
      ],
    })

    result.usage = {
      inputTokens: generation.usage?.inputTokens ?? 0,
      outputTokens: generation.usage?.outputTokens ?? 0,
    }

    const freshSettings = await memoryExtractionReadSettings(db, userId)

    if (!memoryExtractionIsAllowed(freshSettings)) {
      return { ...result, status: 'skipped', reason: 'disabled' }
    }

    const applied = await applyMemoryExtractionOps({
      ops: generation.object.ops,
      maxOps,
      db,
      userId,
      projectId,
      chatId: chat.id,
      includeSensitive: freshSettings?.memoryIncludeSensitive === true,
      entries,
      groundingTexts: legacyBlob
        ? [...extractionWindow.userTexts, legacyBlob]
        : extractionWindow.userTexts,
      logger: input.logger,
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
        result,
        applied.created + applied.updated > 0,
      )
    }

    await memoryExtractionAdvance(
      db,
      chat.id,
      userId,
      extractionWindow.newestCreatedAt ?? passStartedAt,
    )

    return result
  } catch (exception) {
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

async function resolveExtractionModel(input: {
  db: DbClient
  userId: number
  scope: MemoryScope
  projectId: string | null
  chatId: string
  resolveCache?: Map<string, ResolvedMemoryModel>
  result: ExtractChatMemoryResult
}): Promise<ResolvedMemoryModel> {
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

async function memoryExtractionMigrateLegacyBlob(
  db: DbClient,
  projectId: string,
  userId: number,
  blob: string,
  now: Date,
  result: ExtractChatMemoryResult,
  hasAppliedChanges: boolean,
) {
  const { text, blocked } = redactNeverStore(blob)
  const isBlank = text.replaceAll(REDACTION_PLACEHOLDER, '').trim() === ''

  for (const [kind, count] of Object.entries(blocked)) {
    const blockedKind = kind as keyof ComplianceBlockedCounts

    result.blocked[blockedKind] = (result.blocked[blockedKind] ?? 0) + count
  }

  await db.update(schema.projects)
    .set(hasAppliedChanges || isBlank
      ? { memoryMigratedAt: now, memory: text }
      : { memory: text })
    .where(and(
      eq(schema.projects.id, projectId),
      eq(schema.projects.userId, userId),
    ))
}
