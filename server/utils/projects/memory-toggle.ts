import { and, eq, isNull, ne, or } from 'drizzle-orm'
import { createError } from 'evlog'
import type { ProjectMemoryStatus } from '#shared/types/projects.d'
import type { ProjectAutoUpdate } from '#shared/utils/project-memory-auto-update'
import * as schema from '~~/server/db/schema'

type DbClient = ReturnType<typeof useDb>

export type ProjectMemoryToggleOutcome = 'disabled' | 'unchanged' | 'enabled'

export interface ProjectMemoryToggleOptions {
  forwardOnly?: boolean
}

export async function projectHasMemoryEntries(
  db: DbClient,
  projectId: string,
  userId: number,
) {
  const entry = await db.query.memoryEntries.findFirst({
    where: { userId, projectId },
    columns: { id: true },
  })

  return !!entry
}

export async function projectMemorySettledStatus(
  db: DbClient,
  projectId: string,
  userId: number,
): Promise<Extract<ProjectMemoryStatus, 'ready' | 'idle'>> {
  const hasEntries = await projectHasMemoryEntries(db, projectId, userId)

  return hasEntries ? 'ready' : 'idle'
}

/**
 * Flips only the lifecycle state of project memory and never reads chats or
 * calls a model. Turning it off keeps the entries and the legacy blob and
 * clears the lifecycle fields. Turning it on restores `ready` or `idle`
 * from the existing entries. `enabled` means the project was disabled before,
 * the only case where the web action goes on to refresh; `unchanged` means
 * it was already on. With `forwardOnly`, turning it on first stamps the
 * project's chats as already summarized, so the background sweep reads only
 * what is written from now on and never spends the user's key on messages
 * written while memory was off.
 */
export async function applyProjectMemoryEnabled(
  projectId: string,
  userId: number,
  enabled: boolean,
  db: DbClient,
  options: ProjectMemoryToggleOptions = {},
): Promise<ProjectMemoryToggleOutcome> {
  const project = await db.query.projects.findFirst({
    where: { id: projectId, userId },
    columns: { id: true, memoryStatus: true },
  })

  if (!project) {
    throw createError({
      message: 'Project not found',
      status: 404,
    })
  }

  if (!enabled) {
    await db.update(schema.projects)
      .set({
        memoryStatus: 'disabled',
        memoryUpdatedAt: null,
        memoryDirtyAt: null,
        memoryProvider: null,
        memoryModel: null,
        memoryError: null,
      })
      .where(and(
        eq(schema.projects.id, project.id),
        eq(schema.projects.userId, userId),
      ))

    return 'disabled'
  }

  if (project.memoryStatus !== 'disabled') {
    return 'unchanged'
  }

  const settledStatus = await projectMemorySettledStatus(
    db,
    project.id,
    userId,
  )

  if (options.forwardOnly) {
    await db.update(schema.chats)
      .set({ projectMemorySummaryUpdatedAt: new Date() })
      .where(and(
        eq(schema.chats.projectId, project.id),
        eq(schema.chats.userId, userId),
      ))
  }

  await db.update(schema.projects)
    .set({
      memoryStatus: settledStatus,
      memoryDirtyAt: null,
      memoryError: null,
    })
    .where(and(
      eq(schema.projects.id, project.id),
      eq(schema.projects.userId, userId),
    ))

  return 'enabled'
}

/**
 * Stores the per-project account-memory sharing choice explicitly as `true`
 * or `false`; `null` stays the "never chosen, shared" state of untouched
 * projects. Ownership is part of the WHERE clause, so another user's project
 * reads as not found.
 */
export async function applyProjectUseAccountMemory(
  projectId: string,
  userId: number,
  useAccountMemory: boolean,
  db: DbClient,
) {
  const updatedRows = await db.update(schema.projects)
    .set({ useAccountMemory })
    .where(and(
      eq(schema.projects.id, projectId),
      eq(schema.projects.userId, userId),
    ))
    .returning({ id: schema.projects.id })

  if (updatedRows.length === 0) {
    throw createError({
      message: 'Project not found',
      status: 404,
    })
  }
}

/**
 * Stores the per-project automatic-update choice: `on` or `off` override the
 * account "Generate memory from chats" switch, `inherit` (stored as NULL)
 * follows it. `memory_auto_update_enabled_at` is the project's forward-only
 * cut-over: the sweep never reads project chats at or before it. It is
 * stamped when the project becomes `on` from another state and when it
 * returns to `inherit` from `off`, so the background sweep never reads
 * messages written while automatic updates were off. Re-saving `on` or
 * `inherit` keeps the stamp, `inherit` from `on` keeps it, and `off` clears
 * it. Each stamping write is one guarded statement, so concurrent saves
 * cannot restamp. Ownership is part of the WHERE clause, so another user's
 * project reads as not found. Never reads chats and never calls a model.
 */
export async function applyProjectMemoryAutoUpdate(
  projectId: string,
  userId: number,
  autoUpdate: ProjectAutoUpdate,
  db: DbClient,
  now: Date = new Date(),
) {
  const owned = and(
    eq(schema.projects.id, projectId),
    eq(schema.projects.userId, userId),
  )
  const project = await db.query.projects.findFirst({
    where: { id: projectId, userId },
    columns: { id: true },
  })

  if (!project) {
    throw createError({
      message: 'Project not found',
      status: 404,
    })
  }

  if (autoUpdate === 'on') {
    await db.update(schema.projects)
      .set({ memoryAutoUpdate: 'on', memoryAutoUpdateEnabledAt: now })
      .where(and(
        owned,
        or(
          isNull(schema.projects.memoryAutoUpdate),
          ne(schema.projects.memoryAutoUpdate, 'on'),
        ),
      ))

    return
  }

  if (autoUpdate === 'off') {
    await db.update(schema.projects)
      .set({ memoryAutoUpdate: 'off', memoryAutoUpdateEnabledAt: null })
      .where(owned)

    return
  }

  await db.update(schema.projects)
    .set({ memoryAutoUpdate: null, memoryAutoUpdateEnabledAt: now })
    .where(and(owned, eq(schema.projects.memoryAutoUpdate, 'off')))
  await db.update(schema.projects)
    .set({ memoryAutoUpdate: null })
    .where(and(owned, eq(schema.projects.memoryAutoUpdate, 'on')))
}
