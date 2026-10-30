import { applyProjectUseAccountMemory } from '~~/server/utils/projects/memory-toggle'
import { buildProjectMemoryCard } from '~~/server/utils/projects/memory-card'
import type { ProjectMemoryLogger } from '~~/server/utils/projects/memory-lease'
import { noopProjectMemoryLogger } from '~~/server/utils/projects/memory-lease'

type DbClient = ReturnType<typeof useDb>

/**
 * Stores the per-project account-memory sharing choice explicitly as `true`
 * or `false`; `null` stays the "never chosen, shared" state of untouched
 * projects. Ownership is part of the WHERE clause, so another user's project
 * reads as not found. Returns the card.
 */
export async function setProjectUseAccountMemory(
  projectId: string,
  userId: number,
  useAccountMemory: boolean,
  db: DbClient = useDb(),
  logger: ProjectMemoryLogger = noopProjectMemoryLogger,
) {
  await applyProjectUseAccountMemory(projectId, userId, useAccountMemory, db)

  return await buildProjectMemoryCard(projectId, userId, db, logger)
}
