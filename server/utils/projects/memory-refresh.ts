import type { ProjectMemoryStatus } from '#shared/types/projects.d'
import { and, eq, ne } from 'drizzle-orm'
import { createError } from 'evlog'
import * as schema from '~~/server/db/schema'
import { extractChatMemory, extractProjectLegacyBlob } from '~~/server/utils/memory/extract'
import { memoryExtractionErrorSummary } from '~~/server/utils/memory/extract-error'
import { MEMORY_EXTRACTION_LIMITS } from '~~/server/utils/memory/extract-limits'
import { resolveMemoryModel } from '~~/server/utils/memory/resolve-model'
import {
  hasUserLegalConsent,
  requireLegalConsent,
} from '~~/server/utils/legal/consent'
import type { ResolvedMemoryModel } from '~~/server/utils/memory/resolve-model'
import { getMemoryProviderId } from '~~/server/utils/projects/memory'
import { buildProjectMemoryCard } from '~~/server/utils/projects/memory-card'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  acquireProjectMemoryLease,
  noopProjectMemoryLogger,
} from '~~/server/utils/projects/memory-lease'
import type { ProjectMemoryLogger } from '~~/server/utils/projects/memory-lease'
import { PROJECT_MEMORY_LIMITS } from '~~/server/utils/projects/memory-limits'
import {
  applyProjectMemoryEnabled,
  projectHasMemoryEntries,
} from '~~/server/utils/projects/memory-toggle'

type DbClient = ReturnType<typeof useDb>

const NO_KEY_ERROR = 'No saved API key is available for project memory.'
const BLOB_NOT_CONVERTED_NOTICE
  = 'Existing project memory could not be converted automatically; it is kept as is.'

export function projectMemoryRefreshCooldownKey(projectId: string) {
  return `project-memory-refresh-cooldown:${projectId}`
}

interface RefreshPassState {
  modelCalled: boolean
}

export interface RefreshProjectMemoryFromChatsInput {
  projectId: string
  userId: number
  db?: DbClient
  logger?: ProjectMemoryLogger
}

interface RefreshTotals {
  created: number
  updated: number
  deleted: number
}

async function isRefreshCoolingDown(
  projectId: string,
  logger: ProjectMemoryLogger,
) {
  try {
    const cooldownKey = projectMemoryRefreshCooldownKey(projectId)
    const cooldown = await useKV().get(cooldownKey)

    return !!cooldown
  } catch (exception) {
    logger.set({
      attributes: {
        projectMemoryRefreshCooldown: {
          operation: 'get',
          error: exceptionMessage(exception),
        },
      },
    })

    return false
  }
}

async function startRefreshCooldown(
  projectId: string,
  logger: ProjectMemoryLogger,
) {
  try {
    await useKV().put(projectMemoryRefreshCooldownKey(projectId), '1', {
      expirationTtl: MEMORY_EXTRACTION_LIMITS.extractNowCooldownSeconds,
    })
  } catch (exception) {
    logger.set({
      attributes: {
        projectMemoryRefreshCooldown: {
          operation: 'put',
          error: exceptionMessage(exception),
        },
      },
    })
  }
}

function errorClassLabel(exception: unknown): string {
  const { errorName, status } = memoryExtractionErrorSummary(exception)

  return status === undefined ? errorName : `${errorName}:${status}`
}

async function writeRefreshState(
  db: DbClient,
  projectId: string,
  userId: number,
  values: Partial<typeof schema.projects.$inferInsert> & {
    memoryStatus?: ProjectMemoryStatus
  },
) {
  await db.update(schema.projects)
    .set(values)
    .where(and(
      eq(schema.projects.id, projectId),
      eq(schema.projects.userId, userId),
      ne(schema.projects.memoryStatus, 'disabled'),
    ))
}

async function readUserMemoryEnabled(db: DbClient, userId: number) {
  const settings = await db.query.userSettings.findFirst({
    where: { userId },
    columns: { memoryEnabled: true },
  })

  return settings?.memoryEnabled !== false
}

