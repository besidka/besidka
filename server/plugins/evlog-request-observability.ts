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
    const requestId = context.request?.requestId
    const cfRay = context.headers?.['cf-ray']
    const method = context.request?.method
    const path = context.request?.path

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
