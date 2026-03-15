type ProjectCursorSort = 'activity' | 'name'

interface ProjectActivityCursor {
  sortBy: 'activity'
  activityAt: Date
  id: string
}

interface ProjectNameCursor {
  sortBy: 'name'
  name: string
  id: string
}

type ProjectCursor = ProjectActivityCursor | ProjectNameCursor

interface SerializedProjectActivityCursor {
  sortBy: 'activity'
  activityAt: string
  id: string
}

interface SerializedProjectNameCursor {
  sortBy: 'name'
  name: string
  id: string
}

type SerializedProjectCursor
  = | SerializedProjectActivityCursor
    | SerializedProjectNameCursor

export function createProjectsCursor(
  row: { activityAt: Date, name: string, id: string },
  sortBy: ProjectCursorSort,
): string {
  if (sortBy === 'name') {
    return JSON.stringify({
      sortBy: 'name',
      name: row.name,
      id: row.id,
    } satisfies SerializedProjectNameCursor)
  }

  return JSON.stringify({
    sortBy: 'activity',
    activityAt: row.activityAt.toISOString(),
    id: row.id,
  } satisfies SerializedProjectActivityCursor)
}

export function parseProjectsCursor(
  cursor: string | undefined,
  sortBy: ProjectCursorSort,
): ProjectCursor | null {
  if (!cursor) {
    return null
  }

  try {
    const parsed = JSON.parse(cursor) as Partial<SerializedProjectCursor>

    if (parsed.sortBy !== sortBy) {
      return null
    }

    if (!parsed.id || typeof parsed.id !== 'string') {
      return null
    }

    if (sortBy === 'name') {
      const nameParsed = parsed as Partial<SerializedProjectNameCursor>

      if (typeof nameParsed.name !== 'string' || !nameParsed.name) {
        return null
      }

      return { sortBy: 'name', name: nameParsed.name, id: parsed.id }
    }

    const activityParsed = parsed as Partial<SerializedProjectActivityCursor>

    if (typeof activityParsed.activityAt !== 'string') {
      return null
    }

    const activityAt = new Date(activityParsed.activityAt)

    if (Number.isNaN(activityAt.getTime())) {
      return null
    }

    return { sortBy: 'activity', activityAt, id: parsed.id }
  } catch {
    return null
  }
}