function isDirtiedDuringPass(
  currentDirtyAt: Date | null,
  snapshotDirtyAt: Date | null,
) {
  if (!currentDirtyAt) {
    return false
  }

  if (!snapshotDirtyAt) {
    return true
  }

  return currentDirtyAt.getTime() > snapshotDirtyAt.getTime()
}

async function selectChatsWithUnreadUserText(
  db: DbClient,
  projectId: string,
  userId: number,
) {
  const recentChats = await db.query.chats.findMany({
    where: {
      userId,
      projectId,
      OR: [
        { memoryExcluded: { isNull: true } },
        { memoryExcluded: false },
      ],
    },
    columns: { id: true, projectMemorySummaryUpdatedAt: true },
    orderBy: { activityAt: 'desc' },
    limit: PROJECT_MEMORY_LIMITS.maxChatsConsidered,
  })
  const eligibleChatIds: string[] = []

  for (const chat of recentChats) {
    const watermark = chat.projectMemorySummaryUpdatedAt
    const unreadMessage = await db.query.messages.findFirst({
      where: {
        chatId: chat.id,
        role: 'user',
        ...(watermark ? { createdAt: { gt: watermark } } : {}),
      },
      columns: { id: true },
    })

    if (unreadMessage) {
      eligibleChatIds.push(chat.id)
    }
  }

  return { consideredCount: recentChats.length, eligibleChatIds }
}

/**
 * The explicit "Refresh memory" action: extracts a project's memory into
 * project-scope entries. The click is the user's consent for this project, so
 * it needs memory on but not the background extraction opt-in. Under the
 * project lease it converts the legacy blob first (blob-only pass), then reads
 * at most `projectRefreshMaxChatsPerClick` chats that have user text newer
 * than their own refresh watermark, strictly one after the other, with one
 * model resolved once. Chats left over, or a message that arrived during the
 * pass, keep the project `stale`; a pass where every processed chat failed
 * marks it `failed` and leaves the entries untouched. Every state write skips
 * a project that was disabled meanwhile. Returns the card.
 */
export async function refreshProjectMemoryFromChats(
  input: RefreshProjectMemoryFromChatsInput,
) {
  const db = input.db ?? useDb()
  const logger = input.logger ?? noopProjectMemoryLogger
  const { projectId, userId } = input
  const project = await db.query.projects.findFirst({
    where: { id: projectId, userId },
    columns: {
      id: true,
      memory: true,
      memoryStatus: true,
      memoryDirtyAt: true,
      memoryMigratedAt: true,
    },
  })

  if (!project) {
    throw createError({
      message: 'Project not found',
      status: 404,
    })
  }

  if (project.memoryStatus === 'disabled') {
    return await buildProjectMemoryCard(project.id, userId, db, logger)
  }

  await requireLegalConsent(userId, db)

  if (!await readUserMemoryEnabled(db, userId)) {
    throw createError({
      message: 'Memory is turned off',
      status: 409,
      why: 'Project memory needs memory to be turned on for the account.',
      fix: 'Turn memory on in the settings.',
    })
  }

  if (await isRefreshCoolingDown(project.id, logger)) {
    throw createError({
      message: 'Project memory was refreshed moments ago',
      status: 429,
      why: 'A refresh already ran in the last minute.',
      fix: 'Try again in a minute.',
    })
  }

  const lease = await acquireProjectMemoryLease(project.id, logger)

  if (!lease) {
    return await buildProjectMemoryCard(project.id, userId, db, logger)
  }

  try {
    await runLeasedRefresh(project, userId, db, logger)
  } finally {
    await lease.release()
  }

  return await buildProjectMemoryCard(project.id, userId, db, logger)
}

