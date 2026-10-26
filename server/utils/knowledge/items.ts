import type {
  KnowledgeItem,
  KnowledgeMode,
} from '#shared/types/project-knowledge.d'
import { and, asc, eq, sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { encodePublicId } from '~~/server/utils/custom-db-types'

export type KnowledgeItemRow = typeof schema.projectKnowledgeItems.$inferSelect

export interface KnowledgeProjectState {
  mode: KnowledgeMode | null
  version: number
  packVersion: number | null
}

/**
 * Maps a `project_knowledge_items` row to the wire shape: public ids for the
 * item (already hashed by the column type), project and linked file, ISO
 * timestamps and plain booleans for the nullable flags.
 */
export function toKnowledgeItemWire(row: KnowledgeItemRow): KnowledgeItem {
  return {
    id: row.id,
    projectId: encodePublicId(row.projectId),
    kind: row.kind,
    fileId: row.fileId === null ? null : encodePublicId(row.fileId),
    title: row.title,
    description: row.description,
    relativePath: row.relativePath,
    folderId: row.folderId,
    contentHash: row.contentHash,
    mediaType: row.mediaType,
    sizeBytes: row.sizeBytes,
    pageCount: row.pageCount,
    textBytes: row.textBytes,
    latinChars: row.latinChars,
    cyrillicChars: row.cyrillicChars,
    otherChars: row.otherChars,
    extractStatus: row.extractStatus,
    extractError: row.extractError,
    extractor: row.extractor,
    sendAsNativePdf: row.sendAsNativePdf === true,
    pinned: row.pinned === true,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Lists a project's knowledge items in pack order (`createdAt`, then id).
 * Scoped by user and project; a foreign project yields an empty list.
 */
export async function listKnowledgeItems(input: {
  userId: number
  projectId: number
}): Promise<KnowledgeItem[]> {
  const rows = await useDb()
    .select()
    .from(schema.projectKnowledgeItems)
    .where(and(
      eq(schema.projectKnowledgeItems.userId, input.userId),
      eq(schema.projectKnowledgeItems.projectId, input.projectId),
    ))
    .orderBy(
      asc(schema.projectKnowledgeItems.createdAt),
      asc(schema.projectKnowledgeItems.id),
    )

  return rows.map(toKnowledgeItemWire)
}

/**
 * Reads the three knowledge columns of a project the user owns. The project
 * id is an internal integer matched with raw SQL. Returns null when the
 * project does not exist or belongs to someone else; `version` is
 * `knowledge_version` with null read as 0.
 */
export async function getKnowledgeProjectState(input: {
  userId: number
  projectId: number
}): Promise<KnowledgeProjectState | null> {
  const rows = await useDb()
    .select({
      mode: schema.projects.knowledgeMode,
      version: schema.projects.knowledgeVersion,
      packVersion: schema.projects.knowledgePackVersion,
    })
    .from(schema.projects)
    .where(and(
      sql`${schema.projects.id} = ${input.projectId}`,
      eq(schema.projects.userId, input.userId),
    ))
    .limit(1)
  const row = rows[0]

  if (!row) {
    return null
  }

  return {
    mode: row.mode,
    version: row.version ?? 0,
    packVersion: row.packVersion,
  }
}
