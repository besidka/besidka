import { and, desc, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import { useLogger } from 'evlog'
import * as schema from '~~/server/db/schema'
import { containsLikeEscaped } from '~~/server/utils/db/like'

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
    ? containsLikeEscaped(schema.projects.name, search)
    : undefined

  const archiveFilter = archived
    ? isNotNull(schema.projects.archivedAt)
    : isNull(schema.projects.archivedAt)

  const orderBy = sortBy === 'name'
    ? asc(schema.projects.name)
    : desc(schema.projects.activityAt)

  const pinnedQuery = db.select()
    .from(schema.projects)
    .where(and(
      eq(schema.projects.userId, userId),
      isNotNull(schema.projects.pinnedAt),
      archiveFilter,
      searchFilter,
    ))
    .orderBy(orderBy)

  const projectsQuery = db.select()
    .from(schema.projects)
    .where(and(
      eq(schema.projects.userId, userId),
      isNull(schema.projects.pinnedAt),
      archiveFilter,
      searchFilter,
    ))
    .orderBy(orderBy)

  const [pinned, projects] = await db.batch([pinnedQuery, projectsQuery])

  return { pinned, projects }
})
