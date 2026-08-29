import type { RenderContext, RenderResponse } from 'nitropack/types'

interface CacheAwareContext {
  cache?: unknown
}

const BFCACHE_ELIGIBLE_EXACT_PATHS = new Set([
  '/privacy-policy',
  '/privacy-policy/',
  '/terms-of-use',
  '/terms-of-use/',
  '/cookie-policy',
  '/cookie-policy/',
])

const BFCACHE_ELIGIBLE_PREFIX = '/shared/'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (response, context) => {
    applyDocumentCacheControl(response, context)
  })
})

export function applyDocumentCacheControl(
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

  const path = context.event.path.split('?')[0]
  const isBfcacheEligible = BFCACHE_ELIGIBLE_EXACT_PATHS.has(path)
    || path.startsWith(BFCACHE_ELIGIBLE_PREFIX)

  const cacheControl = isBfcacheEligible ? 'no-cache' : 'private, no-store'

  response.headers = { ...headers, 'cache-control': cacheControl }
}
