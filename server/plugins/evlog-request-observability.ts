interface MutableLogger {
  set: (data: Record<string, unknown>) => void
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
  })
})
