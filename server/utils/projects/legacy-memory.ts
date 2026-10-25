import type { projects } from '~~/server/db/schemas/projects'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { projectUsesMemoryEntries } from '~~/server/utils/projects/memory-entries'

type DbClient = ReturnType<typeof useDb>

type LegacyMemoryProject = Pick<typeof projects.$inferSelect, 'id' | 'memory'>
  & Partial<Pick<typeof projects.$inferSelect, 'memoryMigratedAt'>>

/**
 * The `projects.memory` blob the project system prompt may inject: null once
 * the project's memory lives in `memory_entries` (the memory index owns it,
 * or it is paused with memory off), so the same text never reaches the model
 * twice. A failed lookup keeps the blob and never fails the send.
 */
export async function resolveLegacyProjectMemory(
  project: LegacyMemoryProject,
  userId: number,
  db: DbClient,
  logger: Pick<LoggerLike, 'set'>,
) {
  try {
    const usesEntries = await projectUsesMemoryEntries(
      { id: project.id, memoryMigratedAt: project.memoryMigratedAt },
      userId,
      db,
    )

    return usesEntries ? null : project.memory
  } catch (exception) {
    logger.set({
      attributes: {
        projectMemory: {
          dedupeError: exceptionMessage(exception),
        },
      },
    })

    return project.memory
  }
}
