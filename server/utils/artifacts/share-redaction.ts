const ENCODED_SLASH = '%(?:25)*2f'
const LINK_BOUNDARY = [
  '^',
  '[\\s"\'(=,;]',
  '\\/\\/[^\\s/?#"\'<>]+',
  `%(?:25)*3a${ENCODED_SLASH}${ENCODED_SLASH}(?:(?!${ENCODED_SLASH})[^\\s/?#"'<>&])+`,
].join('|')
const ARTIFACT_SHARE_PATH_PATTERN = new RegExp(
  `(${LINK_BOUNDARY})(\\/|${ENCODED_SLASH})artifacts(\\/|${ENCODED_SLASH})`
  + '[^\\s/?#&%"\'<>]+',
  'gim',
)
const ARTIFACT_SHARE_PATH_MARKER = new RegExp(
  `artifacts(?:\\/|${ENCODED_SLASH})`,
  'i',
)
const ARTIFACT_SHARE_TOKEN_PLACEHOLDER = '[token]'
const REDACTION_MAX_DEPTH = 8

/**
 * Replaces the token of every public artifact link in a string with
 * `[token]`: `/artifacts/<token>` as a request path, inside a full URL, in a
 * query value (`next=%2Fartifacts%2F<token>`) and percent-encoded more than
 * once (`%252Fartifacts%252F<token>`). Only a link whose `artifacts` segment
 * starts the path counts, so `/api/v1/artifacts/<id>/shares` keeps its id.
 * The token otherwise reaches request paths, messages, error text, browser
 * ingested events and stored report details (DPIA 3.13(d)).
 */
export function redactArtifactSharePath(value: unknown): unknown {
  if (typeof value !== 'string' || !ARTIFACT_SHARE_PATH_MARKER.test(value)) {
    return value
  }

  return value.replace(
    ARTIFACT_SHARE_PATH_PATTERN,
    (
      _match,
      boundary: string,
      leadingSeparator: string,
      trailingSeparator: string,
    ) => {
      return `${boundary}${leadingSeparator}artifacts${trailingSeparator}`
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
