import { useLogger } from 'evlog'
import { getRequestHeader } from 'h3'

function resolveRequestId(event: Parameters<typeof useLogger>[0]) {
  const cfRay = getRequestHeader(event, 'cf-ray')

  if (cfRay) {
    return cfRay
  }

  const xRequestId = getRequestHeader(event, 'x-request-id')

  if (xRequestId) {
    return xRequestId
  }

  return event.context.requestId
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    const logger = useLogger(event)
    const requestId = resolveRequestId(event)

    logger.set({
      requestId,
      requestMeta: {
        cfRay: getRequestHeader(event, 'cf-ray'),
      },
    })
  })
})
