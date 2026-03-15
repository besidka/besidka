import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  lt,
  or,
} from 'drizzle-orm'
import { useLogger } from 'evlog'
import * as schema from '~~/server/db/schema'
import { containsLikeEscaped } from '~~/server/utils/db/like'
import { parsePaginationLimit } from '~~/server/utils/pagination/limit'
import {
  createProjectsCursor,
  parseProjectsCursor,
} from '~~/server/utils/projects/cursor'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const MAX_PINNED = 50

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const query = getQuery(event)
  const cursor = query.cursor as string | undefined
  const limit = parsePaginationLimit(
    query.limit as string | undefined,
    DEFAULT_LIMIT,
    MAX_LIMIT,
  )
  const search = (query.search as string | undefined)?.trim() ?? ''
  const sortBy = (query.sortBy as string | undefined) === 'name'
    ? 'name'
    : 'activity'
  const archived = query.archived === 'true'

  const db = useDb()
  const userId = parseInt(session.user.id)
  const parsedCursor = parseProjectsCursor(cursor, sortBy)

  logger.set({
    userId,
    sortBy,
    archived,
    hasSearch: search.length >= 2,
    hasCursor: !!parsedCursor,
    limit,
  })

  const searchFilter = search.length >= 2
    ? containsLikeEscaped(schema.projects.name, search)
    : undefined

  const archiveFilter = archived
    ? isNotNull(schema.projects.archivedAt)
    : isNull(schema.projects.archivedAt)

  const orderByColumns = sortBy === 'name'
    ? [asc(schema.projects.name), asc(schema.projects.id)]
    : [desc(schema.projects.activityAt), desc(schema.projects.id)]

  let cursorFilter: ReturnType<typeof or> | undefined = undefined

  if (parsedCursor) {
    if (parsedCursor.sortBy === 'name') {
      cursorFilter = or(
        gt(schema.projects.name, parsedCursor.name),
        and(
          eq(schema.projects.name, parsedCursor.name),
          gt(schema.projects.id, parsedCursor.id),
        ),
      )
    } else {
      cursorFilter = or(
        lt(schema.projects.activityAt, parsedCursor.activityAt),
        and(
          eq(schema.projects.activityAt, parsedCursor.activityAt),
          lt(schema.projects.id, parsedCursor.id),
        ),
      )
    }
  }

  const projectsQuery = db.select()
    .from(schema.projects)
    .where(and(
      eq(schema.projects.userId, userId),
      isNull(schema.projects.pinnedAt),
      archiveFilter,
      searchFilter,
      cursorFilter,
    ))
    .orderBy(...orderByColumns)
    .limit(limit)

  if (parsedCursor) {
    const projects = await projectsQuery
    const lastProject = projects[projects.length - 1]
    const nextCursor = projects.length === limit && lastProject
      ? createProjectsCursor(lastProject, sortBy)
      : null

    return {
      pinned: [],
      projects,
      nextCursor,
    }
  }

  const pinnedQuery = db.select()
    .from(schema.projects)
    .where(and(
      eq(schema.projects.userId, userId),
      isNotNull(schema.projects.pinnedAt),
      archiveFilter,
      searchFilter,
    ))
    .orderBy(...orderByColumns)
    .limit(MAX_PINNED)

  const [pinned, projects] = await db.batch([pinnedQuery, projectsQuery])
  const lastProject = projects[projects.length - 1]
  const nextCursor = projects.length === limit && lastProject
    ? createProjectsCursor(lastProject, sortBy)
    : null

  return { pinned, projects, nextCursor }
})
