export default defineNitroPlugin((nitroApp) => {
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
