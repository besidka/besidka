const MAX_JSON_DECODE_PASSES = 3
const JSON_TEXT_START = /^[[{"]/
const WHITESPACE = /\s+/

function decodeJsonText(value: string): unknown {
  let decoded: unknown = value

  for (let pass = 0; pass < MAX_JSON_DECODE_PASSES; pass++) {
    if (typeof decoded !== 'string') {
      break
    }

    const text = decoded.trim()

    if (!JSON_TEXT_START.test(text)) {
      return text
    }

    try {
      decoded = JSON.parse(text)
    } catch {
      return null
    }
  }

  return decoded
}

function toUniqueScopes(entries: unknown[]): string[] {
  const scopes = entries.filter((entry): entry is string => {
    return typeof entry === 'string' && entry.trim().length > 0
  })

  return [...new Set(scopes.map((scope) => {
    return scope.trim()
  }))]
}

/**
 * Better Auth writes OAuth scope lists pre-stringified into columns that
 * Drizzle declares as `json`, so a read can return an array, a JSON text, a
 * double-encoded JSON text or a space-separated string. This reads every one
 * of those shapes into a de-duplicated string list, drops non-string entries
 * and returns an empty list for anything it cannot read.
 */
export function parseStoredOAuthScopes(value: unknown): string[] {
  const decoded = typeof value === 'string' ? decodeJsonText(value) : value

  if (Array.isArray(decoded)) {
    return toUniqueScopes(decoded)
  }

  if (typeof decoded === 'string') {
    return toUniqueScopes(decoded.split(WHITESPACE))
  }

  return []
}
