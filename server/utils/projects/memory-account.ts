import { and, eq } from 'drizzle-orm'
import { createError } from 'evlog'
import * as schema from '~~/server/db/schema'
import { buildProjectMemoryCard } from '~~/server/utils/projects/memory-card'
import type { ProjectMemoryLogger } from '~~/server/utils/projects/memory-lease'
import { noopProjectMemoryLogger } from '~~/server/utils/projects/memory-lease'

type DbClient = ReturnType<typeof useDb>

/**
 * Stores the per-project account-memory sharing choice explicitly as `true`
 * or `false`; `null` stays the "never chosen, shared" state of untouched
 * projects. Ownership is part of the WHERE clause, so another user's project
 * reads as not found.
 */
export async function setProjectUseAccountMemory(
  projectId: string,
  userId: number,
  useAccountMemory: boolean,
  db: DbClient = useDb(),
  logger: ProjectMemoryLogger = noopProjectMemoryLogger,
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

  return await buildProjectMemoryCard(projectId, userId, db, logger)
}
