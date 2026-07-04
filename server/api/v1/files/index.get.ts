import { z } from 'zod'
import { and, desc, eq, like, sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

const querySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
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
      statusCode: 400,
      statusMessage: 'Invalid query parameters',
      data: query.error.flatten(),
    })
  }

  const { offset, limit, search } = query.data
  const userId = parseInt(session.user.id)
  const db = useDb()

  const whereConditions = search
    ? and(
      eq(schema.files.userId, userId),
      like(schema.files.name, `%${search}%`),
    )
    : eq(schema.files.userId, userId)

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
      })
      .from(schema.files)
      .where(whereConditions)
      .orderBy(desc(schema.files.createdAt))
      .offset(offset)
      .limit(limit),
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.files)
      .where(whereConditions)
      .get(),
  ])

  return {
    files,
    total: countResult?.count ?? 0,
    offset,
    limit,
  }
})
