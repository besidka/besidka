import { and, desc, asc, eq, isNotNull, isNull, like } from 'drizzle-orm'
import { useLogger } from 'evlog'
import * as schema from '~~/server/db/schema'

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const query = getQuery(event)
  const search = (query.search as string | undefined)?.trim() ?? ''
  const sortBy = (query.sortBy as string | undefined) === 'name'
    ? 'name'
    : 'activity'
  const archived = query.archived === 'true'

  const db = useDb()
  const userId = parseInt(session.user.id)

  logger.set({ userId, sortBy, archived, hasSearch: search.length >= 2 })

  const searchFilter = search.length >= 2
    ? like(schema.folders.name, `%${search}%`)
    : undefined

  const archiveFilter = archived
    ? isNotNull(schema.folders.archivedAt)
    : isNull(schema.folders.archivedAt)

  const orderBy = sortBy === 'name'
    ? asc(schema.folders.name)
    : desc(schema.folders.activityAt)

  const pinnedQuery = db.select()
    .from(schema.folders)
    .where(and(
      eq(schema.folders.userId, userId),
      isNotNull(schema.folders.pinnedAt),
      archiveFilter,
      searchFilter,
    ))
    .orderBy(orderBy)

  const foldersQuery = db.select()
    .from(schema.folders)
    .where(and(
      eq(schema.folders.userId, userId),
      isNull(schema.folders.pinnedAt),
      archiveFilter,
      searchFilter,
    ))
    .orderBy(orderBy)

  const [pinned, folders] = await db.batch([pinnedQuery, foldersQuery])

  return { pinned, folders }
})
