import { and, eq, inArray, sql } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { decodePublicId } from '~~/server/utils/custom-db-types'

const MAX_FILE_IDS_PER_QUERY = 90
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

function chunkFileIds(fileIds: string[]): string[][] {
  const chunks: string[][] = []

  for (
    let index = 0;
    index < fileIds.length;
    index += MAX_FILE_IDS_PER_QUERY
  ) {
    chunks.push(fileIds.slice(index, index + MAX_FILE_IDS_PER_QUERY))
  }

  return chunks
}

/**
 * SQL predicate: some knowledge item references the file in `fileIdColumn`.
 * Linkage is decided in SQL because `files.id` is hashids-typed while
 * `project_knowledge_items.file_id` is a plain integer.
 */
export function isFileLinkedToKnowledgeSql(fileIdColumn: AnyColumn): SQL {
  return sql`exists (
    select 1 from project_knowledge_items as knowledge_link
    where knowledge_link.file_id = ${fileIdColumn}
  )`
}

export function isFileNotLinkedToKnowledgeSql(
  fileIdColumn: AnyColumn,
): SQL {
  return sql`not exists (
    select 1 from project_knowledge_items as knowledge_link
    where knowledge_link.file_id = ${fileIdColumn}
  )`
}

/**
 * Internal integer project id for a public project id, or null when the
 * public id does not decode to a positive safe integer.
 */
export function decodeKnowledgeProjectId(publicId: string): number | null {
  try {
    const projectId = decodePublicId(publicId)

    return Number.isSafeInteger(projectId) && projectId > 0
      ? projectId
      : null
  } catch (_exception) {
    return null
  }
}

/**
 * Which of the user's files (public ids) are referenced by at least one
 * knowledge item. The result holds canonical public ids.
 */
export async function findKnowledgeLinkedFileIds(
  userId: number,
  fileIds: string[],
): Promise<Set<string>> {
  const linkedFileIds = new Set<string>()

  if (fileIds.length === 0) {
    return linkedFileIds
  }

  const db = useDb()

  for (const chunk of chunkFileIds(fileIds)) {
    const rows = await db
      .select({ id: schema.files.id })
      .from(schema.files)
      .where(and(
        eq(schema.files.userId, userId),
        inArray(schema.files.id, chunk),
        isFileLinkedToKnowledgeSql(schema.files.id),
      ))

    for (const row of rows) {
      linkedFileIds.add(row.id)
    }
  }

  return linkedFileIds
}

/**
 * Internal integer ids of the projects whose knowledge items reference any
 * of the user's files (public ids), ready for `bumpKnowledgeVersion`.
 */
export async function findKnowledgeProjectIdsForFiles(
  userId: number,
  fileIds: string[],
): Promise<number[]> {
  const projectIds = new Set<number>()

  if (fileIds.length === 0) {
    return []
  }

  const db = useDb()

  for (const chunk of chunkFileIds(fileIds)) {
    const rows = await db
      .selectDistinct({ projectId: schema.projectKnowledgeItems.projectId })
      .from(schema.projectKnowledgeItems)
      .innerJoin(
        schema.files,
        eq(schema.files.id, schema.projectKnowledgeItems.fileId),
      )
      .where(and(
        eq(schema.projectKnowledgeItems.userId, userId),
        eq(schema.files.userId, userId),
        inArray(schema.files.id, chunk),
      ))

    for (const row of rows) {
      projectIds.add(row.projectId)
    }
  }

  return [...projectIds]
}

export interface KnowledgeTextTarget {
  projectId: number
  itemId: number
}

/**
 * The internal project and item ids of every knowledge item that links the
 * user's file (a public id), so the callers that delete the file can also
 * delete the items' R2 text objects, which the foreign-key cascade leaves
 * behind when it removes the rows.
 */
export async function findKnowledgeTextTargetsForFile(
  userId: number,
  fileId: string,
): Promise<KnowledgeTextTarget[]> {
  const items = schema.projectKnowledgeItems
  const rows = await useDb()
    .select({
      projectId: items.projectId,
      itemId: sql<number>`${items.id}`,
    })
    .from(items)
    .innerJoin(schema.files, eq(schema.files.id, items.fileId))
    .where(and(
      eq(items.userId, userId),
      eq(schema.files.userId, userId),
      eq(schema.files.id, fileId),
    ))

  return rows.map((row) => {
    return { projectId: row.projectId, itemId: Number(row.itemId) }
  })
}

/**
 * The expiry a library file gets when it stops being linked: `null` for a
 * tier without retention (vip), otherwise now plus the retention days, the
 * same computation `persistFile` applies to a new upload.
 */
export function getKnowledgeRetentionExpiresAt(
  retentionDays: number | null,
): Date | null {
  if (retentionDays === null) {
    return null
  }

  return new Date(Date.now() + retentionDays * MILLISECONDS_PER_DAY)
}

/**
 * Gives a project's linked library files their tier expiry back, the same
 * computation `persistFile` applies to a new upload (`retentionDays` comes
 * from `getEffectiveRetentionDays`, `null` for vip). A file that another
 * project of the user still links is left non-expiring. Runs as one
 * statement so no id list is bound, and must run before the project row is
 * deleted because the delete cascades the linking rows away.
 */
export async function unlinkKnowledgeProjectFiles(input: {
  userId: number
  projectId: number
  retentionDays: number | null
}): Promise<void> {
  const db = useDb()
  const items = schema.projectKnowledgeItems

  await db
    .update(schema.files)
    .set({ expiresAt: getKnowledgeRetentionExpiresAt(input.retentionDays) })
    .where(and(
      eq(schema.files.userId, input.userId),
      sql`${schema.files.id} in (
        select ${items.fileId} from ${items}
        where ${items.projectId} = ${input.projectId}
          and ${items.userId} = ${input.userId}
          and ${items.fileId} is not null
      )`,
      sql`not exists (
        select 1 from project_knowledge_items as other_link
        where other_link.file_id = ${schema.files.id}
          and other_link.project_id <> ${input.projectId}
      )`,
    ))
    .run()
}
