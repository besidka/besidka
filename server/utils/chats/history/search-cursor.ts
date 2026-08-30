import { MAX_SEARCH_RESULTS } from '~~/server/utils/chats/history/search'

interface SerializedSearchCursor {
  offset: number
}

export function createSearchCursor(offset: number): string {
  return JSON.stringify({ offset } satisfies SerializedSearchCursor)
}

export function parseSearchCursor(cursor: string | undefined): number | null {
  if (!cursor) {
    return null
  }

  try {
    const parsedCursor = JSON.parse(cursor) as Partial<SerializedSearchCursor>

    if (
      typeof parsedCursor.offset !== 'number'
      || !Number.isFinite(parsedCursor.offset)
      || !Number.isInteger(parsedCursor.offset)
      || parsedCursor.offset < 0
      || parsedCursor.offset > MAX_SEARCH_RESULTS
    ) {
      return null
    }

    return parsedCursor.offset
  } catch {
    return null
  }
}
