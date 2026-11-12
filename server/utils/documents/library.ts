import { and, count, desc, eq, or, sql } from 'drizzle-orm'
import {
  createEmptyDocumentFormatCounts,
  createEmptyDocumentSourceCounts,
  getDocumentDisplayTitle,
  isDocumentAiGenerated,
  isDocumentFormat,
} from '#shared/utils/documents'
import type {
  DocumentFormat,
  DocumentFormatCounts,
  DocumentLibraryItem,
  DocumentLibrarySource,
  DocumentSourceCounts,
} from '#shared/utils/documents'
import * as schema from '~~/server/db/schema'
import { containsLikeEscaped } from '~~/server/utils/db/like'

type DbClient = ReturnType<typeof useDb>

export interface ListLibraryDocumentsInput {
  db: DbClient
  userId: number
  offset: number
  limit: number
  query?: string
  format?: DocumentFormat
  source?: DocumentLibrarySource
}

export interface LibraryDocumentsResult {
  items: DocumentLibraryItem[]
  total: number
  formatCounts: DocumentFormatCounts
  sourceCounts: DocumentSourceCounts
}

function toLibrarySource(
  createdVia: typeof schema.documents.$inferSelect['createdVia'],
): DocumentLibrarySource {
  return createdVia === 'mcp' ? 'mcp' : 'chat'
}

function fileJoin() {
  return and(
    eq(schema.files.id, schema.documents.fileId),
    eq(schema.files.userId, schema.documents.userId),
  )
}

function originChatJoin() {
  return and(
    eq(schema.chats.id, schema.documents.originChatId),
    eq(schema.chats.userId, schema.documents.userId),
  )
}

/**
 * The owner's finished documents, newest first. The selection aliases the
 * file id and the chat title: D1 returns rows keyed by column name, so the
 * duplicate `id` and `title` columns of the joined tables would overwrite
 * each other. A document counts only while
 * its file exists: deleting the file detaches the row (`fileId` becomes null),
 * so the inner join on `files` drops it. The counts ignore the search text,
 * the format and the source, like the artifact kind counts. One batch is one
 * D1 round trip for the page, the total and the counts.
 */
export async function listLibraryDocuments(
  input: ListLibraryDocumentsInput,
): Promise<LibraryDocumentsResult> {
  const search = input.query?.trim() ?? ''
  const ownedReady = and(
    eq(schema.documents.userId, input.userId),
    eq(schema.documents.status, 'ready'),
  )
  const filter = and(
    ownedReady,
    input.format ? eq(schema.documents.format, input.format) : undefined,
    input.source ? eq(schema.documents.createdVia, input.source) : undefined,
    search
      ? or(
        containsLikeEscaped(schema.files.name, search),
        containsLikeEscaped(schema.documents.title, search),
      )
      : undefined,
  )
  const itemsQuery = input.db
    .select({
      id: schema.documents.id,
      format: schema.documents.format,
      title: schema.documents.title,
      stats: schema.documents.stats,
      createdVia: schema.documents.createdVia,
      aiGenerated: schema.documents.aiGenerated,
      createdAt: schema.documents.createdAt,
      fileId: sql<string>`${schema.files.id}`
        .mapWith(schema.files.id)
        .as('file_row_id'),
      fileName: schema.files.name,
      storageKey: schema.files.storageKey,
      size: schema.files.size,
      originChatSlug: schema.chats.slug,
      originChatTitle: sql<string | null>`${schema.chats.title}`
        .as('origin_chat_title'),
    })
    .from(schema.documents)
    .innerJoin(schema.files, fileJoin())
    .leftJoin(schema.chats, originChatJoin())
    .where(filter)
    .orderBy(desc(schema.documents.createdAt), desc(schema.documents.id))
    .limit(input.limit)
    .offset(input.offset)
  const totalQuery = input.db
    .select({ total: count() })
    .from(schema.documents)
    .innerJoin(schema.files, fileJoin())
    .where(filter)
  const groupsQuery = input.db
    .select({
      format: schema.documents.format,
      createdVia: schema.documents.createdVia,
      total: count(),
    })
    .from(schema.documents)
    .innerJoin(schema.files, fileJoin())
    .where(ownedReady)
    .groupBy(schema.documents.format, schema.documents.createdVia)
  const [rows, totalRows, groupRows] = await input.db.batch([
    itemsQuery,
    totalQuery,
    groupsQuery,
  ])
  const formatCounts = createEmptyDocumentFormatCounts()
  const sourceCounts = createEmptyDocumentSourceCounts()

  for (const group of groupRows) {
    if (isDocumentFormat(group.format)) {
      formatCounts[group.format] += Number(group.total)
    }

    sourceCounts[toLibrarySource(group.createdVia)] += Number(group.total)
  }

  return {
    items: rows.map((row) => {
      return {
        id: row.id,
        format: row.format,
        title: getDocumentDisplayTitle(
          row.fileName || row.title || 'Document',
          row.format,
        ),
        source: toLibrarySource(row.createdVia),
        aiGenerated: isDocumentAiGenerated(row),
        fileId: row.fileId,
        fileName: row.fileName,
        storageKey: row.storageKey,
        size: row.size,
        stats: row.stats,
        originChatSlug: row.originChatSlug ?? null,
        originChatTitle: row.originChatTitle ?? null,
        createdAt: row.createdAt.toISOString(),
      }
    }),
    total: Number(totalRows[0]?.total ?? 0),
    formatCounts,
    sourceCounts,
  }
}
