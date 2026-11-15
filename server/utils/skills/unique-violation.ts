const MAX_ERROR_CAUSE_DEPTH = 5

/**
 * The message of the first error in the `cause` chain that reports a UNIQUE
 * constraint (D1 and better-sqlite3 both word it as "UNIQUE constraint
 * failed: <table>.<column>, ..."), or null. Only the column list is
 * returned, never a bound value.
 */
export function findUniqueViolation(exception: unknown): string | null {
  let current: unknown = exception

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) {
      return null
    }

    const markerIndex = current.message.indexOf('UNIQUE constraint failed')

    if (markerIndex !== -1) {
      return current.message.slice(markerIndex).split('\n')[0]!
    }

    current = current.cause
  }

  return null
}

export function isUniqueViolation(exception: unknown): boolean {
  return findUniqueViolation(exception) !== null
}
