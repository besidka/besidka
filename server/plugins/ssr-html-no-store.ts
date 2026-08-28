import type { RenderContext, RenderResponse } from 'nitropack/types'

interface CacheAwareContext {
  cache?: unknown
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (response, context) => {
    applyNoStoreHeader(response, context)
  })
})

export function applyNoStoreHeader(
  response: Partial<RenderResponse>,
  context: RenderContext,
): void {
  const eventContext = context.event.context as CacheAwareContext

  if (eventContext.cache) {
    return
  }

  const headers = response.headers || {}
  const hasCacheControl = Object.keys(headers).some((name) => {
    return name.toLowerCase() === 'cache-control'
  })

  if (hasCacheControl) {
    return
  }

  response.headers = { ...headers, 'cache-control': 'private, no-store' }
}