async function runLeasedRefresh(
  project: {
    id: string
    memory: string | null
    memoryDirtyAt: Date | null
    memoryMigratedAt: Date | null
  },
  userId: number,
  db: DbClient,
  logger: ProjectMemoryLogger,
) {
  const passState: RefreshPassState = { modelCalled: false }

  try {
    const selection = await resolveMemoryModel({
      userId,
      scope: 'project',
      projectId: project.id,
      db,
      logger,
    })

    if (!selection) {
      await writeRefreshState(db, project.id, userId, {
        memoryStatus: 'unavailable',
        memoryDirtyAt: new Date(),
        memoryProvider: null,
        memoryModel: null,
        memoryError: NO_KEY_ERROR,
      })

      return
    }

    await writeRefreshState(db, project.id, userId, {
      memoryStatus: 'refreshing',
      memoryProvider: getMemoryProviderId(selection),
      memoryModel: selection.modelId,
      memoryError: null,
    })

    await refreshWithSelection(
      project,
      userId,
      selection,
      db,
      logger,
      passState,
    )
  } catch (exception) {
    const reasonLabel = errorClassLabel(exception)

    await writeRefreshState(db, project.id, userId, {
      memoryStatus: 'failed',
      memoryDirtyAt: new Date(),
      memoryError: reasonLabel,
    })

    throw createError({
      message: 'Project memory refresh failed',
      status: 502,
      why: reasonLabel,
    })
  } finally {
    if (passState.modelCalled) {
      await startRefreshCooldown(project.id, logger)
    }
  }
}

async function refreshWithSelection(
  project: {
    id: string
    memory: string | null
    memoryDirtyAt: Date | null
    memoryMigratedAt: Date | null
  },
  userId: number,
  selection: ResolvedMemoryModel,
  db: DbClient,
  logger: ProjectMemoryLogger,
  passState: RefreshPassState,
) {
  const startedAt = Date.now()
  const totals: RefreshTotals = { created: 0, updated: 0, deleted: 0 }
  let blobNotice: string | null = null
  let blobStatus: string | null = null

  if (!project.memoryMigratedAt && project.memory?.trim()) {
    const blobResult = await extractProjectLegacyBlob({
      projectId: project.id,
      userId,
      selection,
      db,
      logger,
    })

    blobStatus = blobResult.status

    if (blobResult.modelCalled) {
      passState.modelCalled = true
    }

    totals.created += blobResult.applied.created
    totals.updated += blobResult.applied.updated
    totals.deleted += blobResult.applied.deleted

    if (blobResult.status === 'kept' || blobResult.status === 'failed') {
      blobNotice = BLOB_NOT_CONVERTED_NOTICE
    }
  }

  const {
    consideredCount,
    eligibleChatIds,
  } = await selectChatsWithUnreadUserText(db, project.id, userId)
  const maxProcessed = MEMORY_EXTRACTION_LIMITS.projectRefreshMaxChatsPerClick
  let processedCount = 0
  let failedCount = 0
  let leftoverCount = 0
  let firstFailureReason: string | null = null
  let isStopped = false

  for (const [chatIndex, chatId] of eligibleChatIds.entries()) {
    const isOutOfTime = Date.now() - startedAt
      >= MEMORY_EXTRACTION_LIMITS.projectRefreshMaxRuntimeMs

    if (processedCount >= maxProcessed || isOutOfTime) {
      leftoverCount += eligibleChatIds.length - chatIndex

      break
    }

    const outcome = await extractChatMemory({
      chat: { id: chatId },
      userId,
      db,
      logger,
      selection,
      trigger: 'manual',
      expectedProjectId: project.id,
    })

    if (outcome.status === 'leased') {
      leftoverCount += 1

      continue
    }

    if (outcome.status === 'skipped' && outcome.reason === 'disabled') {
      isStopped = true

      break
    }

    if (outcome.status === 'extracted' || outcome.status === 'failed') {
      processedCount += 1
      passState.modelCalled = true
    }

    if (outcome.status === 'failed') {
      failedCount += 1
      firstFailureReason ??= outcome.reason ?? 'unknown'
    }

    totals.created += outcome.applied.created
    totals.updated += outcome.applied.updated
    totals.deleted += outcome.applied.deleted
  }

  logger.set({
    attributes: {
      projectMemoryRefresh: {
        chatsConsidered: consideredCount,
        chatsEligible: eligibleChatIds.length,
        chatsProcessed: processedCount,
        chatsFailed: failedCount,
        chatsLeftover: leftoverCount,
        stopped: isStopped,
        blob: blobStatus,
        applied: totals,
      },
    },
  })

  await writeFinalRefreshState(project, userId, selection, db, {
    totals,
    blobNotice,
    leftoverCount,
    processedCount,
    failedCount,
    firstFailureReason,
  })
}

