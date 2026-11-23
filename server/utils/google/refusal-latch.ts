export interface RefusalLatch {
  mark: (key: string) => void
  take: (key: string) => boolean
}

/**
 * Calls (by tool and the id they name) that the approval let through
 * without asking because the id was unknown when the call was judged, so
 * `execute` refuses them even if a sibling search of the same step adds
 * the id before they run. One mark refuses one call.
 */
export function createRefusalLatch(): RefusalLatch {
  const marks = new Map<string, number>()

  return {
    mark(key: string): void {
      marks.set(key, (marks.get(key) ?? 0) + 1)
    },
    take(key: string): boolean {
      const count = marks.get(key) ?? 0

      if (count === 0) {
        return false
      }

      if (count === 1) {
        marks.delete(key)
      } else {
        marks.set(key, count - 1)
      }

      return true
    },
  }
}
