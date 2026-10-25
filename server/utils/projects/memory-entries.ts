import type { projects } from '~~/server/db/schemas/projects'

type DbClient = ReturnType<typeof useDb>

type ProjectEntriesTarget = Pick<typeof projects.$inferSelect, 'id'>
  & Partial<Pick<typeof projects.$inferSelect, 'memoryMigratedAt'>>

/**
 * Whether a project's memory lives in `memory_entries` rather than in the
 * legacy `projects.memory` blob: true once the blob was migrated or as soon
 * as the user owns one entry scoped to the project. The single predicate the
 * prompt builder, the blob refresh and the index builder share.
 */
export async function projectUsesMemoryEntries(
  project: ProjectEntriesTarget,
  userId: number,
  db: DbClient = useDb(),
) {
  if (project.memoryMigratedAt) {
    return true
  }

  const entry = await db.query.memoryEntries.findFirst({
    where: { userId, projectId: project.id },
    columns: { id: true },
  })

  return !!entry
}
