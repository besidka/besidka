const PATH_SEPARATOR = String.raw`(?:\/|%(?:25)*2f)`
const SEGMENT = String.raw`(?:(?!%(?:25)*2f)[^\s/?#&"'<>])+`
const ARTIFACT_STORAGE_KEY_PATH_PATTERN = new RegExp(
  `(${PATH_SEPARATOR}api${PATH_SEPARATOR}v1${PATH_SEPARATOR}artifacts`
  + `${PATH_SEPARATOR}${SEGMENT}${PATH_SEPARATOR}storage${PATH_SEPARATOR})`
  + String.raw`${SEGMENT}(?:\?[^\s"'<>]*)?`,
  'gi',
)
const ARTIFACT_STORAGE_PATH_MARKER = new RegExp(
  `artifacts${PATH_SEPARATOR}${SEGMENT}${PATH_SEPARATOR}storage`
  + PATH_SEPARATOR,
  'i',
)
const ARTIFACT_STORAGE_KEY_PLACEHOLDER = '[key]'
const REDACTION_MAX_DEPTH = 8

/**
 * Replaces the key of every viewer storage route
 * (`/api/v1/artifacts/<id>/storage/<key>`, also percent-encoded once or
 * more) with `[key]` and drops a query string that follows it. Key names are
 * chosen by artifact code and can carry personal data, so request paths,
 * messages and error text keep the route pattern only.
 */
export function redactArtifactStorageKeyPath(value: unknown): unknown {
  if (
    typeof value !== 'string'
    || !ARTIFACT_STORAGE_PATH_MARKER.test(value)
  ) {
    return value
  }

  return value.replace(
    ARTIFACT_STORAGE_KEY_PATH_PATTERN,
    (_match, routePrefix: string) => {
      return `${routePrefix}${ARTIFACT_STORAGE_KEY_PLACEHOLDER}`
    },
  )
}

/**
 * Walks a wide event (plain objects and arrays, bounded depth) and redacts
 * viewer storage keys in every string.
 */
export function redactArtifactStorageKeys(
  value: unknown,
  depth = 0,
): unknown {
  if (typeof value === 'string') {
    return redactArtifactStorageKeyPath(value)
  }

  if (depth >= REDACTION_MAX_DEPTH || !value || typeof value !== 'object') {
    return value
  }

  const record = value as Record<string, unknown>

  for (const key of Object.keys(record)) {
    const current = record[key]
    const redacted = redactArtifactStorageKeys(current, depth + 1)

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
