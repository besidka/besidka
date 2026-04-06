export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:enrich', (context) => {
    const requestId = context.request?.requestId
    const cfRay = context.headers?.['cf-ray']

    if (requestId && !context.event.requestId) {
      context.event.requestId = requestId
    }

    if (cfRay) {
      context.event.requestMeta = {
        ...context.event.requestMeta,
        cfRay,
      }
    }
  })
})
