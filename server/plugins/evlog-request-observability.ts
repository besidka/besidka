interface MutableLogger {
  set: (data: Record<string, unknown>) => void
}

const MCP_CONTEXT_OMITTED_KEYS = new Set(['session_id'])
const MCP_STRING_MAX_LENGTH = 120
const MCP_ARRAY_MAX_ITEMS = 10

type McpScalar = string | number | boolean

function isMcpScalar(value: unknown): value is McpScalar {
  return typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
}

function boundMcpScalar(value: McpScalar): McpScalar {
  return typeof value === 'string'
    ? value.slice(0, MCP_STRING_MAX_LENGTH)
    : value
}

function boundMcpValue(value: unknown): McpScalar | McpScalar[] | undefined {
  if (isMcpScalar(value)) {
    return boundMcpScalar(value)
  }

  if (!Array.isArray(value)) {
    return undefined
  }

  return value
    .slice(0, MCP_ARRAY_MAX_ITEMS)
    .filter(isMcpScalar)
    .map(boundMcpScalar)
}

export function moveMcpContextToAttributes(event: Record<string, unknown>) {
  const mcpContext = event.mcp

  if (!mcpContext || typeof mcpContext !== 'object') {
    return
  }

  const boundedContext: Record<string, McpScalar | McpScalar[]> = {}

  for (const [key, value] of Object.entries(mcpContext)) {
    const boundedValue = MCP_CONTEXT_OMITTED_KEYS.has(key)
      ? undefined
      : boundMcpValue(value)

    if (boundedValue !== undefined) {
      boundedContext[key] = boundedValue
    }
  }

  event.attributes = {
    ...(event.attributes as Record<string, unknown> | undefined),
    mcp: boundedContext,
  }

  delete event.mcp
}

const QUERY_FREE_PATH_PREFIXES = ['/api/v1/admin/']

const ARTIFACT_SHARE_PATH_PATTERN
  = /(\/|%2f)a(\/|%2f)[^\s/?#&%"'<>]+/gi
const ARTIFACT_SHARE_TOKEN_PLACEHOLDER = '[token]'
const ARTIFACT_SHARE_PATH_MARKERS = ['/a/', '%2fa%2f']
const REDACTION_MAX_DEPTH = 8

/**
 * Replaces the token of every public artifact link (`/a/<token>`, also
 * percent-encoded as in `?next=%2Fa%2F<token>`) in a string with
 * `[token]`, so request paths, messages and error text in the wide event
 * carry the route pattern only (DPIA 3.13(d)).
 */
export function redactArtifactSharePath(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const lowerCaseValue = value.toLowerCase()
  const hasMarker = ARTIFACT_SHARE_PATH_MARKERS.some((marker) => {
    return lowerCaseValue.includes(marker)
  })

  if (!hasMarker) {
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

/**
 * Drops the query string from admin API paths, so an admin's user search
 * text (`?q=`) never reaches the wide event (compliance pre-check C15).
 */
export function toLoggedPath(path: unknown): unknown {
  if (typeof path !== 'string' || !path.includes('?')) {
    return path
  }

  const isQueryFree = QUERY_FREE_PATH_PREFIXES.some((prefix) => {
    return path.startsWith(prefix)
  })

  return isQueryFree ? path.slice(0, path.indexOf('?')) : path
}

export default defineNitroPlugin((nitroApp) => {
  // Hook BOTH `request` (early, in case logger is already there) AND
  // `beforeResponse` (late, where logger is guaranteed to exist and the
  // wide event has not yet been emitted). The first call sets fields if
  // logger is ready; the second is the safety net. `logger.set()` is
  // idempotent — calling it twice with the same data has no side effects.
  nitroApp.hooks.hook('request', (event) => {
    const logger = (event.context as { log?: MutableLogger }).log

    attachCloudflareMeta(logger, event as H3Event)
  })

  nitroApp.hooks.hook('beforeResponse', (event) => {
    const logger = (event.context as { log?: MutableLogger }).log

    attachCloudflareMeta(logger, event as H3Event)
  })

  nitroApp.hooks.hook('evlog:enrich', (context) => {
    if (typeof context.request?.path === 'string') {
      context.request.path = redactArtifactSharePath(
        context.request.path,
      ) as string
    }

    redactArtifactShareTokens(context.event)

    const requestId = context.request?.requestId
    const cfRay = context.headers?.['cf-ray']
    const method = context.request?.method
    const path = toLoggedPath(context.request?.path)

    if (typeof context.event.path === 'string') {
      context.event.path = toLoggedPath(context.event.path)
    }

    if (requestId && !context.event.requestId) {
      context.event.requestId = requestId
    }

    if (!context.event.message && method && path) {
      context.event.message = `${method} ${path}`
    }

    if (cfRay) {
      context.event.requestMeta = {
        ...context.event.requestMeta,
        cfRay,
      }
    }

    moveMcpContextToAttributes(context.event)
  })
})
