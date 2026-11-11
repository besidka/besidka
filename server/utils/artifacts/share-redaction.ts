const ARTIFACT_SHARE_PATH_PATTERN
  = /(\/|%(?:25)*2f)a(\/|#|%(?:25)*2f|%(?:25)*23)[^\s/?#&%"'<>]+/gi
const ARTIFACT_SHARE_PATH_MARKER
  = /(?:\/|%(?:25)*2f)a(?:\/|#|%(?:25)*2f|%(?:25)*23)/i
const ARTIFACT_SHARE_TOKEN_PLACEHOLDER = '[token]'
const REDACTION_MAX_DEPTH = 8

/**
 * Replaces the token of every public artifact link in a string with
 * `[token]`: the current fragment form (`/a#<token>`, also percent-encoded
 * once or more, as in `%2Fa%23<token>`) that a browser-ingested event or a
 * pasted report may carry in a full `location.href`, and the old path form
 * (`/a/<token>`, `%2Fa%2F<token>`, `%252Fa%252F<token>`). Defence in depth:
 * the fragment never reaches the server in a request, but request paths,
 * messages, error text and stored report details still carry the route
 * pattern only (DPIA 3.13(d)).
 */
export function redactArtifactSharePath(value: unknown): unknown {
  if (typeof value !== 'string' || !ARTIFACT_SHARE_PATH_MARKER.test(value)) {
    return value
  }

  return value.replace(
    ARTIFACT_SHARE_PATH_PATTERN,
    (_match, leadingSeparator: string, trailingSeparator: string) => {
      return `${leadingSeparator}a${trailingSeparator}`
        + ARTIFACT_SHARE_TOKEN_PLACEHOLDER
    },
  )
}

/**
 * Walks a wide event (plain objects and arrays, bounded depth) and redacts
 * share tokens in every string, including nested error fields and events
 * ingested from the browser.
 */
export function redactArtifactShareTokens(
  value: unknown,
  depth = 0,
): unknown {
  if (typeof value === 'string') {
    return redactArtifactSharePath(value)
  }

  if (depth >= REDACTION_MAX_DEPTH || !value || typeof value !== 'object') {
    return value
  }

  const record = value as Record<string, unknown>

  for (const key of Object.keys(record)) {
    const current = record[key]
    const redacted = redactArtifactShareTokens(current, depth + 1)

    if (redacted !== current) {
      try {
        record[key] = redacted
      } catch {
        continue
      }
    }
  }

  return value
}
