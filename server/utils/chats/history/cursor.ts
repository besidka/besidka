interface HistoryCursorRow {
  activityAt: Date
  id: string
}

interface SerializedHistoryCursor {
  activityAt: string
  id: string
}

export function compareHistoryCursorRows(
  left: HistoryCursorRow,
  right: HistoryCursorRow,
) {
  const activityDifference = right.activityAt.getTime()
    - left.activityAt.getTime()

  if (activityDifference !== 0) {
    return activityDifference
  }

  return right.id.localeCompare(left.id)
}

export function createHistoryCursor(row: HistoryCursorRow) {
  return JSON.stringify({
    activityAt: row.activityAt.toISOString(),
    id: row.id,
  } satisfies SerializedHistoryCursor)
}

export function parseHistoryCursor(cursor: string | undefined) {
  if (!cursor) {
    return null
  }

  try {
    const parsedCursor = JSON.parse(cursor) as Partial<SerializedHistoryCursor>

    if (
      typeof parsedCursor.activityAt !== 'string'
      || typeof parsedCursor.id !== 'string'
      || !parsedCursor.id
    ) {
      return null
    }

    const activityAt = new Date(parsedCursor.activityAt)

    if (Number.isNaN(activityAt.getTime())) {
      return null
    }

    return {
      activityAt,
      id: parsedCursor.id,
    }
  } catch {
    return null
  }
}
