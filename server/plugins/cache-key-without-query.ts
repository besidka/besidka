import type { NitroRuntimeHooks } from 'nitropack/types'

type RequestHookEvent = Parameters<NitroRuntimeHooks['request']>[0]

const LANDING_PATH = '/'
const RAW_TWIN_PREFIX = '/raw/'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', dropQueryFromCacheKeyUrl)
})

function isRouteCachedPath(pathname: string): boolean {
  return pathname === LANDING_PATH || pathname.startsWith(RAW_TWIN_PREFIX)
}

export function dropQueryFromCacheKeyUrl(event: RequestHookEvent): void {
  const [pathname, query] = event.path.split('?')

  if (query === undefined || !isRouteCachedPath(pathname)) {
    return
  }

  event.node.req.originalUrl = pathname
}
