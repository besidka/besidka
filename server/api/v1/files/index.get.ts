import { createError } from 'evlog'
import { z } from 'zod'
import { and, desc, eq, sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { isDocumentAiGenerated } from '#shared/utils/documents'
import { OFFICE_TEXT_INLINE_MAX_BYTES } from '#shared/utils/office-files'
import type { DocumentCreatedVia } from '#shared/utils/documents'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { containsLikeEscaped } from '~~/server/utils/db/like'
import {
  filesKindFilters,
  filesSourceFilters,
  getFilesKindCondition,
  getFilesSourceCondition,
} from '~~/server/utils/files/source-filter'
import {
  decodeKnowledgeProjectId,
  isFileLinkedToProjectSql,
} from '~~/server/utils/knowledge/linked-files'
import { defineEventHandler, getQuery } from 'nuxt/server'

const querySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  source: z.enum(filesSourceFilters).default('all'),
  kind: z.enum(filesKindFilters).optional(),
  projectId: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const rawQuery = getQuery(event)
  const query = querySchema.safeParse(rawQuery)

  if (!query.success) {
    throw createError({
      message: 'Invalid query parameters',
      status: 400,
      why: query.error.message,
    })
  }

  const { offset, limit, search, source, kind, projectId } = query.data
  const userId = parseInt(session.user.id)
  const db = useDb()
  const trimmedSearch = search?.trim() ?? ''
  const isProjectScoped = source === 'project' && !!projectId
  const decodedProjectId = isProjectScoped
    ? decodeKnowledgeProjectId(projectId)
    : null

  if (isProjectScoped && decodedProjectId === null) {
    return {
      files: [],
      total: 0,
      offset,
      limit,
    }
  }

  const whereConditions = and(
    eq(schema.files.userId, userId),
    getFilesSourceCondition(source),
    getFilesKindCondition(kind),
    decodedProjectId === null
      ? undefined
      : isFileLinkedToProjectSql(schema.files.id, decodedProjectId, userId),
    trimmedSearch
      ? containsLikeEscaped(schema.files.name, trimmedSearch)
      : undefined,
  )

  const [files, countResult] = await Promise.all([
    db
      .select({
        id: schema.files.id,
        storageKey: schema.files.storageKey,
        name: schema.files.name,
        size: schema.files.size,
        type: schema.files.type,
        source: schema.files.source,
        expiresAt: schema.files.expiresAt,
        createdAt: schema.files.createdAt,
        originModel: schema.files.originModel,
        generationCost: schema.files.generationCost,
        textStatus: schema.files.textStatus,
        textBytes: schema.files.textBytes,
        textOmittedMedia: schema.files.textOmittedMedia,
        textOmittedCharts: schema.files.textOmittedCharts,
        documentId: sql<number | null>`(
          select ${schema.documents.id} from ${schema.documents}
          where ${schema.documents.fileId} = ${schema.files.id}
            and ${schema.documents.userId} = ${schema.files.userId}
            and ${schema.documents.status} = 'ready'
          limit 1
        )`,
        documentCreatedVia: sql<DocumentCreatedVia | null>`(
          select ${schema.documents.createdVia} from ${schema.documents}
          where ${schema.documents.fileId} = ${schema.files.id}
            and ${schema.documents.userId} = ${schema.files.userId}
            and ${schema.documents.status} = 'ready'
          limit 1
        )`,
        documentAiGenerated: sql<number | null>`(
          select ${schema.documents.aiGenerated} from ${schema.documents}
          where ${schema.documents.fileId} = ${schema.files.id}
            and ${schema.documents.userId} = ${schema.files.userId}
            and ${schema.documents.status} = 'ready'
          limit 1
        )`,
      })
      .from(schema.files)
      .where(whereConditions)
      .orderBy(desc(schema.files.createdAt), desc(schema.files.id))
      .offset(offset)
      .limit(limit),
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.files)
      .where(whereConditions)
      .get(),
  ])

  return {
    files: files.map((file) => {
      const { documentCreatedVia, documentAiGenerated, ...fileColumns } = file
      const hasDocument = file.documentId !== null
        && file.documentId !== undefined

      return {
        ...fileColumns,
        textTruncated: file.textBytes !== null
          && file.textBytes !== undefined
          && file.textBytes > OFFICE_TEXT_INLINE_MAX_BYTES,
        documentId: hasDocument
          ? encodePublicId(Number(file.documentId))
          : null,
        documentAiGenerated: hasDocument && documentCreatedVia
          ? isDocumentAiGenerated({
            createdVia: documentCreatedVia,
            aiGenerated: documentAiGenerated === null
              || documentAiGenerated === undefined
              ? null
              : Boolean(documentAiGenerated),
          })
          : null,
      }
    }),
    total: countResult?.count ?? 0,
    offset,
    limit,
  }
})
