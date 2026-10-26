import type { ProjectMemoryCardResponse } from '#shared/types/project-memory.d'
import { MEMORY_SETTING_DEFAULTS } from '#shared/utils/memory-policy'
import { createError } from 'evlog'
import {
  assertOwnedProject,
  getMemoryEntryLimits,
  groupMemoryEntries,
  listMemoryEntries,
} from '~~/server/utils/memory/entries'
import { resolveProjectMemoryDisplayStatus } from '~~/server/utils/projects/memory'
import type { ProjectMemoryLogger } from '~~/server/utils/projects/memory-lease'
import { noopProjectMemoryLogger } from '~~/server/utils/projects/memory-lease'

type DbClient = ReturnType<typeof useDb>

/**
 * The project memory card: lifecycle metadata of the project row plus its
 * project-scope entries, grouped like the account memory list. The legacy
 * blob is exposed while it is non-blank and not marked migrated, even when
 * entries already exist, so an unconverted blob never vanishes from the card;
 * `usesEntries` (marker or any entry) decides injection. Owner scoped:
 * another user's project reads as not found.
 */
export async function buildProjectMemoryCard(
  projectId: string,
  userId: number,
  db: DbClient,
  logger: ProjectMemoryLogger = noopProjectMemoryLogger,
): Promise<ProjectMemoryCardResponse> {
  await assertOwnedProject(db, userId, projectId)

  const project = await db.query.projects.findFirst({
    where: { id: projectId, userId },
    columns: {
      id: true,
      memory: true,
      memoryStatus: true,
      memoryUpdatedAt: true,
      memoryDirtyAt: true,
      memoryProvider: true,
      memoryModel: true,
      memoryError: true,
      memoryMigratedAt: true,
      useAccountMemory: true,
    },
  })

  if (!project) {
    throw createError({
      message: 'Project not found',
      status: 404,
    })
  }

  const entries = await listMemoryEntries({
    db,
    userId,
    scope: { kind: 'project', projectId: project.id },
  })
  const usesEntries = !!project.memoryMigratedAt || entries.length > 0
  const legacyMemory = !project.memoryMigratedAt && project.memory?.trim()
    ? project.memory
    : null

  return {
    projectId: project.id,
    memoryStatus: await resolveProjectMemoryDisplayStatus(
      project.memoryStatus,
      project.id,
      logger,
    ),
    memoryUpdatedAt: project.memoryUpdatedAt?.toISOString() ?? null,
    memoryDirtyAt: project.memoryDirtyAt?.toISOString() ?? null,
    memoryProvider: project.memoryProvider,
    memoryModel: project.memoryModel,
    memoryError: project.memoryError,
    usesEntries,
    useAccountMemory: project.useAccountMemory
      ?? MEMORY_SETTING_DEFAULTS.useAccountMemory,
    legacyMemory,
    total: entries.length,
    limits: getMemoryEntryLimits(),
    groups: groupMemoryEntries(entries),
  }
}
