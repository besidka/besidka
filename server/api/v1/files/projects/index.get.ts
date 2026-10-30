import { createError } from 'evlog'
import { z } from 'zod'
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { containsLikeEscaped } from '~~/server/utils/db/like'
import { defineEventHandler, getQuery } from 'nuxt/server'

const MAX_PROJECTS = 200

const querySchema = z.object({
  search: z.string().trim().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const query = querySchema.safeParse(getQuery(event))

  if (!query.success) {
    throw createError({
      message: 'Invalid query parameters',
      status: 400,
      why: query.error.message,
    })
  }

  const search = query.data.search
  const userId = parseInt(session.user.id)
  const db = useDb()
  const items = schema.projectKnowledgeItems

  const rows = await db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      pinnedAt: schema.projects.pinnedAt,
      archivedAt: schema.projects.archivedAt,
      fileCount: sql<number>`count(distinct ${items.fileId})`,
    })
    .from(items)
    .innerJoin(
      schema.projects,
      and(
        eq(schema.projects.id, items.projectId),
        eq(schema.projects.userId, userId),
      ),
    )
    .innerJoin(
      schema.files,
      and(
        eq(schema.files.id, items.fileId),
        eq(schema.files.userId, userId),
      ),
    )
    .where(and(
      eq(items.userId, userId),
      isNotNull(items.fileId),
      search ? containsLikeEscaped(schema.files.name, search) : undefined,
    ))
    .groupBy(schema.projects.id)
    .orderBy(
      asc(sql`(${schema.projects.archivedAt} is not null)`),
      desc(sql`(${schema.projects.pinnedAt} is not null)`),
      desc(schema.projects.pinnedAt),
      desc(schema.projects.activityAt),
      desc(schema.projects.id),
    )
    .limit(MAX_PROJECTS)

  return {
    projects: rows.map((row) => {
      return {
        id: row.id,
        name: row.name,
        fileCount: Number(row.fileCount),
        pinned: row.pinnedAt !== null,
        archived: row.archivedAt !== null,
      }
    }),
  }
})