async function writeFinalRefreshState(
  project: { id: string, memoryDirtyAt: Date | null },
  userId: number,
  selection: ResolvedMemoryModel,
  db: DbClient,
  outcome: {
    totals: RefreshTotals
    blobNotice: string | null
    leftoverCount: number
    processedCount: number
    failedCount: number
    firstFailureReason: string | null
  },
) {
  const currentState = await db.query.projects.findFirst({
    where: { id: project.id, userId },
    columns: { memoryStatus: true, memoryDirtyAt: true },
  })

  if (currentState?.memoryStatus === 'disabled') {
    return
  }

  const memoryProvider = getMemoryProviderId(selection)
  const memoryModel = selection.modelId
  const hasAppliedChanges = outcome.totals.created
    + outcome.totals.updated
    + outcome.totals.deleted > 0

  const isEveryChatFailed = outcome.processedCount > 0
    && outcome.failedCount === outcome.processedCount

  if (isEveryChatFailed) {
    await writeRefreshState(db, project.id, userId, {
      ...(hasAppliedChanges ? { memoryUpdatedAt: new Date() } : {}),
      memoryStatus: 'failed',
      memoryDirtyAt: new Date(),
      memoryProvider,
      memoryModel,
      memoryError: outcome.firstFailureReason,
    })

    return
  }

  const currentDirtyAt = currentState?.memoryDirtyAt ?? null
  const hasMessageArrivedDuringPass = isDirtiedDuringPass(
    currentDirtyAt,
    project.memoryDirtyAt,
  )
  const hasFailedChats = outcome.failedCount > 0
  const isPending = outcome.leftoverCount > 0
    || hasMessageArrivedDuringPass
    || hasFailedChats
  const hasEntries = await projectHasMemoryEntries(db, project.id, userId)
  let memoryDirtyAt: Date | null = null

  if (outcome.leftoverCount > 0 || hasFailedChats) {
    memoryDirtyAt = new Date()
  } else if (hasMessageArrivedDuringPass) {
    memoryDirtyAt = currentDirtyAt
  }

  let memoryStatus: ProjectMemoryStatus = hasEntries ? 'ready' : 'idle'

  if (isPending) {
    memoryStatus = 'stale'
  }

  await writeRefreshState(db, project.id, userId, {
    ...(hasAppliedChanges ? { memoryUpdatedAt: new Date() } : {}),
    memoryStatus,
    memoryDirtyAt,
    memoryProvider,
    memoryModel,
    memoryError: outcome.firstFailureReason ?? outcome.blobNotice,
  })
}

/**
 * Turns project memory off (non-destructive for entries: they stay, but are
 * no longer injected or written) or back on. Turning it off keeps the legacy
 * blob column too and only clears the lifecycle fields. Turning it on runs the
 * explicit refresh only while the account has memory turned on, the user's
 * consent is current and the project is not inside its refresh cooldown;
 * those gates never throw here, the project is just enabled. Returns the
 * card.
 */
export async function toggleProjectMemory(
  projectId: string,
  userId: number,
  enabled: boolean,
  db: DbClient = useDb(),
  logger: ProjectMemoryLogger = noopProjectMemoryLogger,
) {
  const outcome = await applyProjectMemoryEnabled(
    projectId,
    userId,
    enabled,
    db,
  )

  if (outcome !== 'enabled') {
    return await buildProjectMemoryCard(projectId, userId, db, logger)
  }

  const canRefresh = await readUserMemoryEnabled(db, userId)
    && await hasUserLegalConsent(userId, db)
    && !await isRefreshCoolingDown(projectId, logger)

  if (!canRefresh) {
    return await buildProjectMemoryCard(projectId, userId, db, logger)
  }

  return await refreshProjectMemoryFromChats({
    projectId,
    userId,
    db,
    logger,
  })
}
